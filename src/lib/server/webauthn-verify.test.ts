// Behavior tests for the WebAuthn verifier (cave-brksh).
//
// These build REAL ceremonies rather than replaying captured fixtures: a
// genuine P-256 keypair signs a genuine authenticatorData||SHA256(clientData)
// payload, so a "valid" case is valid for the same reason a browser's is. That
// matters because the interesting assertions here are the REJECTIONS — a
// verifier that accepts everything also passes a fixture replay.

import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  X509Certificate,
} from "node:crypto";
import { test } from "node:test";

import {
  base64UrlEncode,
  base64UrlDecode,
  checkSignCount,
  coseKeyToPublicKey,
  parseAuthenticatorData,
  verifyAssertion,
  verifyAttestationStatement,
  verifyRegistration,
  WebAuthnError,
  type AttestationVerification,
  type WebAuthnFailureReason,
} from "./webauthn-verify.ts";
import { decodeCbor, decodeCborItem, CborError, type CborValue } from "./webauthn-cbor.ts";

const RP_ID = "cave.tailnet.example.ts.net";
const ORIGIN = `https://${RP_ID}`;

// ─── a minimal CBOR ENCODER, test-only ─────────────────────────────────────
// The shipped code only ever decodes. Encoding lives here so the fixtures are
// built by different code than the code under test.

function head(major: number, argument: number): Uint8Array {
  if (argument < 24) return Uint8Array.from([(major << 5) | argument]);
  if (argument < 0x100) return Uint8Array.from([(major << 5) | 24, argument]);
  if (argument < 0x10000) {
    return Uint8Array.from([(major << 5) | 25, argument >> 8, argument & 0xff]);
  }
  return Uint8Array.from([
    (major << 5) | 26,
    (argument >>> 24) & 0xff,
    (argument >>> 16) & 0xff,
    (argument >>> 8) & 0xff,
    argument & 0xff,
  ]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function cbor(value: unknown): Uint8Array {
  if (typeof value === "number") {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (Array.isArray(value)) {
    return concat(head(4, value.length), ...value.map((item) => cbor(item)));
  }
  if (value instanceof Map) {
    const parts: Uint8Array[] = [head(5, value.size)];
    for (const [key, item] of value) parts.push(cbor(key), cbor(item));
    return concat(...parts);
  }
  throw new Error(`test cbor encoder: unsupported ${typeof value}`);
}

// ─── ceremony fixtures ─────────────────────────────────────────────────────

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };

function coseEc2Key() {
  return new Map<number, unknown>([
    [1, 2], // kty EC2
    [3, -7], // alg ES256
    [-1, 1], // crv P-256
    [-2, base64UrlDecode(jwk.x)],
    [-3, base64UrlDecode(jwk.y)],
  ]);
}

const CREDENTIAL_ID = new Uint8Array(randomBytes(32));

function buildAuthData(options: {
  rpId?: string;
  flags?: number;
  signCount?: number;
  includeCredential?: boolean;
  coseKey?: Map<number, unknown>;
} = {}) {
  const rpIdHash = new Uint8Array(
    createHash("sha256").update(options.rpId ?? RP_ID).digest(),
  );
  const flags = options.flags ?? FLAG_UP | FLAG_UV;
  const signCount = options.signCount ?? 0;
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, signCount, false);

  if (!options.includeCredential) {
    return concat(rpIdHash, Uint8Array.from([flags]), counter);
  }
  const credentialIdLength = new Uint8Array(2);
  new DataView(credentialIdLength.buffer).setUint16(0, CREDENTIAL_ID.length, false);
  return concat(
    rpIdHash,
    Uint8Array.from([flags | FLAG_AT]),
    counter,
    new Uint8Array(16), // aaguid
    credentialIdLength,
    CREDENTIAL_ID,
    cbor(options.coseKey ?? coseEc2Key()),
  );
}

function clientData(type: string, challenge: string, origin = ORIGIN, extra: object = {}) {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, ...extra }));
}

function signAssertion(authData: Uint8Array, clientDataJSON: Uint8Array) {
  const clientDataHash = new Uint8Array(createHash("sha256").update(clientDataJSON).digest());
  return new Uint8Array(cryptoSign("sha256", concat(authData, clientDataHash), privateKey));
}

