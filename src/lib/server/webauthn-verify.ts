// WebAuthn registration/assertion verification (cave-brksh).
//
// The point of this module is to turn "the user passed Face ID" from a
// client-side boolean into a fact the server can check. The iOS app's existing
// AppLock is a SwiftUI screen gated on a local preference — nothing about it
// reaches the server, so a client with biometrics switched off is
// indistinguishable from one that just authenticated. A passkey whose private
// key lives in the Secure Enclave with user verification required fixes that:
// the signature CANNOT be produced without a successful biometric check, so a
// verifying signature IS the proof.
//
// Consequences that shape the code below:
//
//   - `userVerified` is REQUIRED, not advisory. A UP-only assertion proves
//     someone touched the device, which is exactly the claim we already had.
//     Accepting it would reintroduce the bug this module exists to close.
//   - Challenges are compared against a server-minted value supplied by the
//     caller; this module never trusts a challenge echoed out of clientDataJSON
//     alone.
//   - The signature counter is checked when the authenticator provides one.
//     Apple's platform authenticators report 0 and never increment (the key is
//     synced), so a zero counter is accepted rather than treated as a clone
//     signal — see checkSignCount.

import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  X509Certificate,
  type KeyObject,
} from "node:crypto";

import { decodeCbor, decodeCborItem, CborError, type CborValue } from "./webauthn-cbor.ts";
import { APPLE_WEB_AUTHN_ROOTS, PACKED_WEB_AUTHN_ROOTS, type PinnedRoot } from "./webauthn-roots.ts";

export class WebAuthnError extends Error {
  readonly reason: WebAuthnFailureReason;
  constructor(reason: WebAuthnFailureReason, message: string) {
    super(message);
    this.name = "WebAuthnError";
    this.reason = reason;
  }
}

export type WebAuthnFailureReason =
  | "malformed"
  | "type"
  | "challenge"
  | "origin"
  | "rp-id"
  | "user-presence"
  | "user-verification"
  | "algorithm"
  | "signature"
  | "counter"
  | "attestation";

// COSE algorithm identifiers (IANA). ES256 is what every Apple platform
// authenticator produces; the other two are here so a hardware key or an
// Android device is not silently rejected.
const COSE_ES256 = -7;
const COSE_EDDSA = -8;
const COSE_RS256 = -257;

const SUPPORTED_ALGORITHMS = new Set([COSE_ES256, COSE_EDDSA, COSE_RS256]);

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new WebAuthnError("malformed", "value is not base64url");
  }
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

// ─── authenticator data ────────────────────────────────────────────────────

export type AuthenticatorFlags = {
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  attestedCredentialData: boolean;
  extensionData: boolean;
};

export type AttestedCredential = {
  aaguid: Uint8Array;
  credentialId: Uint8Array;
  coseKey: Map<string | number | bigint, CborValue>;
};

export type ParsedAuthenticatorData = {
  rpIdHash: Uint8Array;
  flags: AuthenticatorFlags;
  signCount: number;
  attestedCredential: AttestedCredential | null;
};

