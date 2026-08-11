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

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

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
  | "counter";

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

  // NOTE: the attestation STATEMENT is recorded but not cryptographically
  // verified. Doing so means walking a certificate chain to Apple's or the
  // vendor's root, which proves the authenticator MODEL. Here the binding that
  // carries the authorization weight is the tailnet node (cave-zm6pn) plus the
  // UV flag, and registration is already reachable only from an allowlisted
  // device. Recording `fmt` keeps the gap visible in stored state instead of
  // implying a check that did not happen. Follow-up: cave-01v4u.
  const { algorithm, publicKey } = coseKeyToPublicKey(authData.attestedCredential.coseKey);

  return {
    credentialId: authData.attestedCredential.credentialId,
    publicKeyJwk: publicKey.export({ format: "jwk" }) as Record<string, unknown>,
    algorithm,
    signCount: authData.signCount,
    aaguid: authData.attestedCredential.aaguid,
    attestationFormat: format,
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
