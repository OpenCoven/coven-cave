// End-to-end tests for the passkey ceremonies (cave-brksh).
//
// These drive the real register → assert flow with real crypto, then attack it:
// a stolen challenge, a credential presented from the wrong device, a UP-only
// assertion, an unauthenticated peer, and — the one that matters most — an
// attempt to enroll a fresh credential as a way around the presence gate.

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const workdir = await mkdtemp(path.join(tmpdir(), "cave-passkey-ceremony-"));
process.env.COVEN_CAVE_PASSKEY_STORE_PATH = path.join(workdir, "passkeys.json");
process.env.COVEN_CAVE_TAILNET_PEER_SECRET = "tailnet-secret-for-test";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "local-secret-for-test";
process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET = "presence-secret-for-test";

const {
  LOCAL_PEER_ID,
  ceremonyContext,
  completeAssertion,
  completeRegistration,
  passkeyPresenceRequired,
  resolvePeerIdentity,
  startCeremony,
  verifyPeerPresence,
} = await import("./passkey-ceremony.ts");
const { listCredentials, resetChallengesForTest } = await import("./passkey-store.ts");
const { PRESENCE_TTL_MS } = await import("../passkey-presence.ts");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetChallengesForTest();
  await rm(process.env.COVEN_CAVE_PASSKEY_STORE_PATH!, { force: true });
  delete process.env.COVEN_CAVE_PASSKEY_REQUIRED;
});

// ─── fixtures ──────────────────────────────────────────────────────────────