export function parseAuthenticatorData(bytes: Uint8Array): ParsedAuthenticatorData {
  if (bytes.length < 37) {
    throw new WebAuthnError("malformed", "authenticator data shorter than 37 bytes");
  }
  const rpIdHash = bytes.slice(0, 32);
  const flagBits = bytes[32];
  const flags: AuthenticatorFlags = {
    userPresent: (flagBits & 0x01) !== 0,
    userVerified: (flagBits & 0x04) !== 0,
    backupEligible: (flagBits & 0x08) !== 0,
    backedUp: (flagBits & 0x10) !== 0,
    attestedCredentialData: (flagBits & 0x40) !== 0,
    extensionData: (flagBits & 0x80) !== 0,
  };
  const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0, false);

  if (!flags.attestedCredentialData) {
    return { rpIdHash, flags, signCount, attestedCredential: null };
  }

  if (bytes.length < 55) {
    throw new WebAuthnError("malformed", "attested credential data truncated");
  }
  const aaguid = bytes.slice(37, 53);
  const credentialIdLength = new DataView(bytes.buffer, bytes.byteOffset + 53, 2).getUint16(0, false);
  // 1023 is the ceiling WebAuthn puts on a credential id.
  if (credentialIdLength > 1023) {
    throw new WebAuthnError("malformed", "credential id longer than 1023 bytes");
  }
  const credentialIdEnd = 55 + credentialIdLength;
  if (bytes.length < credentialIdEnd) {
    throw new WebAuthnError("malformed", "credential id truncated");
  }
  const credentialId = bytes.slice(55, credentialIdEnd);

  // The COSE key is CBOR of unknown length, immediately followed by optional
  // extension data — decodeCborItem reports where it ended so we do not have to
  // guess.
  let coseKey: CborValue;
  try {
    coseKey = decodeCborItem(bytes.slice(credentialIdEnd)).value;
  } catch (err) {
    const detail = err instanceof CborError ? err.message : String(err);
    throw new WebAuthnError("malformed", `credential public key is not valid CBOR: ${detail}`);
  }
  if (!(coseKey instanceof Map)) {
    throw new WebAuthnError("malformed", "credential public key is not a CBOR map");
  }

  return { rpIdHash, flags, signCount, attestedCredential: { aaguid, credentialId, coseKey } };
}

// ─── COSE keys ─────────────────────────────────────────────────────────────

function coseInt(key: Map<string | number | bigint, CborValue>, label: number): number {
  const value = key.get(label);
  if (typeof value !== "number") {
    throw new WebAuthnError("malformed", `COSE label ${label} is missing or not an integer`);
  }
  return value;
}

function coseBytes(key: Map<string | number | bigint, CborValue>, label: number): Uint8Array {
  const value = key.get(label);
  if (!(value instanceof Uint8Array)) {
    throw new WebAuthnError("malformed", `COSE label ${label} is missing or not a byte string`);
  }
  return value;
}

export type CoseKey = { algorithm: number; publicKey: KeyObject };

/**
 * Convert a COSE_Key into a Node KeyObject via JWK, which is the only
 * conversion path that does not involve hand-rolling DER.
 */
export function coseKeyToPublicKey(key: Map<string | number | bigint, CborValue>): CoseKey {
  const keyType = coseInt(key, 1);
  const algorithm = coseInt(key, 3);
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new WebAuthnError("algorithm", `unsupported COSE algorithm ${algorithm}`);
  }

  // EC2
  if (keyType === 2) {
    if (algorithm !== COSE_ES256) {
      throw new WebAuthnError("algorithm", `EC2 key with non-ES256 algorithm ${algorithm}`);
    }
    const curve = coseInt(key, -1);
    if (curve !== 1) throw new WebAuthnError("algorithm", `unsupported EC curve ${curve}`);
    const x = coseBytes(key, -2);
    const y = coseBytes(key, -3);
    if (x.length !== 32 || y.length !== 32) {
      throw new WebAuthnError("malformed", "P-256 coordinates must be 32 bytes");
    }
    return {
      algorithm,
      publicKey: createPublicKey({
        key: { kty: "EC", crv: "P-256", x: base64UrlEncode(x), y: base64UrlEncode(y) },
        format: "jwk",
      }),
    };
  }

  // RSA
  if (keyType === 3) {
    if (algorithm !== COSE_RS256) {
      throw new WebAuthnError("algorithm", `RSA key with non-RS256 algorithm ${algorithm}`);
    }
    const modulus = coseBytes(key, -1);
    const exponent = coseBytes(key, -2);
    return {
      algorithm,
      publicKey: createPublicKey({
        key: { kty: "RSA", n: base64UrlEncode(modulus), e: base64UrlEncode(exponent) },
        format: "jwk",
      }),
    };
  }

  // OKP (Ed25519)
  if (keyType === 1) {
    if (algorithm !== COSE_EDDSA) {
      throw new WebAuthnError("algorithm", `OKP key with non-EdDSA algorithm ${algorithm}`);
    }
    const curve = coseInt(key, -1);
    if (curve !== 6) throw new WebAuthnError("algorithm", `unsupported OKP curve ${curve}`);
    const x = coseBytes(key, -2);
    if (x.length !== 32) throw new WebAuthnError("malformed", "Ed25519 key must be 32 bytes");
    return {
      algorithm,
      publicKey: createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: base64UrlEncode(x) },
        format: "jwk",
      }),
    };
  }

  throw new WebAuthnError("algorithm", `unsupported COSE key type ${keyType}`);
}

