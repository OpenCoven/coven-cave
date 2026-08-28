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
//   - The attestation STATEMENT is verified (cave-01v4u): a certificate chain
//     must reach a pinned Apple root, and the self/absent forms are recorded as
//     "none-equivalent" rather than as a check that happened.

import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  X509Certificate,
  type KeyObject,
} from "node:crypto";

import { decodeCbor, decodeCborItem, CborError, type CborValue } from "./webauthn-cbor.ts";

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

// ─── attestation statements (cave-01v4u) ──────────────────────────────────
//
// An attestation statement is the authenticator's claim about WHAT it is (its
// model), as opposed to the credential key's proof that a human just
// authenticated. Recording `fmt` without checking the statement would imply a
// model check that never happened. This section makes the statement mean
// something: a certificate chain that reaches one of the pinned Apple roots
// proves the key lives in a Secure Enclave-backed authenticator, while the
// statement-less forms ("none", Apple's anonymous empty statement, packed
// self-attestation) are accepted as "none-equivalent" — they prove possession
// but nothing about the model, so stored state must keep that gap visible.
//
// The fleet is Apple platform authenticators, so the pinned roots are Apple's.
// A chain reaching any other root is refused: trusting an unaudited vendor root
// would re-open exactly the gap this module exists to close (a software
// authenticator that asserts the UV flag without a biometric check).