const NODE = "nPHONE0000000CNTRL";
const OTHER_NODE = "nLAPTOP000000CNTRL";
const HOST = "cave.tailnet.example.ts.net";
const ORIGIN = `https://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return new Headers({ host: HOST, "x-forwarded-proto": "https", ...extra });
}

function tailnetHeaders(nodeId = NODE) {
  return headers({
    "x-coven-cave-tailnet-peer": `${process.env.COVEN_CAVE_TAILNET_PEER_SECRET}:${nodeId}`,
  });
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
const CREDENTIAL_ID = new Uint8Array(randomBytes(32));
const CREDENTIAL_ID_B64 = Buffer.from(CREDENTIAL_ID).toString("base64url");

function head(major: number, argument: number): Uint8Array {
  if (argument < 24) return Uint8Array.from([(major << 5) | argument]);
  if (argument < 0x100) return Uint8Array.from([(major << 5) | 24, argument]);
  return Uint8Array.from([(major << 5) | 25, argument >> 8, argument & 0xff]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function cbor(value: unknown): Uint8Array {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Map) {
    const parts: Uint8Array[] = [head(5, value.size)];
    for (const [key, item] of value) parts.push(cbor(key), cbor(item));
    return concat(...parts);
  }
  throw new Error("unsupported fixture value");
}

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

function authData({ flags = FLAG_UP | FLAG_UV, withCredential = false, signCount = 0 } = {}) {
  const rpIdHash = new Uint8Array(createHash("sha256").update(HOST).digest());
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, signCount, false);
  if (!withCredential) return concat(rpIdHash, Uint8Array.from([flags]), counter);

  const idLength = new Uint8Array(2);
  new DataView(idLength.buffer).setUint16(0, CREDENTIAL_ID.length, false);
  const cose = new Map<number, unknown>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
    [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
  ]);
  return concat(
    rpIdHash,
    Uint8Array.from([flags | FLAG_AT]),
    counter,
    new Uint8Array(16),
    idLength,
    CREDENTIAL_ID,
    cbor(cose),
  );
}

function clientData(type: string, challenge: string, origin = ORIGIN) {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));
}

async function enroll(nodeId = NODE, flags = FLAG_UP | FLAG_UV) {
  const peer = resolvePeerIdentity(tailnetHeaders(nodeId))!;
  const context = ceremonyContext(tailnetHeaders(nodeId), "https:")!;
  const { challenge } = await startCeremony("register", peer, context);
  const data = authData({ flags, withCredential: true });
  return completeRegistration({
    peer,
    context,
    challenge,
    clientDataJSON: b64(clientData("webauthn.create", challenge)),
    attestationObject: b64(
      cbor(
        new Map<string, unknown>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", data],
        ]),
      ),
    ),
    label: "Test iPhone",
  });
}

async function assertPresence(
  nodeId = NODE,
  { flags = FLAG_UP | FLAG_UV, credentialId = CREDENTIAL_ID_B64, signCount = 0 } = {},
) {
  const peer = resolvePeerIdentity(tailnetHeaders(nodeId))!;
  const context = ceremonyContext(tailnetHeaders(nodeId), "https:")!;
  const { challenge } = await startCeremony("assert", peer, context);
  const data = authData({ flags, signCount });
  const cdj = clientData("webauthn.get", challenge);
  const clientDataHash = new Uint8Array(createHash("sha256").update(cdj).digest());
  const signature = new Uint8Array(
    cryptoSign("sha256", concat(data, clientDataHash), privateKey),
  );
  return completeAssertion({
    peer,
    challenge,
    credentialId,
    clientDataJSON: b64(cdj),
    authenticatorData: b64(data),
    signature: b64(signature),
  });
}

// ─── peer identity ─────────────────────────────────────────────────────────

test("a verified tailnet stamp resolves to that node; a forged one does not", () => {
  assert.deepEqual(resolvePeerIdentity(tailnetHeaders()), { nodeId: NODE, kind: "tailnet" });
  assert.equal(
    resolvePeerIdentity(headers({ "x-coven-cave-tailnet-peer": `wrong-secret:${NODE}` })),
    null,
  );
  assert.equal(resolvePeerIdentity(headers()), null, "no stamp at all");
});

test("a verified loopback stamp resolves to the reserved local identity", () => {
  const local = resolvePeerIdentity(
    headers({ "x-coven-cave-local-peer": process.env.COVEN_CAVE_LOCAL_PEER_SECRET! }),
  );
  assert.deepEqual(local, { nodeId: LOCAL_PEER_ID, kind: "local" });
});

test("ceremonyContext strips the port from the RP ID but keeps it in the origin", () => {
  // WebAuthn forbids a port in the RP ID, while clientData.origin always
  // carries one on a non-standard port — comparing the wrong one fails every
  // ceremony on a dev server.
  const context = ceremonyContext(new Headers({ host: "localhost:3411" }), "http:");
  assert.deepEqual(context, { rpId: "localhost", origin: "http://localhost:3411" });
});

test("ceremonyContext prefers the forwarded scheme Tailscale Serve supplies", () => {
  // Serve terminates TLS and forwards over plaintext loopback, so the request
  // protocol says http while the browser's origin says https.
  const context = ceremonyContext(headers(), "http:");
  assert.deepEqual(context, { rpId: HOST, origin: ORIGIN });
});

test("ceremonyContext refuses a host that is not a plain host[:port]", () => {
  assert.equal(ceremonyContext(new Headers({ host: "evil/../x" }), "https:"), null);
  assert.equal(ceremonyContext(new Headers(), "https:"), null);
});

// ─── the happy path ────────────────────────────────────────────────────────

test("register then assert yields a presence token bound to the device", async () => {
  const registration = await enroll();
  assert.equal(registration.ok, true);
  assert.equal(registration.ok && registration.credential.credentialId, CREDENTIAL_ID_B64);
  assert.equal(registration.ok && registration.credential.tailnetNodeId, NODE);

  const assertion = await assertPresence();
  assert.equal(assertion.ok, true, assertion.ok ? "" : `failed: ${assertion.error}`);
  assert.ok(assertion.ok && assertion.expiresAt <= Date.now() + PRESENCE_TTL_MS);

  const peer = resolvePeerIdentity(tailnetHeaders())!;
  assert.equal(
    await verifyPeerPresence(assertion.ok ? assertion.presenceToken : "", peer),
    true,
  );
});

test("the presence token does not verify for a different device", async () => {
  await enroll();
  const assertion = await assertPresence();
  assert.ok(assertion.ok);
  const otherPeer = resolvePeerIdentity(tailnetHeaders(OTHER_NODE))!;
  assert.equal(
    await verifyPeerPresence(assertion.ok ? assertion.presenceToken : "", otherPeer),
    false,
    "a presence proof captured from one device must not authorize another",
  );
});

test("a successful assertion records the use on the stored credential", async () => {
  await enroll();
  assert.equal((await listCredentials(NODE))[0].lastUsedAt, null);
  await assertPresence(NODE, { signCount: 3 });
  const stored = (await listCredentials(NODE))[0];
  assert.equal(stored.signCount, 3);
  assert.ok(typeof stored.lastUsedAt === "number");
});

// ─── attacks ───────────────────────────────────────────────────────────────

test("an assertion without user verification is refused", async () => {
  await enroll();
  const assertion = await assertPresence(NODE, { flags: FLAG_UP });
  assert.equal(assertion.ok, false);
  assert.equal(!assertion.ok && assertion.error, "user-verification");
  assert.equal(!assertion.ok && assertion.status, 401);
});

test("registration without user verification is refused", async () => {
  const registration = await enroll(NODE, FLAG_UP);
  assert.equal(registration.ok, false);
  assert.equal(!registration.ok && registration.error, "user-verification");
});

test("a credential registered on one device cannot be asserted from another", async () => {
  await enroll(NODE);
  const assertion = await assertPresence(OTHER_NODE);
  assert.equal(assertion.ok, false);
  assert.equal(!assertion.ok && assertion.error, "credential not bound to this device");
  assert.equal(!assertion.ok && assertion.status, 403);
});

test("a challenge cannot be used twice", async () => {
  await enroll();
  const peer = resolvePeerIdentity(tailnetHeaders())!;
  const context = ceremonyContext(tailnetHeaders(), "https:")!;
  const { challenge } = await startCeremony("assert", peer, context);
  const data = authData();
  const cdj = clientData("webauthn.get", challenge);
  const clientDataHash = new Uint8Array(createHash("sha256").update(cdj).digest());
  const signature = new Uint8Array(cryptoSign("sha256", concat(data, clientDataHash), privateKey));
  const payload = {
    peer,
    challenge,
    credentialId: CREDENTIAL_ID_B64,
    clientDataJSON: b64(cdj),
    authenticatorData: b64(data),
    signature: b64(signature),
  };
  assert.equal((await completeAssertion(payload)).ok, true, "first use succeeds");
  const replay = await completeAssertion(payload);
  assert.equal(replay.ok, false, "replaying the identical assertion must fail");
  assert.equal(!replay.ok && replay.error, "unknown or expired challenge");
});

test("a challenge minted for one device cannot be completed by another", async () => {
  const peer = resolvePeerIdentity(tailnetHeaders())!;
  const context = ceremonyContext(tailnetHeaders(), "https:")!;
  const { challenge } = await startCeremony("register", peer, context);
  const otherPeer = resolvePeerIdentity(tailnetHeaders(OTHER_NODE))!;
  const stolen = await completeRegistration({
    peer: otherPeer,
    context,
    challenge,
    clientDataJSON: b64(clientData("webauthn.create", challenge)),
    attestationObject: b64(
      cbor(
        new Map<string, unknown>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData({ withCredential: true })],
        ]),
      ),
    ),
  });
  assert.equal(stolen.ok, false);
  assert.equal(!stolen.ok && stolen.error, "unknown or expired challenge");
});

test("startCeremony offers only the asking device's own credentials", async () => {
  await enroll(NODE);
  const otherPeer = resolvePeerIdentity(tailnetHeaders(OTHER_NODE))!;
  const context = ceremonyContext(tailnetHeaders(OTHER_NODE), "https:")!;
  const ceremony = await startCeremony("assert", otherPeer, context);
  assert.deepEqual(
    ceremony.allowCredentials,
    [],
    "listing every credential would tell one device which others are enrolled",
  );
});

test("enrolling a SECOND credential requires the first once presence is armed", async () => {
  // The endpoint that grants the second factor must not be a way around it.
  await enroll();
  process.env.COVEN_CAVE_PASSKEY_REQUIRED = "1";
  assert.equal(passkeyPresenceRequired(), true);

  const registration = await enroll();
  assert.equal(registration.ok, false);
  assert.equal(!registration.ok && registration.error, "existing passkey required to enroll another");
  assert.equal(!registration.ok && registration.status, 403);
});

test("bootstrapping the FIRST credential is allowed even with presence armed", async () => {
  // Otherwise arming the requirement locks the phone out of the very ceremony
  // that would satisfy it.
  process.env.COVEN_CAVE_PASSKEY_REQUIRED = "1";
  const registration = await enroll();
  assert.equal(registration.ok, true, registration.ok ? "" : `failed: ${registration.error}`);
});

test("a proven presence lets the same device enroll another credential", async () => {
  await enroll();
  const assertion = await assertPresence();
  assert.ok(assertion.ok);
  process.env.COVEN_CAVE_PASSKEY_REQUIRED = "1";

  const peer = resolvePeerIdentity(tailnetHeaders())!;
  const context = ceremonyContext(tailnetHeaders(), "https:")!;
  const { challenge } = await startCeremony("register", peer, context);
  const registration = await completeRegistration({
    peer,
    context,
    challenge,
    clientDataJSON: b64(clientData("webauthn.create", challenge)),
    attestationObject: b64(
      cbor(
        new Map<string, unknown>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData({ withCredential: true })],
        ]),
      ),
    ),
    presenceProven: true,
  });
  assert.equal(registration.ok, true, registration.ok ? "" : `failed: ${registration.error}`);
});

test("assertion is refused outright when no per-boot presence secret exists", async () => {
  // Minting a token nothing could later verify would hand back a credential
  // that silently never works.
  await enroll();
  const saved = process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  delete process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  try {
    const assertion = await assertPresence();
    assert.equal(assertion.ok, false);
    assert.equal(!assertion.ok && assertion.status, 503);
  } finally {
    process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET = saved;
  }
});

test("verifyPeerPresence rejects an empty or foreign token without throwing", async () => {
  const peer = resolvePeerIdentity(tailnetHeaders())!;
  assert.equal(await verifyPeerPresence(undefined, peer), false);
  assert.equal(await verifyPeerPresence("", peer), false);
  assert.equal(await verifyPeerPresence("v1.9999999999999.n.c.nonce.sig", peer), false);
});