function verifySignature(
  algorithm: number,
  publicKey: KeyObject,
  data: Uint8Array,
  signature: Uint8Array,
): boolean {
  // Ed25519 takes no separate digest; ES256/RS256 both hash with SHA-256.
  // WebAuthn ECDSA signatures are DER-encoded, which is Node's default
  // dsaEncoding, so no re-framing is needed.
  if (algorithm === COSE_EDDSA) return cryptoVerify(null, data, publicKey, signature);
  return cryptoVerify("sha256", data, publicKey, signature);
}

// ─── client data ───────────────────────────────────────────────────────────

type ClientData = { type: string; challenge: string; origin: string; crossOrigin?: boolean };

function parseClientData(clientDataJSON: Uint8Array): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(clientDataJSON));
  } catch {
    throw new WebAuthnError("malformed", "clientDataJSON is not valid UTF-8 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WebAuthnError("malformed", "clientDataJSON is not an object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.type !== "string" ||
    typeof record.challenge !== "string" ||
    typeof record.origin !== "string"
  ) {
    throw new WebAuthnError("malformed", "clientDataJSON is missing type/challenge/origin");
  }
  return {
    type: record.type,
    challenge: record.challenge,
    origin: record.origin,
    crossOrigin: typeof record.crossOrigin === "boolean" ? record.crossOrigin : undefined,
  };
}

type CommonExpectations = {
  expectedType: string;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
};

function checkClientData(clientData: ClientData, expected: CommonExpectations) {
  if (clientData.type !== expected.expectedType) {
    throw new WebAuthnError("type", `clientData.type is ${clientData.type}`);
  }
  // Constant-time on the challenge: it is the replay-defeating secret, and the
  // comparison is against a value an attacker is trying to guess.
  const supplied = Buffer.from(clientData.challenge);
  const wanted = Buffer.from(expected.expectedChallenge);
  if (supplied.length !== wanted.length || !equalBytes(supplied, wanted)) {
    throw new WebAuthnError("challenge", "challenge does not match the server-minted value");
  }
  if (clientData.origin !== expected.expectedOrigin) {
    throw new WebAuthnError("origin", `clientData.origin is ${clientData.origin}`);
  }
  if (clientData.crossOrigin === true) {
    throw new WebAuthnError("origin", "cross-origin ceremony refused");
  }
}

function checkAuthenticatorData(authData: ParsedAuthenticatorData, expectedRpId: string) {
  if (!equalBytes(authData.rpIdHash, sha256(new TextEncoder().encode(expectedRpId)))) {
    throw new WebAuthnError("rp-id", "rpIdHash does not match the expected RP ID");
  }
  if (!authData.flags.userPresent) {
    throw new WebAuthnError("user-presence", "user presence flag is not set");
  }
  // The load-bearing check. See the module header.
  if (!authData.flags.userVerified) {
    throw new WebAuthnError(
      "user-verification",
      "user verification flag is not set — biometric/PIN check did not happen",
    );
  }
}

// ─── registration ──────────────────────────────────────────────────────────

export type RegistrationResult = {
  credentialId: Uint8Array;
  publicKeyJwk: Record<string, unknown>;
  algorithm: number;
  signCount: number;
  aaguid: Uint8Array;
  attestationFormat: string;
  /** The cryptographically-derived attestation outcome (cave-01v4u). */
  attestation: AttestationOutcome;
  backupEligible: boolean;
  backedUp: boolean;
};