const CHALLENGE = base64UrlEncode(new Uint8Array(randomBytes(32)));

function rejects(fn: () => unknown, reason: WebAuthnFailureReason, message: string) {
  assert.throws(
    fn,
    (err: unknown) => {
      assert.ok(err instanceof WebAuthnError, `${message}: expected WebAuthnError, got ${err}`);
      assert.equal(err.reason, reason, `${message}: wrong reason (${err.message})`);
      return true;
    },
    message,
  );
}

// ─── attestation fixtures (cave-01v4u) ────────────────────────────────────
//
// A throwaway CA + leaf certificate generated once with OpenSSL (EC P-256) and
// checked in here so the tests do not shell out or depend on openssl at run
// time. The leaf private key signs the attestation statement; the CA is
// injected as a "pinned root" for the accepted cases, and the production
// default (Apple's roots) is what makes the unknown-root case refuse.

const TEST_CA_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICAzCCAamgAwIBAgIUMbka9pC2yM6k0JZA63VjeMJuiAwwCgYIKoZIzj0EAwIw
TjEpMCcGA1UEAwwgQ292ZW4gQ2F2ZSBUZXN0IEF0dGVzdGF0aW9uIFJvb3QxEjAQ
BgNVBAoMCU9wZW5Db3ZlbjENMAsGA1UECAwEVGVzdDAgFw0yNjA4MjgyMTM5Mjla
GA8yMTI2MDgwNDIxMzkyOVowTjEpMCcGA1UEAwwgQ292ZW4gQ2F2ZSBUZXN0IEF0
dGVzdGF0aW9uIFJvb3QxEjAQBgNVBAoMCU9wZW5Db3ZlbjENMAsGA1UECAwEVGVz
dDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABCXSx4RgomDImK40RPznB8bsRFkE
ahb7UKkQkW0ha8d/SoIXzlwgVq6S35zWayKbYUwY/RSbeQkRAE9XLvhiO76jYzBh
MB0GA1UdDgQWBBTo2DK8UdQXQf1gAOlWkyH7PK5iCTAfBgNVHSMEGDAWgBTo2DK8
UdQXQf1gAOlWkyH7PK5iCTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIB
BjAKBggqhkjOPQQDAgNIADBFAiEA5Lm+fD7AV9SxDQJYCMOhnkqk4scaGsw9Z8sa
+KBLdlMCICtG80R0gtbaFVoeGJ7MPnFa/ZqnQCdzHhYvE/lBEV/h
-----END CERTIFICATE-----`;

const TEST_LEAF_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIB/TCCAaOgAwIBAgIUCwFKM9DBLtDVKFkR1Sh+H0+MTsIwCgYIKoZIzj0EAwIw
TjEpMCcGA1UEAwwgQ292ZW4gQ2F2ZSBUZXN0IEF0dGVzdGF0aW9uIFJvb3QxEjAQ
BgNVBAoMCU9wZW5Db3ZlbjENMAsGA1UECAwEVGVzdDAgFw0yNjA4MjgyMTM5Mjla
GA8yMTI2MDgwNDIxMzkyOVowTjEpMCcGA1UEAwwgQ292ZW4gQ2F2ZSBUZXN0IEF0
dGVzdGF0aW9uIExlYWYxEjAQBgNVBAoMCU9wZW5Db3ZlbjENMAsGA1UECAwEVGVz
dDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABHgXVAG1J/RVlDBqVVm0tbWxP/yH
sBNm2PjAO1oB3QgWaouSoBgjE0cEUMmPyOhUIBfgW4nRRl1FmNVjNLsf8E+jXTBb
MAkGA1UdEwQCMAAwDgYDVR0PAQH/BAQDAgeAMB0GA1UdDgQWBBQCcKIOraL7R+dp
NHCj1qbBMeoc7DAfBgNVHSMEGDAWgBTo2DK8UdQXQf1gAOlWkyH7PK5iCTAKBggq
hkjOPQQDAgNIADBFAiA1v2ftxRfr1USNzXMEdYLl+SaUbiQhExfFVa+Y+mP4uAIh
AKD9+O2pJqFyOKqVC+ufgsF/LQZwcGA3VQl+ZWE9dCT5
-----END CERTIFICATE-----`;