const APPLE_WEBAUTHN_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICEjCCAZmgAwIBAgIQaB0BbHo84wIlpQGUKEdXcTAKBggqhkjOPQQDAzBLMR8w
HQYDVQQDDBZBcHBsZSBXZWJBdXRobiBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJ
bmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMB4XDTIwMDMxODE4MjEzMloXDTQ1MDMx
NTAwMDAwMFowSzEfMB0GA1UEAwwWQXBwbGUgV2ViQXV0aG4gUm9vdCBDQTETMBEG
A1UECgwKQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTB2MBAGByqGSM49
AgEGBSuBBAAiA2IABCJCQ2pTVhzjl4Wo6IhHtMSAzO2cv+H9DQKev3//fG59G11k
xu9eI0/7o6V5uShBpe1u6l6mS19S1FEh6yGljnZAJ+2GNP1mi/YK2kSXIuTHjxA/
pcoRf7XkOtO4o1qlcaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUJtdk
2cV4wlpn0afeaxLQG2PxxtcwDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2cA
MGQCMFrZ+9DsJ1PW9hfNdBywZDsWDbWFp28it1d/5w2RPkRX3Bbn/UbDTNLx7Jr3
jAGGiQIwHFj+dJZYUJR786osByBelJYsVZd2GbHQu209b5RCmGQ21gpSAk9QZW4B
1bWeT0vT
-----END CERTIFICATE-----`;

const APPLE_APP_ATTESTATION_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

let cachedPinnedRoots: X509Certificate[] | null = null;

function pinnedRootCertificates(): X509Certificate[] {
  cachedPinnedRoots ??= [
    new X509Certificate(APPLE_WEBAUTHN_ROOT_CA_PEM),
    new X509Certificate(APPLE_APP_ATTESTATION_ROOT_CA_PEM),
  ];
  return cachedPinnedRoots;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replace(/:/g, "").toLowerCase();
}

function samePublicKey(a: KeyObject, b: KeyObject): boolean {
  const aDer = a.export({ format: "der", type: "spki" }) as Uint8Array;
  const bDer = b.export({ format: "der", type: "spki" }) as Uint8Array;
  return equalBytes(aDer, bDer);
}

function requireAttStmtMap(
  attStmt: CborValue | undefined,
): Map<string | number | bigint, CborValue> {
  if (!(attStmt instanceof Map)) {
    throw new WebAuthnError("malformed", "attestation statement is not a CBOR map");
  }
  return attStmt;
}

function requireSignature(attStmt: Map<string | number | bigint, CborValue>): Uint8Array {
  const sig = attStmt.get("sig");
  if (!(sig instanceof Uint8Array)) {
    throw new WebAuthnError("malformed", "attestation statement is missing a signature");
  }
  return sig;
}

function requireX5c(attStmt: Map<string | number | bigint, CborValue>): Uint8Array[] {
  const x5c = attStmt.get("x5c");
  if (!Array.isArray(x5c) || x5c.length === 0 || !x5c.every((cert) => cert instanceof Uint8Array)) {
    throw new WebAuthnError("malformed", "attestation statement is missing a certificate chain");
  }
  return x5c as Uint8Array[];
}

/**
 * Walk an x5c chain from the leaf (x5c[0]) to a certificate whose fingerprint
 * matches the pinned set. Returns the leaf after a successful walk. A chain
 * that does not reach a pinned root, whose links do not verify, or that loops,
 * is refused — reaching a pinned root is what proves the certificate was
 * ISSUED BY an Apple root, which is the whole of the model claim.
 */
function verifyCertificateChain(
  x5c: Uint8Array[],
  pinnedRoots: X509Certificate[],
): X509Certificate {
  let certificates: X509Certificate[];
  try {
    certificates = x5c.map((der) => new X509Certificate(Buffer.from(der)));
  } catch {
    throw new WebAuthnError("malformed", "attestation certificate is not a valid X.509 certificate");
  }

  const pinned = new Map<string, X509Certificate>();
  for (const root of pinnedRoots) pinned.set(normalizeFingerprint(root.fingerprint256), root);

  // Index the presented chain by subject so the walk can follow issuer links
  // even when a chain is presented out of order or omits its root.
  const bySubject = new Map<string, X509Certificate>();
  for (const cert of certificates) bySubject.set(cert.subject, cert);

  let current = certificates[0];
  const visited = new Set<string>();
  while (true) {
    if (pinned.has(normalizeFingerprint(current.fingerprint256))) {
      return certificates[0];
    }
    const fingerprint = normalizeFingerprint(current.fingerprint256);
    if (visited.has(fingerprint)) {
      throw new WebAuthnError("attestation", "certificate chain loops without reaching a pinned root");
    }
    visited.add(fingerprint);

    const issuer =
      bySubject.get(current.issuer) ??
      pinnedRoots.find((root) => root.subject === current.issuer);
    if (!issuer) {
      throw new WebAuthnError("attestation", "certificate chain does not reach a pinned root");
    }
    if (!current.verify(issuer.publicKey)) {
      throw new WebAuthnError("attestation", "certificate chain signature verification failed");
    }
    current = issuer;
  }
}

function attestationSignedPayload(authData: Uint8Array, clientDataHash: Uint8Array): Uint8Array {
  return concatBytes(authData, clientDataHash);
}

type AttestationInput = {
  authData: Uint8Array;
  rpIdHash: Uint8Array;
  clientDataHash: Uint8Array;
  credentialId: Uint8Array;
  coseKey: Map<string | number | bigint, CborValue>;
  credentialPublicKey: KeyObject;
  algorithm: number;
};

function verifyX5cAttestation(
  input: AttestationInput,
  attStmt: Map<string | number | bigint, CborValue>,
  pinnedRoots: X509Certificate[],
): AttestationVerification {
  const sig = requireSignature(attStmt);
  const x5c = requireX5c(attStmt);
  const leaf = verifyCertificateChain(x5c, pinnedRoots);

  // The certificate's own key signs the ceremony data. The chain walk already
  // proved that key was issued by a pinned root.
  let valid = false;
  try {
    valid = verifySignature(
      input.algorithm,
      leaf.publicKey,
      attestationSignedPayload(input.authData, input.clientDataHash),
      sig,
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new WebAuthnError("signature", "attestation signature did not verify");
  return true;
}

function verifySelfAttestation(
  input: AttestationInput,
  attStmt: Map<string | number | bigint, CborValue>,
): AttestationVerification {
  const sig = requireSignature(attStmt);
  // The spec's self-attestation form: the CREDENTIAL key signs the ceremony. It
  // proves possession of the credential key but nothing about the authenticator
  // model, so it is accepted as equivalent to "none".
  let valid = false;
  try {
    valid = verifySignature(
      input.algorithm,
      input.credentialPublicKey,
      attestationSignedPayload(input.authData, input.clientDataHash),
      sig,
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new WebAuthnError("signature", "self-attestation signature did not verify");
  return "none-equivalent";
}

function verifyU2fAttestation(
  input: AttestationInput,
  attStmt: Map<string | number | bigint, CborValue>,
  pinnedRoots: X509Certificate[],
): AttestationVerification {
  const sig = requireSignature(attStmt);
  const x5c = requireX5c(attStmt);
  const leaf = verifyCertificateChain(x5c, pinnedRoots);

  // U2F's certificate IS the credential's: if its public key is not the one in
  // authData, the chain proves nothing about this credential.
  if (!samePublicKey(leaf.publicKey, input.credentialPublicKey)) {
    throw new WebAuthnError(
      "attestation",
      "attestation certificate does not match the credential public key",
    );
  }

  // FIDO U2F signs 0x00 || rpIdHash || clientDataHash || credentialId || public
  // key, where the public key is the uncompressed X9.62 point (0x04 || x || y).
  const x = coseBytes(input.coseKey, -2);
  const y = coseBytes(input.coseKey, -3);
  const point = new Uint8Array(1 + x.length + y.length);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 1 + x.length);
  const payload = concatBytes(
    Uint8Array.from([0x00]),
    input.rpIdHash,
    input.clientDataHash,
    input.credentialId,
    point,
  );

  let valid = false;
  try {
    valid = verifySignature(input.algorithm, leaf.publicKey, payload, sig);
  } catch {
    valid = false;
  }
  if (!valid) throw new WebAuthnError("signature", "U2F attestation signature did not verify");
  return true;
}

export type AttestationVerification = true | "none-equivalent";

/**
 * Verify an attestation statement, called AFTER the credential key and the UV
 * flag have already been checked. Returns `true` when the statement was
 * cryptographically verified to a pinned root, and "none-equivalent" when the
 * statement is self/absent — accepted, but proving nothing about the
 * authenticator model. Refusal THROWS a WebAuthnError; it is never encoded as
 * a `false` return, so a caller cannot forget to branch on it.
 */
export function verifyAttestationStatement(
  input: AttestationInput & { fmt: string; attStmt: CborValue | undefined },
  options: { pinnedRoots?: X509Certificate[] } = {},
): AttestationVerification {
  const pinnedRoots = options.pinnedRoots ?? pinnedRootCertificates();

  switch (input.fmt) {
    case "none":
      // Self attestation: nothing to verify.
      return "none-equivalent";

    case "apple": {
      const attStmt = requireAttStmtMap(input.attStmt);
      if (attStmt.size === 0) {
        // Apple's current platform attestation is anonymous: an empty statement
        // is, per the WebAuthn spec, equivalent to "none" — there is no
        // certificate to walk. The tailnet-node binding plus the UV flag remain
        // the authorization weight (see the module header).
        return "none-equivalent";
      }
      return verifyX5cAttestation(input, attStmt, pinnedRoots);
    }

    case "packed": {
      const attStmt = requireAttStmtMap(input.attStmt);
      if (!attStmt.has("x5c")) return verifySelfAttestation(input, attStmt);
      return verifyX5cAttestation(input, attStmt, pinnedRoots);
    }

    case "fido-u2f": {
      const attStmt = requireAttStmtMap(input.attStmt);
      return verifyU2fAttestation(input, attStmt, pinnedRoots);
    }

    case "tpm":
    case "android-key":
    case "android-safetynet":
      throw new WebAuthnError(
        "attestation",
        `attestation format "${input.fmt}" requires per-format verification this server does not implement; refusing rather than recording an unverified statement as verified`,
      );

    default:
      throw new WebAuthnError("attestation", `unrecognized attestation format "${input.fmt}"`);
  }
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
  /** The recorded format, kept verbatim so stored state never overclaims. */
  attestationFormat: string;
  /** `true` when cryptographically verified to a pinned root; "none-equivalent"
   *  for self/absent statements that prove nothing about the model. */
  attestationVerified: AttestationVerification;
  backupEligible: boolean;
  backedUp: boolean;
};

export function verifyRegistration(input: {
  clientDataJSON: Uint8Array;
  attestationObject: Uint8Array;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
}): RegistrationResult {
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

  // The attestation STATEMENT is checked here, AFTER the credential key and the
  // UV flag. `fmt` stays the recorded value; `attestationVerified` records
  // whether (and how) the statement was actually checked, so stored state keeps
  // the gap between "recorded" and "proven" visible.
  const attestationVerified = verifyAttestationStatement({
    fmt: format,
    attStmt: attestation.get("attStmt"),
    authData: rawAuthData,
    rpIdHash: authData.rpIdHash,
    clientDataHash: sha256(input.clientDataJSON),
    credentialId: authData.attestedCredential.credentialId,
    coseKey: authData.attestedCredential.coseKey,
    credentialPublicKey: publicKey,
    algorithm,
  });

  return {
    credentialId: authData.attestedCredential.credentialId,
    publicKeyJwk: publicKey.export({ format: "jwk" }) as Record<string, unknown>,
    algorithm,
    signCount: authData.signCount,
    aaguid: authData.attestedCredential.aaguid,
    attestationFormat: format,
    attestationVerified,
    backupEligible: authData.flags.backupEligible,
    backedUp: authData.flags.backedUp,
  };
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