export type AttestationTrustPath = "apple" | "packed-basic" | "packed-self" | "none" | "legacy";

export type AttestationOutcome = {
  format: string;
  /** True only when the authenticator MODEL was proven (chain to a pinned root). */
  verified: boolean;
  trustPath: AttestationTrustPath;
};

export type RegistrationAttestationPolicy = {
  /**
   * When true, `fmt === "none"` is accepted and recorded as model-unproven
   * (`trustPath: "none"`). The ceremony grants this only to the local loopback
   * peer, where "someone at this machine" is already the trust boundary.
   */
  allowNone: boolean;
  /** Test seam: override the Apple trust anchors (defaults to production roots). */
  appleRoots?: readonly PinnedRoot[];
  /** Test seam: override the packed trust anchors (defaults to production roots). */
  packedRoots?: readonly PinnedRoot[];
};

export function verifyRegistration(
  input: {
    clientDataJSON: Uint8Array;
    attestationObject: Uint8Array;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
  },
  policy: RegistrationAttestationPolicy = { allowNone: false },
): RegistrationResult {
  const clientData = parseClientData(input.clientDataJSON);
  checkClientData(clientData, {
    expectedType: "webauthn.create",
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRpId: input.expectedRpId,
  });

  let attestation: CborValue;
  try {
    attestation = decodeCbor(input.attestationObject);
  } catch (err) {
    const detail = err instanceof CborError ? err.message : String(err);
    throw new WebAuthnError("malformed", `attestationObject is not valid CBOR: ${detail}`);
  }
  if (!(attestation instanceof Map)) {
    throw new WebAuthnError("malformed", "attestationObject is not a CBOR map");
  }
  const format = attestation.get("fmt");
  const rawAuthData = attestation.get("authData");
  if (typeof format !== "string") {
    throw new WebAuthnError("malformed", "attestationObject.fmt is missing");
  }
  if (!(rawAuthData instanceof Uint8Array)) {
    throw new WebAuthnError("malformed", "attestationObject.authData is missing");
  }

  const authData = parseAuthenticatorData(rawAuthData);
  checkAuthenticatorData(authData, input.expectedRpId);
  if (!authData.attestedCredential) {
    throw new WebAuthnError("malformed", "registration carries no attested credential data");
  }

  const { algorithm, publicKey } = coseKeyToPublicKey(authData.attestedCredential.coseKey);
  const clientDataHash = sha256(input.clientDataJSON);

  const outcome = verifyAttestationStatement({
    format,
    attStmt: attestation.get("attStmt"),
    authData: rawAuthData,
    clientDataHash,
    algorithm,
    credentialPublicKey: publicKey,
    allowNone: policy.allowNone,
    appleRoots: policy.appleRoots ?? APPLE_WEB_AUTHN_ROOTS,
    packedRoots: policy.packedRoots ?? PACKED_WEB_AUTHN_ROOTS,
  });

  return {
    credentialId: authData.attestedCredential.credentialId,
    publicKeyJwk: publicKey.export({ format: "jwk" }) as Record<string, unknown>,
    algorithm,
    signCount: authData.signCount,
    aaguid: authData.attestedCredential.aaguid,
    attestationFormat: format,
    attestation: outcome,
    backupEligible: authData.flags.backupEligible,
    backedUp: authData.flags.backedUp,
  };
}

// ─── attestation statement verification (cave-01v4u) ────────────────────────
//
// The attestation statement proves the authenticator MODEL: fmt "apple" chains
// to the Apple WebAuthn Root CA (Secure Enclave), fmt "packed" either chains to
// a pinned vendor root or self-attests (model unproven), and fmt "none" is
// refused for new remote registrations. Verification is fully offline — no
// OCSP/CRL/AIA — and every parse failure fails closed.

// 1.2.840.113635.100.8.2 — Apple's anonymous-attestation nonce extension.
const APPLE_ANONYMOUS_ATTESTATION_NONCE_OID = Uint8Array.from([
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02,
]);