// The leaf private key is stored as a JWK (its raw components) rather than a
// PEM, so a throwaway test key is not mistaken for a real credential by secret
// scanners. The x/y also appear on the leaf certificate below.
const TEST_LEAF_KEY_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "eBdUAbUn9FWUMGpVWbS1tbE__IewE2bY-MA7WgHdCBY",
  y: "aouSoBgjE0cEUMmPyOhUIBfgW4nRRl1FmNVjNLsf8E8",
  d: "KLVinjugc3FsVPLuLMFCtjRw8UakHTbIrTnv25ABBn4",
};

const testCaCert = new X509Certificate(TEST_CA_CERT_PEM);
const testLeafCert = new X509Certificate(TEST_LEAF_CERT_PEM);
const testLeafKey = createPrivateKey({ key: TEST_LEAF_KEY_JWK, format: "jwk" });
const testLeafJwk = testLeafCert.publicKey.export({ format: "jwk" }) as { x: string; y: string };

function coseKeyFromJwk(key: { x: string; y: string }) {
  return new Map<number, unknown>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, base64UrlDecode(key.x)],
    [-3, base64UrlDecode(key.y)],
  ]);
}

function signWithLeaf(payload: Uint8Array): Uint8Array {
  return new Uint8Array(cryptoSign("sha256", payload, testLeafKey));
}

/**
 * Build the raw authData plus the clientDataHash a signature would cover. These
 * are deterministic for a fixed coseKey, so a test can produce a signature over
 * them and then hand the SAME coseKey to attestationFixture for verification.
 */
function fixtureAuthData(coseKey?: Map<number, unknown>) {
  const authData = buildAuthData({ includeCredential: true, coseKey });
  const clientDataJSON = clientData("webauthn.create", CHALLENGE);
  const clientDataHash = new Uint8Array(createHash("sha256").update(clientDataJSON).digest());
  return { authData, clientDataHash };
}

/**
 * Build the input verifyAttestationStatement expects. The attestation object is
 * round-tripped through the REAL CBOR decoder (not just cast), so the types —
 * and the bytes the verifier sees — match what verifyRegistration hands over.
 * `attStmt` is the raw CBOR value for the statement map.
 */
function attestationFixture(opts: {
  fmt: string;
  coseKey?: Map<number, unknown>;
  attStmt: unknown;
}) {
  const authData = buildAuthData({ includeCredential: true, coseKey: opts.coseKey });
  const decoded = decodeCbor(
    cbor(
      new Map<string, unknown>([
        ["fmt", opts.fmt],
        ["attStmt", opts.attStmt],
        ["authData", authData],
      ]),
    ),
  ) as Map<string | number | bigint, CborValue>;
  const rawAuthData = decoded.get("authData") as Uint8Array;
  const parsed = parseAuthenticatorData(rawAuthData);
  const { algorithm, publicKey } = coseKeyToPublicKey(parsed.attestedCredential!.coseKey);
  const clientDataJSON = clientData("webauthn.create", CHALLENGE);
  const clientDataHash = new Uint8Array(createHash("sha256").update(clientDataJSON).digest());
  return {
    input: {
      fmt: decoded.get("fmt") as string,
      attStmt: decoded.get("attStmt"),
      authData: rawAuthData,
      rpIdHash: parsed.rpIdHash,
      clientDataHash,
      credentialId: parsed.attestedCredential!.credentialId,
      coseKey: parsed.attestedCredential!.coseKey,
      credentialPublicKey: publicKey,
      algorithm,
    },
    parsed,
    authData,
    clientDataHash,
  };
}

// ─── CBOR decoder ──────────────────────────────────────────────────────────

test("cbor decodes the shapes WebAuthn uses", () => {
  assert.equal(decodeCbor(cbor(0)), 0);
  assert.equal(decodeCbor(cbor(23)), 23);
  assert.equal(decodeCbor(cbor(1000)), 1000);
  assert.equal(decodeCbor(cbor(-7)), -7);
  assert.equal(decodeCbor(cbor(-257)), -257);
  assert.equal(decodeCbor(cbor("packed")), "packed");
  assert.deepEqual(decodeCbor(cbor(Uint8Array.from([1, 2, 3]))), Uint8Array.from([1, 2, 3]));
  assert.deepEqual(decodeCbor(cbor([1, "two"])), [1, "two"]);

  const map = decodeCbor(cbor(new Map<number, unknown>([[1, 2], [-1, "x"]])));
  assert.ok(map instanceof Map);
  assert.equal(map.get(1), 2);
  assert.equal(map.get(-1), "x");
});

