import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const workdir = await mkdtemp(path.join(tmpdir(), "cave-passkey-store-"));
process.env.COVEN_CAVE_PASSKEY_STORE_PATH = path.join(workdir, "passkeys.json");

const {
  CHALLENGE_TTL_MS,
  consumeChallenge,
  deleteCredential,
  findCredential,
  listCredentials,
  mintChallenge,
  passkeyStorePath,
  recordCredentialUse,
  resetChallengesForTest,
  saveCredential,
} = await import("./passkey-store.ts");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetChallengesForTest();
  await rm(passkeyStorePath(), { force: true });
});

const NODE_A = "nPHONE0000000CNTRL";
const NODE_B = "nLAPTOP000000CNTRL";

function credential(overrides: Partial<Parameters<typeof saveCredential>[0]> = {}) {
  return {
    credentialId: "Y3JlZC1vbmU",
    tailnetNodeId: NODE_A,
    rpId: "cave.tailnet.example.ts.net",
    origin: "https://cave.tailnet.example.ts.net",
    publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
    algorithm: -7,
    signCount: 0,
    aaguid: "AAAAAAAAAAAAAAAAAAAAAA",
    attestationFormat: "none",
    label: "iPhone",
    createdAt: 1_000,
    lastUsedAt: null,
    ...overrides,
  };
}

// ─── credentials ───────────────────────────────────────────────────────────

test("a saved credential is found only by the node that registered it", async () => {
  await saveCredential(credential());
  assert.ok(await findCredential("Y3JlZC1vbmU", NODE_A), "the registering node finds it");
  assert.equal(
    await findCredential("Y3JlZC1vbmU", NODE_B),
    null,
    "another tailnet device presenting the same credential id must miss",
  );
});

test("re-registering the same credential id replaces rather than duplicates", async () => {
  await saveCredential(credential({ label: "first" }));
  await saveCredential(credential({ label: "second" }));
  const all = await listCredentials();
  assert.equal(all.length, 1, "a duplicate would make lookup depend on array order");
  assert.equal(all[0].label, "second");
});

test("listCredentials filters by node when asked", async () => {
  await saveCredential(credential({ credentialId: "YQ", tailnetNodeId: NODE_A }));
  await saveCredential(credential({ credentialId: "Yg", tailnetNodeId: NODE_B }));
  assert.equal((await listCredentials()).length, 2);
  assert.deepEqual((await listCredentials(NODE_A)).map((c) => c.credentialId), ["YQ"]);
});

test("recordCredentialUse advances the counter but never rewinds it", async () => {
  await saveCredential(credential({ signCount: 7 }));
  await recordCredentialUse("Y3JlZC1vbmU", NODE_A, 9, 5_000);
  let stored = (await listCredentials())[0];
  assert.equal(stored.signCount, 9);
  assert.equal(stored.lastUsedAt, 5_000);

  await recordCredentialUse("Y3JlZC1vbmU", NODE_A, 3, 6_000);
  stored = (await listCredentials())[0];
  assert.equal(stored.signCount, 9, "a lower count could only come from a race");
});

test("recordCredentialUse ignores a credential bound to a different node", async () => {
  await saveCredential(credential({ signCount: 1 }));
  await recordCredentialUse("Y3JlZC1vbmU", NODE_B, 50, 5_000);
  assert.equal((await listCredentials())[0].signCount, 1);
});

test("deleteCredential reports whether it removed anything", async () => {
  await saveCredential(credential());
  assert.equal(await deleteCredential("Y3JlZC1vbmU"), true);
  assert.equal(await deleteCredential("Y3JlZC1vbmU"), false);
  assert.deepEqual(await listCredentials(), []);
});