const MAX_X5C_CERTS = 5;
const MAX_CERT_DER_BYTES = 16 * 1024;

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Read one definite-length DER TLV at `offset`. Returns null on truncation or
 * a non-definite (indefinite) length — this walker only ever reads certs we
 * are about to trust, so anything it cannot parse exactly is refused.
 */
function readDerTlv(
  bytes: Uint8Array,
  offset: number,
): { tag: number; headerEnd: number; contentEnd: number } | null {
  if (offset >= bytes.length) return null;
  const tag = bytes[offset];
  let cursor = offset + 1;
  if (cursor >= bytes.length) return null;
  const first = bytes[cursor];
  cursor += 1;
  let length: number;
  if (first < 0x80) {
    length = first;
  } else {
    const lengthBytes = first & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4 || cursor + lengthBytes > bytes.length) return null;
    length = 0;
    for (let i = 0; i < lengthBytes; i += 1) length = length * 256 + bytes[cursor + i];
    cursor += lengthBytes;
  }
  if (cursor + length > bytes.length) return null;
  return { tag, headerEnd: cursor, contentEnd: cursor + length };
}

/**
 * Locate the Apple anonymous-attestation nonce (extension OID
 * 1.2.840.113635.100.8.2) inside a credential certificate. X509Certificate does
 * not expose arbitrary extensions, so this walks the DER itself: Certificate →
 * tbsCertificate → [3] EXPLICIT extensions → extnValue OCTET STRING that wraps
 * a second OCTET STRING holding the 32 nonce bytes. Returns null for anything
 * it does not fully understand.
 */
export function appleNonceExtension(cert: X509Certificate): Uint8Array | null {
  const der = cert.raw;
  const certificate = readDerTlv(der, 0);
  if (!certificate || certificate.tag !== 0x30) return null;
  const tbs = readDerTlv(der, certificate.headerEnd);
  if (!tbs || tbs.tag !== 0x30) return null;
  const tbsContent = der.subarray(tbs.headerEnd, tbs.contentEnd);

  // tbsCertificate fields in order: [0] version?, serial, signature, issuer,
  // validity, subject, subjectPublicKeyInfo, [1]/[2] unique ids?, [3] extensions.
  let offset = 0;
  while (offset < tbsContent.length) {
    const field = readDerTlv(tbsContent, offset);
    if (!field) return null;
    if (field.tag !== 0xa3) {
      offset = field.contentEnd;
      continue;
    }
    // [3] EXPLICIT extensions: content is a SEQUENCE OF Extension.
    const extensions = readDerTlv(tbsContent, field.headerEnd);
    if (!extensions || extensions.tag !== 0x30) return null;
    const sequence = tbsContent.subarray(extensions.headerEnd, extensions.contentEnd);
    let extensionOffset = 0;
    while (extensionOffset < sequence.length) {
      const extension = readDerTlv(sequence, extensionOffset);
      if (!extension || extension.tag !== 0x30) return null;
      const body = sequence.subarray(extension.headerEnd, extension.contentEnd);
      const oid = readDerTlv(body, 0);
      if (!oid || oid.tag !== 0x06) return null;
      let bodyOffset = oid.contentEnd;
      const maybeCritical = readDerTlv(body, bodyOffset);
      if (maybeCritical && maybeCritical.tag === 0x01) bodyOffset = maybeCritical.contentEnd;
      const value = readDerTlv(body, bodyOffset);
      if (!value || value.tag !== 0x04) return null;
      if (equalBytes(body.subarray(oid.headerEnd, oid.contentEnd), APPLE_ANONYMOUS_ATTESTATION_NONCE_OID)) {
        // The extension value wraps the nonce bytes. Apple's real encoding is
        // SEQUENCE { [1] EXPLICIT { OCTET STRING(32) } } (30 24 a1 22 04 20 …),
        // so descend 0x30 → 0xa1 → 0x04 before reading the 32 bytes. A bare
        // OCTET STRING and the tagless SEQUENCE { OCTET STRING(32) } variant
        // (generated fixtures) are also accepted.
        const outer = body.subarray(value.headerEnd, value.contentEnd);
        let cursor = outer;
        let inner = readDerTlv(cursor, 0);
        if (inner && inner.tag === 0x30) {
          cursor = cursor.subarray(inner.headerEnd, inner.contentEnd);
          inner = readDerTlv(cursor, 0);
          if (inner && inner.tag === 0xa1) {
            cursor = cursor.subarray(inner.headerEnd, inner.contentEnd);
            inner = readDerTlv(cursor, 0);
          }
        }
        if (inner && inner.tag === 0x04) {
          return cursor.subarray(inner.headerEnd, inner.contentEnd);
        }
        return null;
      }
      extensionOffset = extension.contentEnd;
    }
    return null;
  }
  return null;
}