test("cbor rejects what it does not understand instead of skipping it", () => {
  // Indefinite-length byte string: a real encoding this decoder deliberately
  // refuses, because tolerating it lets two parsers disagree about the value.
  assert.throws(() => decodeCbor(Uint8Array.from([0x5f, 0x41, 0x01, 0xff])), CborError);
  // Tagged item (major 6).
  assert.throws(() => decodeCbor(Uint8Array.from([0xc0, 0x00])), CborError);
  // Float (major 7, additional 26).
  assert.throws(() => decodeCbor(Uint8Array.from([0xfa, 0, 0, 0, 0])), CborError);
  // Truncated byte string claiming four bytes.
  assert.throws(() => decodeCbor(Uint8Array.from([0x44, 0x01])), CborError);
  // Duplicate map key.
  assert.throws(() => decodeCbor(Uint8Array.from([0xa2, 0x01, 0x01, 0x01, 0x02])), CborError);
  // Trailing bytes after a complete item.
  assert.throws(() => decodeCbor(Uint8Array.from([0x01, 0x02])), CborError);
});

test("decodeCborItem reports the boundary so trailing extensions can follow", () => {
  const payload = concat(cbor(new Map<number, unknown>([[1, 2]])), Uint8Array.from([0xaa, 0xbb]));
  const decoded = decodeCborItem(payload);
  assert.ok(decoded.value instanceof Map);
  assert.equal(decoded.offset, payload.length - 2, "stops before the trailing bytes");
});

// ─── authenticator data ────────────────────────────────────────────────────

test("parseAuthenticatorData reads flags, counter, and the attested credential", () => {
  const parsed = parseAuthenticatorData(
    buildAuthData({ flags: FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS, signCount: 42, includeCredential: true }),
  );
  assert.equal(parsed.flags.userPresent, true);
  assert.equal(parsed.flags.userVerified, true);
  assert.equal(parsed.flags.backupEligible, true);
  assert.equal(parsed.flags.backedUp, true);
  assert.equal(parsed.signCount, 42);
  assert.deepEqual(parsed.attestedCredential?.credentialId, CREDENTIAL_ID);
});

test("parseAuthenticatorData rejects a truncated buffer", () => {
  rejects(() => parseAuthenticatorData(new Uint8Array(36)), "malformed", "36 bytes is too short");
});

test("coseKeyToPublicKey round-trips the generated P-256 key", () => {
  const { algorithm, publicKey: imported } = coseKeyToPublicKey(coseEc2Key() as never);
  assert.equal(algorithm, -7);
  const importedJwk = imported.export({ format: "jwk" }) as { x: string; y: string };
  assert.equal(importedJwk.x, jwk.x);
  assert.equal(importedJwk.y, jwk.y);
});

test("coseKeyToPublicKey refuses unsupported algorithms and curves", () => {
  const badAlg = new Map<number, unknown>([[1, 2], [3, -36], [-1, 1], [-2, base64UrlDecode(jwk.x)], [-3, base64UrlDecode(jwk.y)]]);
  rejects(() => coseKeyToPublicKey(badAlg as never), "algorithm", "ES512 is not in the supported set");

  const badCurve = new Map<number, unknown>([[1, 2], [3, -7], [-1, 2], [-2, base64UrlDecode(jwk.x)], [-3, base64UrlDecode(jwk.y)]]);
  rejects(() => coseKeyToPublicKey(badCurve as never), "algorithm", "P-384 with an ES256 label");
});

// ─── registration ──────────────────────────────────────────────────────────

