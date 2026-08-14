// Behavior tests for the WebAuthn verifier (cave-brksh).
//
// These build REAL ceremonies rather than replaying captured fixtures: a
// genuine P-256 keypair signs a genuine authenticatorData||SHA256(clientData)
// payload, so a "valid" case is valid for the same reason a browser's is. That
// matters because the interesting assertions here are the REJECTIONS — a
// verifier that accepts everything also passes a fixture replay.

import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign as cryptoSign, randomBytes } from "node:crypto";
import { test } from "node:test";

import {
  base64UrlEncode,
  base64UrlDecode,
  checkSignCount,
  coseKeyToPublicKey,
  parseAuthenticatorData,
  verifyAssertion,
  verifyRegistration,
  WebAuthnError,
  type WebAuthnFailureReason,
} from "./webauthn-verify.ts";
import { decodeCbor, decodeCborItem, CborError } from "./webauthn-cbor.ts";

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