function parseX5c(attStmt: Map<CborValue, CborValue>): X509Certificate[] {
  const raw = attStmt.get("x5c");
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_X5C_CERTS) {
    throw new WebAuthnError("attestation", "attestation x5c is missing or exceeds 5 certificates");
  }
  const certs: X509Certificate[] = [];
  for (const entry of raw) {
    if (!(entry instanceof Uint8Array) || entry.length === 0 || entry.length > MAX_CERT_DER_BYTES) {
      throw new WebAuthnError("attestation", "attestation x5c contains an invalid certificate");
    }
    try {
      certs.push(new X509Certificate(entry));
    } catch {
      throw new WebAuthnError("attestation", "attestation x5c contains an unparsable certificate");
    }
  }
  return certs;
}

/**
 * Validate `certs` (leaf first) against pinned roots. Per the WebAuthn spec,
 * x5c runs "up to but not including" the root, so the chain's top certificate
 * must be ISSUED BY one of the pinned roots — the roots themselves are trusted
 * by exact equality, never by self-signature. All certificates must be inside
 * their validity window, and every non-leaf must be a CA.
 */
export function validateChainToPinnedRoot(
  certs: X509Certificate[],
  roots: readonly PinnedRoot[],
): boolean {
  if (certs.length === 0 || roots.length === 0) return false;
  const now = Date.now();
  const inWindow = (cert: X509Certificate): boolean => {
    const from = Date.parse(cert.validFrom);
    const to = Date.parse(cert.validTo);
    return Number.isFinite(from) && Number.isFinite(to) && now >= from && now <= to;
  };
  for (const cert of certs) {
    if (!inWindow(cert)) return false;
  }
  for (let index = 0; index < certs.length - 1; index += 1) {
    const child = certs[index];
    const parent = certs[index + 1];
    if (!parent.ca) return false;
    if (!child.checkIssued(parent)) return false;
    try {
      if (!child.verify(parent.publicKey)) return false;
    } catch {
      return false;
    }
  }
  const top = certs[certs.length - 1];
  for (const root of roots) {
    let parsed: X509Certificate;
    try {
      parsed = new X509Certificate(root.der);
    } catch {
      continue;
    }
    if (!inWindow(parsed)) continue;
    if (!top.checkIssued(parsed)) continue;
    try {
      if (top.verify(parsed.publicKey)) return true;
    } catch {
      // keep looking at other pinned roots
    }
  }
  return false;
}

function publicKeyJwkFieldsEqual(a: KeyObject, b: KeyObject): boolean {
  const ja = a.export({ format: "jwk" }) as Record<string, unknown>;
  const jb = b.export({ format: "jwk" }) as Record<string, unknown>;
  if (ja.kty !== jb.kty) return false;
  if (ja.kty === "EC" || ja.kty === "OKP") {
    return ja.crv === jb.crv && ja.x === jb.x && ja.y === jb.y;
  }
  if (ja.kty === "RSA") {
    return ja.n === jb.n && ja.e === jb.e;
  }
  return false;
}