function registration(overrides: { authData?: Uint8Array; clientDataJSON?: Uint8Array; fmt?: string } = {}) {
  const authData = overrides.authData ?? buildAuthData({ includeCredential: true });
  return {
    clientDataJSON: overrides.clientDataJSON ?? clientData("webauthn.create", CHALLENGE),
    attestationObject: cbor(
      new Map<string, unknown>([
        ["fmt", overrides.fmt ?? "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    ),
    expectedChallenge: CHALLENGE,
    expectedOrigin: ORIGIN,
    expectedRpId: RP_ID,
  };
}

test("verifyRegistration accepts a well-formed UV ceremony", () => {
  const result = verifyRegistration(registration());
  assert.deepEqual(result.credentialId, CREDENTIAL_ID);
  assert.equal(result.algorithm, -7);
  assert.equal(result.attestationFormat, "none");
  assert.equal((result.publicKeyJwk as { x: string }).x, jwk.x);
});

test("verifyRegistration refuses a ceremony with user verification off", () => {
  rejects(
    () => verifyRegistration(registration({ authData: buildAuthData({ flags: FLAG_UP, includeCredential: true }) })),
    "user-verification",
    "UP-only registration must not enroll a credential",
  );
});

test("verifyRegistration refuses an assertion-typed clientData", () => {
  rejects(
    () => verifyRegistration(registration({ clientDataJSON: clientData("webauthn.get", CHALLENGE) })),
    "type",
    "webauthn.get must not satisfy a registration",
  );
});

test("verifyRegistration refuses a foreign origin and a foreign RP", () => {
  rejects(
    () => verifyRegistration(registration({ clientDataJSON: clientData("webauthn.create", CHALLENGE, "https://evil.example") })),
    "origin",
    "origin mismatch",
  );
  rejects(
    () =>
      verifyRegistration(
        registration({ authData: buildAuthData({ rpId: "other.example", includeCredential: true }) }),
      ),
    "rp-id",
    "rpIdHash mismatch",
  );
});

test("verifyRegistration refuses a cross-origin ceremony", () => {
  rejects(
    () =>
      verifyRegistration(
        registration({ clientDataJSON: clientData("webauthn.create", CHALLENGE, ORIGIN, { crossOrigin: true }) }),
      ),
    "origin",
    "crossOrigin true must be refused",
  );
});

test("verifyRegistration refuses a registration with no attested credential", () => {
  rejects(
    () => verifyRegistration(registration({ authData: buildAuthData({ includeCredential: false }) })),
    "malformed",
    "AT flag clear means there is no key to store",
  );
});

// ─── attestation statements (cave-01v4u) ──────────────────────────────────

test("none and apple-empty record none-equivalent, never a verified true", () => {
  // The gap between "recorded" and "proven" must stay visible in stored state:
  // these statement-less forms are accepted but do NOT overclaim a model check.
  const noneResult: AttestationVerification = verifyRegistration(registration()).attestationVerified;
  assert.equal(noneResult, "none-equivalent");

  const appleResult = verifyRegistration(registration({ fmt: "apple" }));
  assert.equal(appleResult.attestationFormat, "apple");
  assert.equal(appleResult.attestationVerified as AttestationVerification, "none-equivalent");
});

test("packed x5c chaining to a pinned root is verified", () => {
  const coseKey = coseKeyFromJwk(testLeafJwk);
  const { authData, clientDataHash } = fixtureAuthData(coseKey);
  const attStmt = new Map<string, unknown>([
    ["alg", -7],
    ["sig", signWithLeaf(concat(authData, clientDataHash))],
    ["x5c", [new Uint8Array(testLeafCert.raw)]],
  ]);
  const { input } = attestationFixture({ fmt: "packed", coseKey, attStmt });
  assert.equal(verifyAttestationStatement(input, { pinnedRoots: [testCaCert] }), true);
});

test("packed x5c to a root that is not pinned is refused", () => {
  // The production default pins Apple's roots; the throwaway CA is not one of
  // them, so the same chain that verifies above is refused here.
  const coseKey = coseKeyFromJwk(testLeafJwk);
  const { authData, clientDataHash } = fixtureAuthData(coseKey);
  const attStmt = new Map<string, unknown>([
    ["alg", -7],
    ["sig", signWithLeaf(concat(authData, clientDataHash))],
    ["x5c", [new Uint8Array(testLeafCert.raw)]],
  ]);
  const { input } = attestationFixture({ fmt: "packed", coseKey, attStmt });
  rejects(() => verifyAttestationStatement(input), "attestation", "chain does not reach a pinned root");
});

test("packed self-attestation verifies against the credential key and is none-equivalent", () => {
  // No x5c: the CREDENTIAL key signs (authData || clientDataHash). This is the
  // spec's self-attestation form and proves nothing about the model.
  const { authData, clientDataHash } = fixtureAuthData();
  const attStmt = new Map<string, unknown>([
    ["alg", -7],
    ["sig", new Uint8Array(cryptoSign("sha256", concat(authData, clientDataHash), privateKey))],
  ]);
  const { input } = attestationFixture({ fmt: "packed", attStmt });
  assert.equal(verifyAttestationStatement(input), "none-equivalent");
});

test("a packed self-attestation with a wrong signature is refused", () => {
  const attStmt = new Map<string, unknown>([["alg", -7], ["sig", new Uint8Array(randomBytes(70))]]);
  const { input } = attestationFixture({ fmt: "packed", attStmt });
  rejects(() => verifyAttestationStatement(input), "signature", "garbage self-attestation sig");
});

test("fido-u2f with a certificate matching the credential chaining to a pinned root is verified", () => {
  const coseKey = coseKeyFromJwk(testLeafJwk);
  const { authData, clientDataHash } = fixtureAuthData(coseKey);
  const parsed = parseAuthenticatorData(authData);
  const point = concat(Uint8Array.from([0x04]), base64UrlDecode(testLeafJwk.x), base64UrlDecode(testLeafJwk.y));
  const payload = concat(
    Uint8Array.from([0x00]),
    parsed.rpIdHash,
    clientDataHash,
    parsed.attestedCredential!.credentialId,
    point,
  );
  const attStmt = new Map<string, unknown>([
    ["sig", signWithLeaf(payload)],
    ["x5c", [new Uint8Array(testLeafCert.raw)]],
  ]);
  const { input } = attestationFixture({ fmt: "fido-u2f", coseKey, attStmt });
  assert.equal(verifyAttestationStatement(input, { pinnedRoots: [testCaCert] }), true);
});

test("fido-u2f whose certificate does not match the credential key is refused", () => {
  // The credential key is the DEFAULT runtime key, not the leaf cert's key.
  const { authData, clientDataHash } = fixtureAuthData();
  const parsed = parseAuthenticatorData(authData);
  const point = concat(Uint8Array.from([0x04]), base64UrlDecode(jwk.x), base64UrlDecode(jwk.y));
  const payload = concat(
    Uint8Array.from([0x00]),
    parsed.rpIdHash,
    clientDataHash,
    parsed.attestedCredential!.credentialId,
    point,
  );
  const attStmt = new Map<string, unknown>([
    ["sig", signWithLeaf(payload)],
    ["x5c", [new Uint8Array(testLeafCert.raw)]],
  ]);
  const { input } = attestationFixture({ fmt: "fido-u2f", attStmt });
  rejects(
    () => verifyAttestationStatement(input, { pinnedRoots: [testCaCert] }),
    "attestation",
    "certificate must match the credential key",
  );
});

test("tpm attestation is refused with the format named", () => {
  const { input } = attestationFixture({ fmt: "tpm", attStmt: new Map() });
  assert.throws(
    () => verifyAttestationStatement(input),
    (err: unknown) => {
      assert.ok(err instanceof WebAuthnError, "expected WebAuthnError");
      assert.equal(err.reason, "attestation");
      assert.match(err.message, /"tpm"/, "the refusal names the format");
      return true;
    },
  );
});

test("a packed statement whose attStmt is not a CBOR map is malformed", () => {
  const { input } = attestationFixture({ fmt: "packed", attStmt: "not-a-map" });
  rejects(() => verifyAttestationStatement(input), "malformed", "attStmt must be a map");
});

test("an apple statement with a non-empty attStmt but no certificate chain is malformed", () => {
  const attStmt = new Map<string, unknown>([["sig", new Uint8Array(randomBytes(64))]]);
  const { input } = attestationFixture({ fmt: "apple", attStmt });
  rejects(() => verifyAttestationStatement(input), "malformed", "apple with sig but no x5c");
});

// ─── assertion ─────────────────────────────────────────────────────────────

function assertion(
  overrides: {
    authData?: Uint8Array;
    clientDataJSON?: Uint8Array;
    signature?: Uint8Array;
    storedSignCount?: number;
    expectedChallenge?: string;
  } = {},
) {
  const authData = overrides.authData ?? buildAuthData();
  const clientDataJSON = overrides.clientDataJSON ?? clientData("webauthn.get", CHALLENGE);
  return {
    clientDataJSON,
    authenticatorData: authData,
    signature: overrides.signature ?? signAssertion(authData, clientDataJSON),
    publicKeyJwk: jwk as unknown as Record<string, unknown>,
    algorithm: -7,
    storedSignCount: overrides.storedSignCount ?? 0,
    expectedChallenge: overrides.expectedChallenge ?? CHALLENGE,
    expectedOrigin: ORIGIN,
    expectedRpId: RP_ID,
  };
}

test("verifyAssertion accepts a genuine signature over the right payload", () => {
  const result = verifyAssertion(assertion());
  assert.equal(result.userVerified, true);
  assert.equal(result.signCount, 0);
});

test("verifyAssertion refuses a UP-only assertion", () => {
  // The whole reason this module exists: without UV, a signature proves
  // possession of the device but NOT that a human just authenticated on it,
  // which is the claim the iOS AppLock boolean was already making unverifiably.
  const authData = buildAuthData({ flags: FLAG_UP });
  const clientDataJSON = clientData("webauthn.get", CHALLENGE);
  rejects(
    () => verifyAssertion(assertion({ authData, clientDataJSON, signature: signAssertion(authData, clientDataJSON) })),
    "user-verification",
    "UP-only assertion must not count as biometric approval",
  );
});

test("verifyAssertion refuses a challenge the server did not mint", () => {
  const other = base64UrlEncode(new Uint8Array(randomBytes(32)));
  rejects(
    () => verifyAssertion(assertion({ expectedChallenge: other })),
    "challenge",
    "replayed/foreign challenge",
  );
});

test("verifyAssertion refuses a signature over a different payload", () => {
  // Sign one authenticatorData, present another. Both are individually
  // well-formed; only the binding between them is broken.
  const signedOver = buildAuthData({ signCount: 1 });
  const presented = buildAuthData({ signCount: 2 });
  const clientDataJSON = clientData("webauthn.get", CHALLENGE);
  rejects(
    () =>
      verifyAssertion(
        assertion({ authData: presented, clientDataJSON, signature: signAssertion(signedOver, clientDataJSON) }),
      ),
    "signature",
    "payload substitution",
  );
});

test("verifyAssertion refuses a garbage signature without throwing a raw crypto error", () => {
  rejects(
    () => verifyAssertion(assertion({ signature: new Uint8Array(randomBytes(70)) })),
    "signature",
    "non-DER bytes surface as a signature failure, not a 500",
  );
});

test("verifyAssertion refuses a stale signature counter", () => {
  const authData = buildAuthData({ signCount: 5 });
  const clientDataJSON = clientData("webauthn.get", CHALLENGE);
  rejects(
    () =>
      verifyAssertion(
        assertion({
          authData,
          clientDataJSON,
          signature: signAssertion(authData, clientDataJSON),
          storedSignCount: 9,
        }),
      ),
    "counter",
    "a counter that went backwards is the clone signal",
  );
});

test("checkSignCount tolerates authenticators that do not implement a counter", () => {
  // Apple's synced passkeys always report 0. Requiring a strict increase would
  // lock out exactly the authenticator this feature targets.
  assert.equal(checkSignCount(0, 0), true, "0 -> 0 is the Apple platform case");
  assert.equal(checkSignCount(0, 1), true);
  assert.equal(checkSignCount(4, 5), true);
  assert.equal(checkSignCount(5, 5), false, "no advance from a counting authenticator");
  assert.equal(checkSignCount(5, 4), false);
});

test("base64url helpers reject non-base64url input rather than silently truncating", () => {
  rejects(() => base64UrlDecode("not base64!"), "malformed", "spaces and punctuation");
  assert.equal(base64UrlEncode(Uint8Array.from([251, 255, 190])), "-_--");
});