test("an unreadable or malformed store reads as no credentials, never as an error", async () => {
  // This store only ever GRANTS authority, so failing closed is the same thing
  // as returning nothing — but it has to actually return rather than throw, or
  // a corrupt file becomes a 500 on every request instead of a locked door.
  await writeFile(passkeyStorePath(), "{ not json", "utf8");
  assert.deepEqual(await listCredentials(), []);
  await writeFile(passkeyStorePath(), JSON.stringify({ credentials: "nope" }), "utf8");
  assert.deepEqual(await listCredentials(), []);
});

test("entries that do not look like credentials are dropped on read", async () => {
  await writeFile(
    passkeyStorePath(),
    JSON.stringify({ version: 1, credentials: [credential(), { credentialId: "only-an-id" }] }),
    "utf8",
  );
  const all = await listCredentials();
  assert.equal(all.length, 1);
  assert.equal(all[0].credentialId, "Y3JlZC1vbmU");
});

test("the store is written as JSON at the configured path", async () => {
  await saveCredential(credential());
  const parsed = JSON.parse(await readFile(passkeyStorePath(), "utf8"));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.credentials[0].tailnetNodeId, NODE_A);
});

// ─── challenges ────────────────────────────────────────────────────────────

const CEREMONY = {
  purpose: "assert" as const,
  tailnetNodeId: NODE_A,
  rpId: "cave.tailnet.example.ts.net",
  origin: "https://cave.tailnet.example.ts.net",
};

test("a minted challenge can be consumed exactly once", async () => {
  const { challenge } = mintChallenge(CEREMONY, 1_000);
  assert.ok(consumeChallenge(challenge, { purpose: "assert", tailnetNodeId: NODE_A }, 1_100));
  assert.equal(
    consumeChallenge(challenge, { purpose: "assert", tailnetNodeId: NODE_A }, 1_200),
    null,
    "replay must find nothing",
  );
});

test("a challenge is consumed even when the attempt fails", async () => {
  // Consume-on-success-only would let an attacker retry a stolen challenge
  // until some other check happened to pass.
  const { challenge } = mintChallenge(CEREMONY, 1_000);
  assert.equal(
    consumeChallenge(challenge, { purpose: "assert", tailnetNodeId: NODE_B }, 1_100),
    null,
    "wrong node fails",
  );
  assert.equal(
    consumeChallenge(challenge, { purpose: "assert", tailnetNodeId: NODE_A }, 1_200),
    null,
    "and the failed attempt still burned it",
  );
});

test("an expired challenge is refused", async () => {
  const { challenge, expiresAt } = mintChallenge(CEREMONY, 1_000);
  assert.equal(expiresAt, 1_000 + CHALLENGE_TTL_MS);
  assert.equal(
    consumeChallenge(challenge, { purpose: "assert", tailnetNodeId: NODE_A }, expiresAt),
    null,
    "expiry is inclusive",
  );
});

test("a registration challenge cannot satisfy an assertion", async () => {
  const { challenge } = mintChallenge({ ...CEREMONY, purpose: "register" }, 1_000);
  assert.equal(
    consumeChallenge(challenge, { purpose: "assert", tailnetNodeId: NODE_A }, 1_100),
    null,
  );
});

test("challenges are unique and unguessable-length", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 64; index += 1) {
    const { challenge } = mintChallenge(CEREMONY, 1_000 + index);
    assert.equal(seen.has(challenge), false, "no repeats");
    seen.add(challenge);
    // 32 random bytes -> 43 base64url characters.
    assert.equal(challenge.length, 43);
  }
});

test("outstanding challenges are bounded so an abandoned ceremony cannot grow the map", () => {
  // Mint far more than the cap without consuming any; the earliest must be
  // evicted rather than retained forever.
  const first = mintChallenge(CEREMONY, 1_000).challenge;
  for (let index = 0; index < 300; index += 1) mintChallenge(CEREMONY, 1_000);
  assert.equal(
    consumeChallenge(first, { purpose: "assert", tailnetNodeId: NODE_A }, 1_100),
    null,
    "the oldest challenge was evicted",
  );
});