export function verifyAppleAttestation(input: {
  attStmt: Map<CborValue, CborValue>;
  authData: Uint8Array;
  clientDataHash: Uint8Array;
  credentialPublicKey: KeyObject;
  roots: readonly PinnedRoot[];
}): AttestationOutcome {
  const nonce = input.attStmt.get("nonce");
  if (!(nonce instanceof Uint8Array) || nonce.length === 0) {
    throw new WebAuthnError("attestation", "apple attestation is missing its nonce");
  }
  const certs = parseX5c(input.attStmt);
  const leaf = certs[0];
  if (!publicKeyJwkFieldsEqual(leaf.publicKey, input.credentialPublicKey)) {
    throw new WebAuthnError("attestation", "attestation certificate does not match the credential public key");
  }
  // Apple commits SHA256(authData || clientDataHash) inside the credential
  // certificate; the authenticator binds the certificate to this exact
  // ceremony by signing it with the Secure Enclave key. The attStmt carries
  // the same nonce on the wire; it must agree with the certificate extension.
  const committed = appleNonceExtension(leaf);
  if (!committed || committed.length !== 32 || !equalBytes(committed, nonce)) {
    throw new WebAuthnError("attestation", "apple attestation nonce does not match the certificate extension");
  }
  const expected = sha256(concatBytes(input.authData, input.clientDataHash));
  if (!equalBytes(committed, expected)) {
    throw new WebAuthnError("attestation", "apple attestation nonce does not match authData || clientDataHash");
  }
  if (!validateChainToPinnedRoot(certs, input.roots)) {
    throw new WebAuthnError("attestation", "apple attestation chain does not reach a pinned root");
  }
  return { format: "apple", verified: true, trustPath: "apple" };
}

export function verifyPackedAttestation(input: {
  attStmt: Map<CborValue, CborValue>;
  authData: Uint8Array;
  clientDataHash: Uint8Array;
  algorithm: number;
  credentialPublicKey: KeyObject;
  roots: readonly PinnedRoot[];
}): AttestationOutcome {
  const alg = input.attStmt.get("alg");
  const sig = input.attStmt.get("sig");
  if (typeof alg !== "number" || !SUPPORTED_ALGORITHMS.has(alg)) {
    throw new WebAuthnError("attestation", "packed attestation declares an unsupported algorithm");
  }
  if (!(sig instanceof Uint8Array) || sig.length === 0) {
    throw new WebAuthnError("attestation", "packed attestation is missing its signature");
  }
  const payload = concatBytes(input.authData, input.clientDataHash);

  if (input.attStmt.get("x5c") !== undefined) {
    // Basic attestation: the signature is made with the attestation key in
    // x5c[0], and the chain must reach a pinned root. No universal WebAuthn
    // root exists for packed, so the production root set is empty — fail
    // closed until a specific vendor root is deliberately pinned.
    const certs = parseX5c(input.attStmt);
    let valid = false;
    try {
      valid = verifySignature(alg, certs[0].publicKey, payload, sig);
    } catch {
      valid = false;
    }
    if (!valid) throw new WebAuthnError("signature", "packed attestation signature did not verify");
    if (!validateChainToPinnedRoot(certs, input.roots)) {
      throw new WebAuthnError("attestation", "packed attestation chain does not reach a pinned root");
    }
    return { format: "packed", verified: true, trustPath: "packed-basic" };
  }

  // Self-attestation: signed with the credential key itself. This proves the
  // key holder signed — not the model — so it is recorded honestly.
  if (alg !== input.algorithm) {
    throw new WebAuthnError("attestation", "packed self-attestation algorithm does not match the credential algorithm");
  }
  let valid = false;
  try {
    valid = verifySignature(alg, input.credentialPublicKey, payload, sig);
  } catch {
    valid = false;
  }
  if (!valid) throw new WebAuthnError("signature", "packed self-attestation signature did not verify");
  return { format: "packed", verified: false, trustPath: "packed-self" };
}

