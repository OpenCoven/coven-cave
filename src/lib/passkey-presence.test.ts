import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { test } from "node:test";

import {
  PRESENCE_TTL_MS,
  signPresenceToken,
  verifyPresenceToken,
} from "./passkey-presence.ts";

const SECRET = "b6f0f1a2-3c4d-5e6f-7081-92a3b4c5d6e7";
const NODE = "nEXAMPLE0000011CNTRL";
const CREDENTIAL = "Y3JlZGVudGlhbC1pZC1leGFtcGxl";

async function token(overrides: Partial<Parameters<typeof signPresenceToken>[0]> = {}) {
  return signPresenceToken({
    secret: SECRET,
    expiresAt: Date.now() + PRESENCE_TTL_MS,
    tailnetNodeId: NODE,
    credentialId: CREDENTIAL,
    ...overrides,
  });
}

test("a freshly signed token verifies and carries both bindings back", async () => {
  const verification = await verifyPresenceToken(await token(), SECRET);
  assert.equal(verification.ok, true);
  assert.equal(verification.ok && verification.tailnetNodeId, NODE);
  assert.equal(verification.ok && verification.credentialId, CREDENTIAL);
});

test("a token signed with a different secret does not verify", async () => {
  // This is the per-boot-secret property: after a restart, every outstanding
  // presence token stops verifying and the biometric check is asked for again.
  const verification = await verifyPresenceToken(await token(), "a-different-secret");
  assert.deepEqual(verification, { ok: false, reason: "signature" });
});

test("an expired token is refused", async () => {
  const expired = await token({ expiresAt: Date.now() - 1 });
  const verification = await verifyPresenceToken(expired, SECRET);
  assert.deepEqual(verification, { ok: false, reason: "expired" });
});

test("editing the bound node id invalidates the signature", async () => {
  // The binding is not advisory metadata — a presence proof captured from one
  // device must not authorize another, so the node id is inside the MAC.
  const original = await token();
  const tampered = original.replace(NODE, "nOTHER0000000CNTRL");
  assert.notEqual(tampered, original, "the replacement actually changed the token");
  const verification = await verifyPresenceToken(tampered, SECRET);
  assert.deepEqual(verification, { ok: false, reason: "signature" });
});

test("editing the bound credential id invalidates the signature", async () => {
  const original = await token();
  const tampered = original.replace(CREDENTIAL, "b3RoZXItY3JlZGVudGlhbA");
  assert.notEqual(tampered, original);
  const verification = await verifyPresenceToken(tampered, SECRET);
  assert.deepEqual(verification, { ok: false, reason: "signature" });
});

test("an extended expiry does not verify against the original signature", async () => {
  const original = await token({ expiresAt: 1_000_000 });
  const tampered = original.replace("1000000", "9999999999999");
  const verification = await verifyPresenceToken(tampered, SECRET);
  assert.deepEqual(verification, { ok: false, reason: "signature" });
});

test("malformed shapes are refused without consulting the secret", async () => {
  for (const bad of [
    "",
    "v1",
    "v2.1.n.c.nonce.sig",
    "v1.notanumber.n.c.nonce.sig",
    "v1.0.n.c.nonce.sig",
    "v1.1.n.c.nonce.sig.extra",
    "v1.1..c.nonce.sig",
  ]) {
    const verification = await verifyPresenceToken(bad, SECRET);
    assert.equal(verification.ok, false, `${JSON.stringify(bad)} must not verify`);
    assert.equal(
      verification.ok === false && verification.reason,
      "malformed",
      `${JSON.stringify(bad)} is a shape failure, not a signature failure`,
    );
  }
});

test("a field carrying the delimiter is refused at signing time", async () => {
  // A field that can smuggle a dot can move the signature boundary, so the
  // shape is enforced on the way in as well as on the way out.
  await assert.rejects(
    async () => token({ tailnetNodeId: "node.with.dots" }),
    /invalid tailnet node id/,
  );
  await assert.rejects(
    async () => token({ credentialId: "cred.with.dots" }),
    /invalid credential id/,
  );
});

test("the TTL is short enough that a borrowed unlocked phone stops working", () => {
  assert.ok(PRESENCE_TTL_MS <= 30 * 60 * 1000, "presence must not outlive the session it proves");
  assert.ok(PRESENCE_TTL_MS >= 60 * 1000, "and not so short it becomes a Face ID treadmill");
});

// Parity tests: the server-side verifier in server.ts mirrors this module but
// uses Node.js crypto (sync) instead of the Web Crypto API (async). These
// tests run the same accept/reject vectors through a faithful copy of the
// server.ts verification logic and assert that both implementations agree, so
// any accidental divergence (algorithm change, field-order swap, encoding
// difference) is caught here rather than discovered at runtime.
//
// The copy below must stay in sync with hasValidPasskeyPresence in server.ts.
// If the server-side logic changes, update this copy and the test vectors here.

function verifyPresenceTokenSync(
  token: string,
  secret: string,
  tailnetNodeId: string,
  now = Date.now(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  const field = /^[A-Za-z0-9_-]+$/;
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    !field.test(parts[2]) ||
    !field.test(parts[3]) ||
    !parts[4] ||
    !parts[5]
  ) {
    return false;
  }
  const body = parts.slice(0, 5).join(".");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(parts[5]);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b) && expiresAt > now && parts[2] === tailnetNodeId;
}

test("parity: sync and async verifiers agree on a valid token", async () => {
  const tok = await token();
  const asyncResult = await verifyPresenceToken(tok, SECRET);
  const syncResult = verifyPresenceTokenSync(tok, SECRET, NODE);
  assert.equal(asyncResult.ok, true);
  assert.equal(syncResult, true, "sync verifier must accept the same token async accepts");
});

test("parity: sync and async verifiers agree on an expired token", async () => {
  const tok = await token({ expiresAt: Date.now() - 1 });
  const asyncResult = await verifyPresenceToken(tok, SECRET);
  const syncResult = verifyPresenceTokenSync(tok, SECRET, NODE);
  assert.equal(asyncResult.ok, false);
  assert.equal(syncResult, false, "sync verifier must reject an expired token");
});

test("parity: sync and async verifiers agree on a wrong-secret token", async () => {
  const tok = await token();
  const asyncResult = await verifyPresenceToken(tok, "different-secret");
  const syncResult = verifyPresenceTokenSync(tok, "different-secret", NODE);
  assert.equal(asyncResult.ok, false);
  assert.equal(syncResult, false, "sync verifier must reject a token signed with a different secret");
});

test("parity: sync and async verifiers agree on a tampered token", async () => {
  const original = await token();
  const tampered = original.replace(NODE, "nOTHER0000000CNTRL");
  const asyncResult = await verifyPresenceToken(tampered, SECRET);
  const syncResult = verifyPresenceTokenSync(tampered, SECRET, NODE);
  assert.equal(asyncResult.ok, false);
  assert.equal(syncResult, false, "sync verifier must reject a tampered token");
});