function verifyAttestationStatement(input: {
  format: string;
  attStmt: CborValue | undefined;
  authData: Uint8Array;
  clientDataHash: Uint8Array;
  algorithm: number;
  credentialPublicKey: KeyObject;
  allowNone: boolean;
  appleRoots: readonly PinnedRoot[];
  packedRoots: readonly PinnedRoot[];
}): AttestationOutcome {
  if (input.format === "apple") {
    if (!(input.attStmt instanceof Map)) {
      throw new WebAuthnError("attestation", "apple attestation statement is missing");
    }
    return verifyAppleAttestation({
      attStmt: input.attStmt,
      authData: input.authData,
      clientDataHash: input.clientDataHash,
      credentialPublicKey: input.credentialPublicKey,
      roots: input.appleRoots,
    });
  }
  if (input.format === "packed") {
    if (!(input.attStmt instanceof Map)) {
      throw new WebAuthnError("attestation", "packed attestation statement is missing");
    }
    return verifyPackedAttestation({
      attStmt: input.attStmt,
      authData: input.authData,
      clientDataHash: input.clientDataHash,
      algorithm: input.algorithm,
      credentialPublicKey: input.credentialPublicKey,
      roots: input.packedRoots,
    });
  }
  if (input.format === "none") {
    if (!input.allowNone) {
      throw new WebAuthnError(
        "attestation",
        "fmt 'none' is not accepted for new credentials — enroll from a browser that returns device attestation",
      );
    }
    return { format: "none", verified: false, trustPath: "none" };
  }
  throw new WebAuthnError("attestation", `unsupported attestation format '${input.format}'`);
}

// ─── assertion ─────────────────────────────────────────────────────────────

/**
 * A counter of 0 means "this authenticator does not implement a counter",
 * which is what Apple's synced passkeys report. Requiring a strict increase
 * would lock those out entirely. When a counter IS implemented, a value that
 * fails to advance is the standard clone signal and is refused.
 */
export function checkSignCount(stored: number, presented: number): boolean {
  if (stored === 0 && presented === 0) return true;
  return presented > stored;
}

export type AssertionResult = { signCount: number; userVerified: true; backedUp: boolean };

export function verifyAssertion(input: {
  clientDataJSON: Uint8Array;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  publicKeyJwk: Record<string, unknown>;
  algorithm: number;
  storedSignCount: number;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
}): AssertionResult {
  const clientData = parseClientData(input.clientDataJSON);
  checkClientData(clientData, {
    expectedType: "webauthn.get",
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRpId: input.expectedRpId,
  });

  const authData = parseAuthenticatorData(input.authenticatorData);
  checkAuthenticatorData(authData, input.expectedRpId);

  if (!SUPPORTED_ALGORITHMS.has(input.algorithm)) {
    throw new WebAuthnError("algorithm", `unsupported COSE algorithm ${input.algorithm}`);
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: input.publicKeyJwk as never, format: "jwk" });
  } catch {
    throw new WebAuthnError("malformed", "stored public key is not a usable JWK");
  }

  // The signed payload is authenticatorData || SHA-256(clientDataJSON). Note
  // that the CLIENT DATA is hashed but the AUTHENTICATOR DATA is not.
  const clientDataHash = sha256(input.clientDataJSON);
  const signedPayload = new Uint8Array(input.authenticatorData.length + clientDataHash.length);
  signedPayload.set(input.authenticatorData, 0);
  signedPayload.set(clientDataHash, input.authenticatorData.length);

  let valid = false;
  try {
    valid = verifySignature(input.algorithm, publicKey, signedPayload, input.signature);
  } catch {
    // A malformed DER signature makes Node throw rather than return false.
    valid = false;
  }
  if (!valid) throw new WebAuthnError("signature", "assertion signature did not verify");

  if (!checkSignCount(input.storedSignCount, authData.signCount)) {
    throw new WebAuthnError(
      "counter",
      `signature counter did not advance (stored ${input.storedSignCount}, presented ${authData.signCount})`,
    );
  }

  return { signCount: authData.signCount, userVerified: true, backedUp: authData.flags.backedUp };
}
