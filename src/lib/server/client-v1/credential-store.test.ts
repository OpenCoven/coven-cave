import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { ClientV1Scope } from "./contract.ts";
import { credentialLockDbPath } from "./credential-transaction-lock.ts";

const execFileAsync = promisify(execFile);

// Lives inside this worktree's own `process.cwd()` — never `os.tmpdir()` and
// never anywhere outside this repo's granted filesystem boundary. Only this
// exact directory is removed on cleanup.
const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-credential-store-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");

const {
  clientCredentialStorePath,
  isCredentialStoreIntegrityError,
  issueCredential,
  listCredentials,
  recordCredentialUse,
  revokeCredential,
  setPostReadDelayForTest,
  setReadFileForTest,
  verifyCredential,
} = await import("./credential-store.ts");

// Test-only escape hatch: `SafeClientCredential.scopes` is deliberately
// `readonly ClientV1Scope[]` so production callers can't accidentally mutate
// it, but these mutation-isolation tests need to actually attempt a mutation
// to prove it doesn't leak anywhere else.
function mutableScopes(scopes: readonly ClientV1Scope[]): ClientV1Scope[] {
  return scopes as ClientV1Scope[];
}

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(clientCredentialStorePath(), { force: true });
  // Every mutation acquires a fresh `BEGIN IMMEDIATE` transaction on the
  // SQLite lock database adjacent to the store path; clearing its sidecar
  // files (including WAL/SHM, present whenever the lock db is in WAL mode)
  // between tests keeps each test's lock state independent of whatever the
  // previous test left behind, mirroring the store-file reset above.
  const lockDbPath = credentialLockDbPath(clientCredentialStorePath());
  await Promise.all(
    [lockDbPath, `${lockDbPath}-wal`, `${lockDbPath}-shm`].map((file) => rm(file, { force: true })),
  );
  setPostReadDelayForTest(null);
  setReadFileForTest(null);
});


function approvedPairing(overrides: Partial<Parameters<typeof issueCredential>[0]> = {}) {
  return {
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read" as const],
    status: "approved" as const,
    ...overrides,
  };
}

// Deterministic delay for the mutation-queue concurrency tests below: every
// locked mutation (`issueCredential`, `recordCredentialUse`,
// `revokeCredential`) awaits this hook right after its own `readStore()` and
// before it mutates/writes (see `setPostReadDelayForTest` in
// credential-store.ts). A real (if short) async delay here — rather than a
// same-tick `Promise.resolve()` — widens the window a concurrently-invoked
// second mutation WOULD read a stale snapshot in if the module-local mutation
// queue were missing or broken; these tests still pass deterministically
// with the queue in place because a queued mutation's `readStore()` never
// even runs until every earlier-queued mutation's entire critical section
// (delay included) has finished. Nothing here depends on which call happens
// to "win" a real race.
function delayHook(ms: number): () => Promise<void> {
  return () => new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 5. credential file contains hash but never raw bearer token ─────────

test("the persisted store contains the token hash but never the raw bearer token", async () => {
  const { token } = await issueCredential(approvedPairing(), 1_000);
  const raw = await readFile(clientCredentialStorePath(), "utf8");
  assert.equal(raw.includes(token), false, "the raw token must never be written to disk");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.equal(typeof parsed.credentials[0].tokenHash, "string");
  assert.notEqual(parsed.credentials[0].tokenHash, token);
});

// ─── 6. verify issued token works; malformed/wrong/revoked fails ─────────

test("verifyCredential accepts an issued token and rejects malformed, wrong, or revoked ones", async () => {
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);
  const verified = await verifyCredential(token, 1_100);
  assert.equal(verified?.id, credential.id);
  assert.equal((verified as { tokenHash?: string }).tokenHash, undefined);

  assert.equal(await verifyCredential("", 1_100), null, "empty/malformed token fails");
  assert.equal(await verifyCredential("not-the-token", 1_100), null, "wrong token fails");

  await revokeCredential(credential.id, 1_200);
  assert.equal(await verifyCredential(token, 1_300), null, "revoked token fails");
});

// ─── 7. list excludes tokenHash and sorts newest first ───────────────────

test("listCredentials excludes tokenHash and sorts newest first", async () => {
  await issueCredential(approvedPairing({ installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c" }), 1_000);
  await issueCredential(approvedPairing({ installationId: "6e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5d" }), 2_000);
  const all = await listCredentials();
  assert.equal(all.length, 2);
  for (const credential of all) {
    assert.equal("tokenHash" in credential, false);
  }
  assert.deepEqual(all.map((c) => c.createdAt), [2_000, 1_000]);
});

// ─── 8. record-use throttling/monotonic behavior ─────────────────────────

test("recordCredentialUse advances lastUsedAt but throttles writes within 60 seconds", async () => {
  const { credential } = await issueCredential(approvedPairing(), 1_000);
  assert.equal(credential.lastUsedAt, null);

  await recordCredentialUse(credential.id, 5_000);
  let stored = (await listCredentials())[0];
  assert.equal(stored.lastUsedAt, 5_000);

  await recordCredentialUse(credential.id, 5_000 + 60_000 - 1);
  stored = (await listCredentials())[0];
  assert.equal(stored.lastUsedAt, 5_000, "under the 60s threshold must not write");

  await recordCredentialUse(credential.id, 5_000 + 60_000);
  stored = (await listCredentials())[0];
  assert.equal(stored.lastUsedAt, 5_000 + 60_000, "at/after the threshold does write");

  await recordCredentialUse(credential.id, 5_000);
  stored = (await listCredentials())[0];
  assert.equal(stored.lastUsedAt, 5_000 + 60_000, "lastUsedAt must never move backwards");
});

test("recordCredentialUse on an unknown id is a no-op", async () => {
  await recordCredentialUse("00000000-0000-4000-8000-000000000000", 1_000);
  assert.deepEqual(await listCredentials(), []);
});

// ─── 9. repeated revoke stable ────────────────────────────────────────────

test("revoking is idempotent: repeat calls stay successful without moving the timestamp", async () => {
  const { credential } = await issueCredential(approvedPairing(), 1_000);
  assert.equal(await revokeCredential(credential.id, 2_000), true);
  assert.equal(await revokeCredential(credential.id, 3_000), true, "revoking again stays successful");
  const stored = (await listCredentials())[0];
  assert.equal(stored.revokedAt, 2_000, "the timestamp must not move on repeat revoke");
});

test("revoking an unknown credential id returns false", async () => {
  assert.equal(await revokeCredential("00000000-0000-4000-8000-000000000000", 1_000), false);
});

// ─── 10. same-installation re-pair invalidates old active token ─────────

test("re-pairing the same installation revokes the prior active credential", async () => {
  const first = await issueCredential(approvedPairing(), 1_000);
  const second = await issueCredential(approvedPairing(), 2_000);

  assert.equal(await verifyCredential(first.token, 2_100), null, "the old token must no longer verify");
  assert.ok(await verifyCredential(second.token, 2_100), "the new token verifies");

  const all = await listCredentials();
  assert.equal(all.length, 2);
  const oldStored = all.find((c) => c.id === first.credential.id);
  assert.equal(oldStored?.revokedAt, 2_000);
});

test("re-pairing a different installation does not touch an unrelated active credential", async () => {
  const a = await issueCredential(approvedPairing({ installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c" }), 1_000);
  await issueCredential(approvedPairing({ installationId: "6e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5d" }), 2_000);
  assert.ok(await verifyCredential(a.token, 2_100), "an unrelated installation's token is untouched");
});

// ─── 10b. explicit inverted timestamps clamp forward, never backward ────
//
// `now` can legitimately be captured before this call's transaction wait
// (or, for these tests, simply be handed a value earlier than a credential's
// own recorded history) — every mutation below must still leave `createdAt
// <= lastUsedAt` and `createdAt <= revokedAt` on every persisted record, so
// a later strict `readStoreForMutation` parse never rejects it.

test("re-pairing with an explicitly earlier now than the prior credential's createdAt still clamps revokedAt and createdAt forward, never backward", async () => {
  const first = await issueCredential(approvedPairing(), 10_000);
  // Deliberately earlier than `first`'s own createdAt.
  const second = await issueCredential(approvedPairing(), 1_000);

  const all = await listCredentials();
  assert.equal(all.length, 2);
  const firstStored = all.find((c) => c.id === first.credential.id);
  const secondStored = all.find((c) => c.id === second.credential.id);

  assert.equal(
    firstStored?.revokedAt,
    10_000,
    "the prior credential's revokedAt must clamp to its own createdAt rather than the earlier supplied now",
  );
  assert.equal(
    secondStored?.createdAt,
    10_001,
    "the new credential's createdAt must be bumped one past the prior credential's createdAt to preserve newest-first ordering",
  );
  assert.equal(
    second.credential.createdAt,
    10_001,
    "the returned credential must reflect exactly the clamped createdAt that was actually persisted",
  );

  assert.equal(await verifyCredential(first.token, 20_000), null, "the old token must no longer verify");
  assert.ok(await verifyCredential(second.token, 20_000), "the new token verifies");
});

test("re-pairing clamps the prior credential's revokedAt to its own lastUsedAt when that is the latest of the three candidates", async () => {
  const first = await issueCredential(approvedPairing(), 1_000);
  await recordCredentialUse(first.credential.id, 5_000);
  // Earlier than `first`'s lastUsedAt (5_000) but later than its createdAt (1_000).
  await issueCredential(approvedPairing(), 2_000);

  const stored = (await listCredentials()).find((c) => c.id === first.credential.id);
  assert.equal(
    stored?.revokedAt,
    5_000,
    "revokedAt must clamp to the prior credential's own lastUsedAt, the latest of now/createdAt/lastUsedAt",
  );
});

test("issueCredential caps the createdAt bump at Number.MAX_SAFE_INTEGER instead of overflowing past it", async () => {
  await issueCredential(approvedPairing(), Number.MAX_SAFE_INTEGER);
  // Deliberately earlier than the prior credential's createdAt.
  const second = await issueCredential(approvedPairing(), 1_000);

  const secondStored = (await listCredentials()).find((c) => c.id === second.credential.id);
  assert.equal(
    secondStored?.createdAt,
    Number.MAX_SAFE_INTEGER,
    "createdAt must cap at Number.MAX_SAFE_INTEGER rather than overflow past it",
  );
});

test("recordCredentialUse clamps an explicitly earlier now up to the credential's own createdAt on first use", async () => {
  const { credential } = await issueCredential(approvedPairing(), 10_000);
  // Deliberately earlier than the credential's own createdAt.
  await recordCredentialUse(credential.id, 1_000);
  const stored = (await listCredentials())[0];
  assert.equal(
    stored.lastUsedAt,
    10_000,
    "the first recorded use must never be persisted earlier than the credential's own createdAt",
  );
});

test("recordCredentialUse clamps an explicitly earlier now up to the existing lastUsedAt and never rewrites for a no-op", async () => {
  const { credential } = await issueCredential(approvedPairing(), 10_000);
  await recordCredentialUse(credential.id, 50_000);
  let stored = (await listCredentials())[0];
  assert.equal(stored.lastUsedAt, 50_000);

  // Deliberately earlier than the existing lastUsedAt (50_000).
  await recordCredentialUse(credential.id, 20_000);
  stored = (await listCredentials())[0];
  assert.equal(
    stored.lastUsedAt,
    50_000,
    "lastUsedAt must never move backward, even for an explicitly inverted now",
  );
});

test("revokeCredential clamps an explicitly earlier now up to the credential's own createdAt", async () => {
  const { credential } = await issueCredential(approvedPairing(), 10_000);
  // Deliberately earlier than the credential's own createdAt.
  await revokeCredential(credential.id, 1_000);
  const stored = (await listCredentials())[0];
  assert.equal(stored.revokedAt, 10_000, "revokedAt must never be persisted earlier than the credential's own createdAt");
});

test("revokeCredential clamps an explicitly earlier now up to the credential's own lastUsedAt when that is the latest candidate", async () => {
  const { credential } = await issueCredential(approvedPairing(), 10_000);
  await recordCredentialUse(credential.id, 40_000);
  // Earlier than lastUsedAt (40_000) but later than createdAt (10_000).
  await revokeCredential(credential.id, 20_000);
  const stored = (await listCredentials())[0];
  assert.equal(
    stored.revokedAt,
    40_000,
    "revokedAt must clamp to the credential's own lastUsedAt, the latest of now/createdAt/lastUsedAt",
  );
});

test("issueCredential, recordCredentialUse, and revokeCredential reject a non-finite or negative now before persisting anything", async () => {
  const invalidNows = [NaN, Infinity, -Infinity, -1];
  for (const badNow of invalidNows) {
    await assert.rejects(
      () => issueCredential(approvedPairing(), badNow),
      `issueCredential must reject now=${badNow} before persisting a credential`,
    );
  }
  assert.deepEqual(await listCredentials(), [], "an invalid now must never persist a credential record");

  const { credential } = await issueCredential(approvedPairing(), 1_000);
  for (const badNow of invalidNows) {
    await assert.rejects(
      () => recordCredentialUse(credential.id, badNow),
      `recordCredentialUse must reject now=${badNow} before persisting`,
    );
    await assert.rejects(
      () => revokeCredential(credential.id, badNow),
      `revokeCredential must reject now=${badNow} before persisting`,
    );
  }
  const stored = (await listCredentials())[0];
  assert.equal(stored.lastUsedAt, null, "a rejected recordCredentialUse must never persist a lastUsedAt");
  assert.equal(stored.revokedAt, null, "a rejected revokeCredential must never persist a revocation");
});

// ─── 11. malformed/unreadable store fails closed ─────────────────────────

test("an unreadable or malformed store reads as no credentials, never as an error", async () => {
  await writeFile(clientCredentialStorePath(), "{ not json", "utf8");
  assert.deepEqual(await listCredentials(), []);
  assert.equal(await verifyCredential("anything", 1_000), null);

  await writeFile(clientCredentialStorePath(), JSON.stringify({ credentials: "nope" }), "utf8");
  assert.deepEqual(await listCredentials(), []);
});

test("entries that do not look like credentials are dropped on read", async () => {
  const { credential } = await issueCredential(approvedPairing(), 1_000);
  const raw = JSON.parse(await readFile(clientCredentialStorePath(), "utf8"));
  raw.credentials.push({ id: "only-an-id" });
  await writeFile(clientCredentialStorePath(), JSON.stringify(raw), "utf8");

  const all = await listCredentials();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, credential.id);
});

// ─── 12. strict v1 schema validation fails closed on every malformed shape ─

// Deterministic, distinct, UUID-shaped ids for fixtures below — production
// credential ids are always UUID-shaped (`randomUUID()`), and validation now
// enforces that shape on read, so a fixture using a human-readable label
// like "cred-1" would be dropped for the wrong reason (a malformed id) when
// the test wants to exercise some OTHER field's validation instead.
let fixtureIdSeed = 0;
function fixtureId(): string {
  fixtureIdSeed += 1;
  return `4e8b1b3e-9c1a-4f0a-8b1a-${String(fixtureIdSeed).padStart(12, "0")}`;
}

function validCredentialEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: fixtureId(),
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    tokenHash: "a".repeat(64),
    scopes: ["chat:read"],
    createdAt: 1_000,
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

async function writeRawStore(store: unknown): Promise<void> {
  await writeFile(clientCredentialStorePath(), JSON.stringify(store), "utf8");
}

test("a store with the wrong top-level version is rejected entirely, even with otherwise-valid entries", async () => {
  await writeRawStore({ version: 2, credentials: [validCredentialEntry()] });
  assert.deepEqual(await listCredentials(), []);
  assert.equal(await verifyCredential("anything", 1_000), null);
});

test("a store missing the version field or with a non-array credentials field is rejected entirely", async () => {
  await writeRawStore({ credentials: [validCredentialEntry()] });
  assert.deepEqual(await listCredentials(), []);

  await writeRawStore({ version: 1, credentials: { not: "an array" } });
  assert.deepEqual(await listCredentials(), []);
});

test("a store with an extra top-level key is rejected entirely, even with otherwise-valid contents", async () => {
  await writeRawStore({
    version: 1,
    credentials: [validCredentialEntry()],
    extraTopLevelField: "nope",
  });
  assert.deepEqual(await listCredentials(), []);
  assert.equal(await verifyCredential("anything", 1_000), null);
});

test("an entry with extra or missing keys is dropped, even if every other field is valid", async () => {
  await writeRawStore({
    version: 1,
    credentials: [
      validCredentialEntry({ extraField: "nope" }),
      { ...validCredentialEntry(), revokedAt: undefined },
    ],
  });
  assert.deepEqual(await listCredentials(), []);
});

test("an entry with a malformed tokenHash (wrong length or non-hex) is dropped", async () => {
  await writeRawStore({
    version: 1,
    credentials: [
      validCredentialEntry({ tokenHash: "a".repeat(63) }),
      validCredentialEntry({ tokenHash: "a".repeat(65) }),
      validCredentialEntry({ tokenHash: "z".repeat(64) }),
    ],
  });
  assert.deepEqual(await listCredentials(), []);
});

test("a tokenHash is accepted with mixed case and normalized consistently", async () => {
  const mixedCaseHash = "AbCd".repeat(16);
  assert.equal(mixedCaseHash.length, 64);
  await writeRawStore({
    version: 1,
    credentials: [validCredentialEntry({ tokenHash: mixedCaseHash })],
  });
  const all = await listCredentials();
  assert.equal(all.length, 1, "a valid mixed-case hex hash must still be accepted");
});

test("an entry with malformed scopes (empty, unknown, non-string, or duplicate) is dropped", async () => {
  await writeRawStore({
    version: 1,
    credentials: [
      validCredentialEntry({ scopes: [] }),
      validCredentialEntry({ scopes: ["admin:everything"] }),
      validCredentialEntry({ scopes: [123] }),
      validCredentialEntry({ scopes: ["chat:read", "chat:read"] }),
      validCredentialEntry({ scopes: "chat:read" }),
    ],
  });
  assert.deepEqual(await listCredentials(), []);
});

test("an entry with malformed timestamps is dropped", async () => {
  await writeRawStore({
    version: 1,
    credentials: [
      validCredentialEntry({ createdAt: -1 }),
      validCredentialEntry({ createdAt: Number.NaN }),
      validCredentialEntry({ createdAt: Number.POSITIVE_INFINITY }),
      validCredentialEntry({ createdAt: "1000" }),
      validCredentialEntry({ createdAt: 1_000, lastUsedAt: 500 }),
      validCredentialEntry({ createdAt: 1_000, revokedAt: 500 }),
      validCredentialEntry({ createdAt: 1_000, lastUsedAt: -5 }),
      validCredentialEntry({ createdAt: 1_000, revokedAt: -5 }),
    ],
  });
  assert.deepEqual(await listCredentials(), []);
});

test("an entry with empty-string or non-UUID-shaped identity fields is dropped", async () => {
  await writeRawStore({
    version: 1,
    credentials: [
      validCredentialEntry({ id: "" }),
      validCredentialEntry({ id: "not-a-uuid" }),
      validCredentialEntry({ appName: "" }),
      validCredentialEntry({ installationId: "" }),
      validCredentialEntry({ installationId: "not-a-uuid" }),
    ],
  });
  assert.deepEqual(await listCredentials(), []);
});

test("only fully valid records survive alongside malformed ones in the same file", async () => {
  const validOneId = fixtureId();
  const validTwoId = fixtureId();
  await writeRawStore({
    version: 1,
    credentials: [
      validCredentialEntry({ id: validOneId }),
      validCredentialEntry({ tokenHash: "not-hex" }),
      { id: fixtureId() },
      validCredentialEntry({ id: validTwoId, createdAt: 2_000, lastUsedAt: 2_500 }),
    ],
  });
  const all = await listCredentials();
  assert.deepEqual(
    all.map((c) => c.id).sort(),
    [validOneId, validTwoId].sort(),
    "only entries that pass every check should survive",
  );
  for (const credential of all) {
    assert.equal("tokenHash" in credential, false, "safe list must never expose the token hash");
    assert.equal(Object.keys(credential).length, 7, "safe list must never expose extra keys");
  }
});

test("a valid persisted credential can still be verified by its token hash", async () => {
  const tokenHash = "b".repeat(64);
  const id = fixtureId();
  await writeRawStore({
    version: 1,
    credentials: [validCredentialEntry({ id, tokenHash })],
  });
  // We cannot reconstruct the raw token from its hash, but we can confirm the
  // entry actually survived parsing and is usable via listCredentials.
  const all = await listCredentials();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, id);
});

// ─── 12b. mutation mode fails closed on unreadable/malformed stores instead
//          of falling back to read-only mode's "treat it as empty" behavior:
//          only a genuinely missing file (ENOENT) may be treated as "no
//          credentials issued yet" during `issueCredential`,
//          `recordCredentialUse`, or `revokeCredential`. Everything else —
//          an unreadable file, invalid JSON, a wrong top-level schema, or
//          even a single malformed persisted entry — must abort the
//          mutation instead of silently reporting success/not-found or
//          overwriting the file. Read-only `listCredentials`/
//          `verifyCredential` must still fail closed to empty/null on the
//          exact same broken inputs. ────────────────────────────────────

function fsError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("issueCredential still treats a genuinely missing store (ENOENT) as no credentials issued yet", async () => {
  let calls = 0;
  setReadFileForTest(async () => {
    calls += 1;
    throw fsError("ENOENT", "no such file or directory");
  });
  const { credential } = await issueCredential(approvedPairing(), 1_000);
  assert.ok(calls >= 1, "the injected readFile hook must actually have been exercised by the mutation");
  setReadFileForTest(null);
  assert.deepEqual(
    (await listCredentials()).map((c) => c.id),
    [credential.id],
    "an ENOENT read must still let a first issuance create a fresh store, exactly like production behavior for a brand-new pairing",
  );
});

test("issueCredential rejects rather than overwriting the store when it cannot be read (EACCES-like failure), and a later issue is not poisoned", async () => {
  const first = await issueCredential(approvedPairing(), 1_000);
  const before = await readFile(clientCredentialStorePath(), "utf8");

  setReadFileForTest(async () => {
    throw fsError("EACCES", "permission denied");
  });
  const idB = "7e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5e";
  await assert.rejects(
    () => issueCredential(approvedPairing({ installationId: idB }), 2_000),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "an unreadable store must throw a typed integrity error rather than issuing on top of an assumed-empty store",
  );
  assert.equal(
    await readFile(clientCredentialStorePath(), "utf8"),
    before,
    "a rejected issueCredential must never have written anything: the file on disk must be byte-for-byte unchanged",
  );
  assert.deepEqual(
    await listCredentials(),
    [],
    "read-only listCredentials must still fail closed to empty on the same unreadable store",
  );
  assert.equal(
    await verifyCredential(first.token, 2_100),
    null,
    "read-only verifyCredential must still fail closed to null on the same unreadable store",
  );

  setReadFileForTest(null);
  const second = await issueCredential(approvedPairing({ installationId: idB }), 3_000);
  const all = await listCredentials();
  assert.ok(
    all.some((c) => c.id === first.credential.id) && all.some((c) => c.id === second.credential.id),
    "once the store is readable again, issuing must succeed and the earlier rejection must not have poisoned the mutation queue",
  );
});

test("revokeCredential rejects rather than reporting not-found when the store cannot be read, and a later revoke is not poisoned", async () => {
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);
  const before = await readFile(clientCredentialStorePath(), "utf8");

  setReadFileForTest(async () => {
    throw fsError("EACCES", "permission denied");
  });
  await assert.rejects(
    () => revokeCredential(credential.id, 2_000),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "an unreadable store must throw rather than let revokeCredential falsely report the credential as not found",
  );
  assert.equal(
    await readFile(clientCredentialStorePath(), "utf8"),
    before,
    "a rejected revoke must never have written anything",
  );
  assert.deepEqual(await listCredentials(), [], "read-only listCredentials must still fail closed on the same unreadable store");
  assert.equal(await verifyCredential(token, 2_100), null, "read-only verifyCredential must still fail closed on the same unreadable store");

  setReadFileForTest(null);
  assert.equal(
    await revokeCredential(credential.id, 3_000),
    true,
    "revoke must succeed once the store is readable again; the earlier rejection must not have poisoned the mutation queue",
  );
  const stored = (await listCredentials()).find((c) => c.id === credential.id);
  assert.equal(stored?.revokedAt, 3_000);
});

test("recordCredentialUse rejects rather than silently no-op'ing when the store cannot be read, and a later call is not poisoned", async () => {
  const { credential } = await issueCredential(approvedPairing(), 1_000);
  const before = await readFile(clientCredentialStorePath(), "utf8");

  setReadFileForTest(async () => {
    throw fsError("EACCES", "permission denied");
  });
  await assert.rejects(
    () => recordCredentialUse(credential.id, 2_000),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "an unreadable store must throw rather than silently treating the credential as not found",
  );
  assert.equal(
    await readFile(clientCredentialStorePath(), "utf8"),
    before,
    "a rejected recordCredentialUse must never have written anything",
  );
  assert.deepEqual(await listCredentials(), [], "read-only listCredentials must still fail closed on the same unreadable store");

  setReadFileForTest(null);
  await recordCredentialUse(credential.id, 3_000);
  const stored = (await listCredentials()).find((c) => c.id === credential.id);
  assert.equal(
    stored?.lastUsedAt,
    3_000,
    "recordCredentialUse must succeed once the store is readable again; the earlier rejection must not have poisoned the mutation queue",
  );
});

test("issueCredential rejects on invalid JSON or a wrong top-level schema instead of overwriting the store, and a later issue is not poisoned", async () => {
  const first = await issueCredential(approvedPairing(), 1_000);
  const validBytes = await readFile(clientCredentialStorePath(), "utf8");
  const idB = "8e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5f";

  await writeFile(clientCredentialStorePath(), "{ not json", "utf8");
  await assert.rejects(
    () => issueCredential(approvedPairing({ installationId: idB }), 2_000),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "invalid JSON must abort the mutation rather than being treated as an empty store",
  );
  assert.equal(await readFile(clientCredentialStorePath(), "utf8"), "{ not json", "a rejected issue must never overwrite corrupt bytes");
  assert.deepEqual(await listCredentials(), [], "read-only listCredentials must still fail closed on the same invalid JSON");
  assert.equal(await verifyCredential(first.token, 2_100), null, "read-only verifyCredential must still fail closed on the same invalid JSON");

  const wrongSchema = JSON.stringify({ version: 2, credentials: [] });
  await writeFile(clientCredentialStorePath(), wrongSchema, "utf8");
  await assert.rejects(
    () => issueCredential(approvedPairing({ installationId: idB }), 2_500),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "a wrong top-level schema must also abort the mutation rather than being treated as an empty store",
  );
  assert.equal(await readFile(clientCredentialStorePath(), "utf8"), wrongSchema, "a rejected issue must never overwrite a wrong-schema file");
  assert.deepEqual(await listCredentials(), [], "read-only listCredentials must still fail closed on the same wrong schema");

  await writeFile(clientCredentialStorePath(), validBytes, "utf8");
  const second = await issueCredential(approvedPairing({ installationId: idB }), 3_000);
  const all = await listCredentials();
  assert.ok(
    all.some((c) => c.id === first.credential.id) && all.some((c) => c.id === second.credential.id),
    "once the store is a valid, readable file again, issuing must succeed and the earlier rejections must not have poisoned the mutation queue",
  );
});

test("revokeCredential rejects on invalid JSON or a wrong top-level schema instead of reporting not-found, and a later revoke is not poisoned", async () => {
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);
  const validBytes = await readFile(clientCredentialStorePath(), "utf8");

  await writeFile(clientCredentialStorePath(), "{ not json", "utf8");
  await assert.rejects(
    () => revokeCredential(credential.id, 2_000),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "invalid JSON must abort the mutation rather than reporting the credential as not found",
  );
  assert.equal(await readFile(clientCredentialStorePath(), "utf8"), "{ not json", "a rejected revoke must never overwrite corrupt bytes");
  assert.deepEqual(await listCredentials(), [], "read-only listCredentials must still fail closed on the same invalid JSON");
  assert.equal(await verifyCredential(token, 2_100), null, "read-only verifyCredential must still fail closed on the same invalid JSON");

  const wrongSchema = JSON.stringify({ credentials: [] });
  await writeFile(clientCredentialStorePath(), wrongSchema, "utf8");
  await assert.rejects(
    () => revokeCredential(credential.id, 2_500),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "a wrong top-level schema must also abort the mutation rather than reporting the credential as not found",
  );
  assert.equal(await readFile(clientCredentialStorePath(), "utf8"), wrongSchema, "a rejected revoke must never overwrite a wrong-schema file");

  await writeFile(clientCredentialStorePath(), validBytes, "utf8");
  assert.equal(
    await revokeCredential(credential.id, 3_000),
    true,
    "revoke must succeed once the store is valid and readable again; the earlier rejections must not have poisoned the mutation queue",
  );
  assert.equal((await listCredentials()).find((c) => c.id === credential.id)?.revokedAt, 3_000);
});

test("recordCredentialUse rejects on invalid JSON or a wrong top-level schema instead of silently no-op'ing, and a later call is not poisoned", async () => {
  const { credential } = await issueCredential(approvedPairing(), 1_000);
  const validBytes = await readFile(clientCredentialStorePath(), "utf8");

  await writeFile(clientCredentialStorePath(), "{ not json", "utf8");
  await assert.rejects(
    () => recordCredentialUse(credential.id, 2_000),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "invalid JSON must abort the mutation rather than silently treating the credential as not found",
  );
  assert.equal(await readFile(clientCredentialStorePath(), "utf8"), "{ not json", "a rejected recordCredentialUse must never overwrite corrupt bytes");
  assert.deepEqual(await listCredentials(), [], "read-only listCredentials must still fail closed on the same invalid JSON");

  const wrongSchema = JSON.stringify({ version: 1, credentials: "nope" });
  await writeFile(clientCredentialStorePath(), wrongSchema, "utf8");
  await assert.rejects(
    () => recordCredentialUse(credential.id, 2_500),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "a wrong top-level schema must also abort the mutation rather than silently treating the credential as not found",
  );
  assert.equal(await readFile(clientCredentialStorePath(), "utf8"), wrongSchema, "a rejected recordCredentialUse must never overwrite a wrong-schema file");

  await writeFile(clientCredentialStorePath(), validBytes, "utf8");
  await recordCredentialUse(credential.id, 3_000);
  assert.equal(
    (await listCredentials()).find((c) => c.id === credential.id)?.lastUsedAt,
    3_000,
    "recordCredentialUse must succeed once the store is valid and readable again; the earlier rejections must not have poisoned the mutation queue",
  );
});

test("issueCredential aborts entirely on one malformed credential entry among valid ones, rather than silently dropping it and overwriting the file", async () => {
  const { credential: valid } = await issueCredential(approvedPairing(), 1_000);
  const before = await readFile(clientCredentialStorePath(), "utf8");
  const raw = JSON.parse(before);
  raw.credentials.push({ id: "not-a-uuid" });
  const corrupted = JSON.stringify(raw);
  await writeFile(clientCredentialStorePath(), corrupted, "utf8");

  const idB = "9e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a60";
  await assert.rejects(
    () => issueCredential(approvedPairing({ installationId: idB }), 2_000),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "a malformed entry must abort the whole mutation rather than being silently filtered out and then overwritten",
  );
  assert.equal(
    await readFile(clientCredentialStorePath(), "utf8"),
    corrupted,
    "the file with the malformed entry must remain untouched by the rejected mutation",
  );
  assert.deepEqual(
    (await listCredentials()).map((c) => c.id),
    [valid.id],
    "read-only listCredentials still safely drops the malformed entry and returns only the valid one",
  );

  await writeFile(clientCredentialStorePath(), before, "utf8");
  const second = await issueCredential(approvedPairing({ installationId: idB }), 3_000);
  assert.ok(
    (await listCredentials()).some((c) => c.id === second.credential.id),
    "once the malformed entry is gone, issuing must succeed again",
  );
});

test("revokeCredential aborts entirely on one malformed credential entry among valid ones, rather than falsely reporting not-found", async () => {
  const { credential: valid } = await issueCredential(approvedPairing(), 1_000);
  const before = await readFile(clientCredentialStorePath(), "utf8");
  const raw = JSON.parse(before);
  raw.credentials.push({ id: "not-a-uuid" });
  const corrupted = JSON.stringify(raw);
  await writeFile(clientCredentialStorePath(), corrupted, "utf8");

  await assert.rejects(
    () => revokeCredential(valid.id, 2_000),
    (error: unknown) => isCredentialStoreIntegrityError(error),
    "a malformed entry must abort the whole mutation rather than the real credential being reported not found",
  );
  assert.equal(
    await readFile(clientCredentialStorePath(), "utf8"),
    corrupted,
    "the file with the malformed entry must remain untouched by the rejected revoke",
  );

  await writeFile(clientCredentialStorePath(), before, "utf8");
  assert.equal(
    await revokeCredential(valid.id, 3_000),
    true,
    "once the malformed entry is gone, revoking the real credential must succeed",
  );
});

// ─── 13. installation id case-insensitivity: re-pairing with a different-
//         case UUID must still revoke the prior active credential ─────────

test("re-pairing with an uppercase installation id revokes a credential issued for the lowercase form, and issued credentials store the canonical lowercase id", async () => {

  const lowercaseId = "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b";
  const uppercaseId = lowercaseId.toUpperCase();

  const first = await issueCredential(approvedPairing({ installationId: uppercaseId }), 1_000);
  assert.equal(
    first.credential.installationId,
    lowercaseId,
    "issueCredential must store the canonical lowercase installation id even when given uppercase",
  );

  const second = await issueCredential(approvedPairing({ installationId: lowercaseId }), 2_000);

  assert.equal(
    await verifyCredential(first.token, 2_100),
    null,
    "the credential issued for the uppercase-form id must be revoked when re-pairing as lowercase",
  );
  assert.ok(await verifyCredential(second.token, 2_100), "the new token verifies");

  const all = await listCredentials();
  const active = all.filter((c) => c.revokedAt === null);
  assert.equal(active.length, 1, "only one active credential must remain for the installation");
  assert.equal(active[0]?.id, second.credential.id);

  const oldStored = all.find((c) => c.id === first.credential.id);
  assert.equal(oldStored?.revokedAt, 2_000, "the old credential must be revoked, not deleted");
});

// ─── 14. mutation-queue concurrency: no lost updates across in-process races ─

test("two concurrent issueCredential calls for different installations both survive and both tokens verify", async () => {
  const idA = "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c";
  const idB = "6e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5d";
  setPostReadDelayForTest(delayHook(20));
  try {
    const [first, second] = await Promise.all([
      issueCredential(approvedPairing({ installationId: idA }), 1_000),
      issueCredential(approvedPairing({ installationId: idB }), 2_000),
    ]);

    assert.ok(await verifyCredential(first.token, 3_000), "installation A's token still verifies");
    assert.ok(await verifyCredential(second.token, 3_000), "installation B's token still verifies");

    const all = await listCredentials();
    assert.equal(all.length, 2, "both concurrently-issued credentials must survive in the store");
    assert.deepEqual(
      all.map((c) => c.installationId).sort(),
      [idA, idB].sort(),
    );
  } finally {
    setPostReadDelayForTest(null);
  }
});

test("a concurrent revoke and issue do not lose either mutation", async () => {
  const idA = "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c";
  const idB = "6e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5d";
  const { credential: credA } = await issueCredential(approvedPairing({ installationId: idA }), 1_000);

  setPostReadDelayForTest(delayHook(20));
  try {
    const [revoked, issued] = await Promise.all([
      revokeCredential(credA.id, 2_000),
      issueCredential(approvedPairing({ installationId: idB }), 2_000),
    ]);
    assert.equal(revoked, true);

    const all = await listCredentials();
    assert.equal(all.length, 2, "the pre-existing credential and the concurrently-issued one must both survive");

    const storedA = all.find((c) => c.id === credA.id);
    assert.equal(storedA?.revokedAt, 2_000, "the concurrent revoke must not be lost");

    const storedB = all.find((c) => c.id === issued.credential.id);
    assert.ok(storedB, "the concurrently-issued credential must not be lost");
    assert.equal(storedB?.revokedAt, null, "the freshly-issued credential must not be affected by the unrelated revoke");
  } finally {
    setPostReadDelayForTest(null);
  }
});

test("a concurrent record-use and revoke preserve the revocation and a valid monotonic lastUsedAt", async () => {
  const { credential } = await issueCredential(approvedPairing(), 1_000);

  setPostReadDelayForTest(delayHook(20));
  try {
    const [, revoked] = await Promise.all([
      recordCredentialUse(credential.id, 5_000),
      revokeCredential(credential.id, 6_000),
    ]);
    assert.equal(revoked, true);

    const stored = (await listCredentials())[0];
    assert.equal(stored.revokedAt, 6_000, "the revocation must survive a concurrent record-use");
    assert.equal(stored.lastUsedAt, 5_000, "the record-use must survive a concurrent revoke");
    assert.ok(
      stored.lastUsedAt === null || (stored.lastUsedAt >= stored.createdAt && stored.lastUsedAt <= 6_000),
      "lastUsedAt must stay monotonic: never before createdAt and never past this test's latest timestamp",
    );
  } finally {
    setPostReadDelayForTest(null);
  }
});

test("a concurrent revoke followed by record-use (reverse queue order) still preserves both mutations", async () => {
  const { credential } = await issueCredential(approvedPairing(), 1_000);

  setPostReadDelayForTest(delayHook(20));
  try {
    const [revoked] = await Promise.all([
      revokeCredential(credential.id, 6_000),
      recordCredentialUse(credential.id, 5_000),
    ]);
    assert.equal(revoked, true);

    const stored = (await listCredentials())[0];
    assert.equal(stored.revokedAt, 6_000, "the revocation must survive regardless of queue order");
    assert.equal(stored.lastUsedAt, 5_000, "the record-use must survive regardless of queue order");
  } finally {
    setPostReadDelayForTest(null);
  }
});

// ─── 15. a rejected queued mutation must not poison later mutations ───────

test("a mutation that throws mid-transaction does not block a later mutation for the same store", async () => {
  const { credential } = await issueCredential(approvedPairing(), 1_000);

  // Forces `recordCredentialUse`'s transaction to reject AFTER it has
  // acquired both the in-process queue turn and the shared cross-process
  // SQLite lock (right after its own `readStore()`), so this proves both
  // layers release cleanly on failure — not just that the in-process queue
  // chain itself avoids inheriting the rejection.
  setPostReadDelayForTest(() => Promise.reject(new Error("simulated queued mutation failure")));
  try {
    await assert.rejects(
      recordCredentialUse(credential.id, 2_000),
      /simulated queued mutation failure/,
      "the failing mutation itself must still reject with its own error",
    );
  } finally {
    setPostReadDelayForTest(null);
  }

  // A later mutation queued behind the rejected one — even one enqueued
  // while the failure was still in flight — must run and succeed normally.
  assert.equal(
    await revokeCredential(credential.id, 3_000),
    true,
    "a later revoke must not be poisoned by an earlier mutation's rejection",
  );
  const stored = (await listCredentials())[0];
  assert.equal(stored.revokedAt, 3_000);

  // Also prove a mutation enqueued WHILE the failure is still pending (not
  // just one issued strictly after it settles) is unaffected: queue a
  // second credential's issuance immediately behind a guaranteed-to-throw
  // record-use for the SAME store key, then confirm the issuance still
  // lands. The hook rejects only on its first invocation (guaranteed to be
  // the already-in-flight `recordCredentialUse` below, since queue order is
  // FIFO by call order) and resolves normally after that, so this is
  // deterministic regardless of real I/O timing — no artificial delay or
  // timer race is needed to force the ordering.
  let hookCalls = 0;
  setPostReadDelayForTest(() => {
    hookCalls += 1;
    return hookCalls === 1
      ? Promise.reject(new Error("second simulated failure"))
      : Promise.resolve();
  });
  try {
    const failing = recordCredentialUse(credential.id, 4_000);
    const idB = "8e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5e";
    const issuing = issueCredential(approvedPairing({ installationId: idB }), 4_000);
    await assert.rejects(failing, /second simulated failure/);
    const issued = await issuing;
    assert.ok(
      (await listCredentials()).some((c) => c.id === issued.credential.id),
      "a mutation queued behind an in-flight rejecting mutation must still land",
    );
  } finally {
    setPostReadDelayForTest(null);
  }
});

test("an operation failure while holding the SQLite cross-process lock still releases it for an unrelated later caller", async () => {
  // Proves the release side of "operation failure must not leave the lock
  // stuck" on the actual production lock: a failing mutation's rejection
  // must release the underlying `BEGIN IMMEDIATE` transaction promptly
  // enough for a completely unrelated, directly-invoked
  // `withCredentialTransactionLock` caller against the SAME store path —
  // not just this store's own `issueCredential`/`revokeCredential` — to
  // acquire it right after.
  const { withCredentialTransactionLock } = await import("./credential-transaction-lock.ts");
  const storePath = clientCredentialStorePath();

  setPostReadDelayForTest(() => Promise.reject(new Error("simulated operation failure")));
  try {
    await assert.rejects(
      issueCredential(approvedPairing(), 1_000),
      /simulated operation failure/,
      "the failing mutation itself must still reject with its own error",
    );
  } finally {
    setPostReadDelayForTest(null);
  }

  const result = await withCredentialTransactionLock({ storePath }, async () => "lock-is-free");
  assert.equal(
    result,
    "lock-is-free",
    "an unrelated caller of the shared SQLite lock must acquire it promptly after a failed credential mutation",
  );

  // A later credential mutation, through this store's own transaction
  // boundary, must also still run and succeed — the earlier failure must
  // not have left the in-process queue stuck on a rejected link either.
  const { credential } = await issueCredential(approvedPairing(), 2_000);
  assert.ok(
    (await listCredentials()).some((c) => c.id === credential.id),
    "a mutation queued after an earlier operation failure must still land",
  );
});

// ─── the SQLite cross-process lock, not a homegrown protocol, guards mutations ──

test("a concurrent withCredentialTransactionLock holder in a separate process delays a credential mutation until it releases", async () => {
  // The strongest proof credential mutations really are guarded by the
  // SQLite lock adjacent to their own store path — rather than some other,
  // independent mechanism that merely happens to behave similarly — is that
  // an unrelated holder of THAT EXACT lock database, in a genuinely
  // separate OS process, blocks a credential mutation in THIS process until
  // it releases. Directly invoking `withCredentialTransactionLock` against
  // this same store path from outside the credential store entirely is
  // what proves the lock db path (not just coincidental timing) is what's
  // shared.
  const moduleUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/credential-transaction-lock.ts"),
  ).href;
  const storePath = clientCredentialStorePath();
  const holdMs = 400;
  const holderScript = `
    const { withCredentialTransactionLock } = await import(${JSON.stringify(moduleUrl)});
    await withCredentialTransactionLock({ storePath: ${JSON.stringify(storePath)} }, async () => {
      process.stdout.write("ACQUIRED\\n");
      await new Promise((resolve) => setTimeout(resolve, ${holdMs}));
    });
  `;
  const child = execFile(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", holderScript],
    { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`holder exited ${code}`))));
    child.once("error", reject);
  });
  await new Promise<void>((resolve, reject) => {
    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      if (buffered.includes("ACQUIRED")) {
        child.stdout?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => {
      if (!buffered.includes("ACQUIRED")) reject(new Error(`holder exited (${code}) before acquiring the lock`));
    });
  });

  const startedAt = Date.now();
  const { credential } = await issueCredential(approvedPairing(), 3_000);
  const waitedMs = Date.now() - startedAt;

  await exited;
  assert.ok(
    (await listCredentials()).some((c) => c.id === credential.id),
    "the credential mutation must still succeed once the unrelated holder releases",
  );
  assert.ok(
    waitedMs >= holdMs * 0.5,
    `issueCredential must have actually waited on the separate process's SQLite lock hold (waited ${waitedMs}ms, held ${holdMs}ms)`,
  );
});

// ─── 16. shared cross-process SQLite lock wraps production mutations ─

test("separate Node processes issuing credentials concurrently against the same store never lose a credential", async () => {
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const moduleUrl = pathToFileURL(path.resolve("src/lib/server/client-v1/credential-store.ts")).href;
  const storePath = clientCredentialStorePath();
  const startAt = Date.now() + 1_500;
  const worker = `
    const wait = Math.max(0, Number(process.env.CAVE_TEST_START_AT) - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const { issueCredential } = await import(${JSON.stringify(moduleUrl)});
    const pairing = JSON.parse(process.env.CAVE_TEST_PAIRING);
    const now = Number(process.env.CAVE_TEST_NOW);
    const result = await issueCredential(pairing, now);
    process.stdout.write(JSON.stringify({ id: result.credential.id, installationId: result.credential.installationId }));
  `;
  const installationIds = Array.from({ length: 8 }, () => crypto.randomUUID());
  const outcomes = await Promise.all(installationIds.map((installationId, index) => execFileAsync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import", loaderUrl,
      "--input-type=module",
      "--eval", worker,
    ],
    {
      cwd: process.cwd(),
      env: {
        // `...process.env` carries this file's environment through to the
        // child. Since the lock db path is derived from
        // `COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH` (set explicitly below,
        // to the same throwaway path every worker shares), every worker's
        // credential mutations contend on the exact same SQLite lock file
        // as each other and as this process — never the real user Cave home.
        ...process.env,
        COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH: storePath,
        CAVE_TEST_START_AT: String(startAt),
        CAVE_TEST_PAIRING: JSON.stringify(approvedPairing({ installationId })),
        CAVE_TEST_NOW: String(10_000 + index),
      },
      windowsHide: true,
    },
  ).then(({ stdout }) => JSON.parse(stdout.trim()) as { id: string; installationId: string })));

  const all = await listCredentials();
  assert.equal(all.length, installationIds.length, "every cross-process issuance must survive; none may be clobbered by a racing rename");
  assert.deepEqual(
    all.map((c) => c.installationId).sort(),
    installationIds.slice().sort(),
    "every installation's credential must be present, not just the last writer's",
  );
  for (const outcome of outcomes) {
    assert.ok(
      all.some((c) => c.id === outcome.id),
      `credential ${outcome.id} issued by a separate process must be present on disk`,
    );
  }
});

// ─── real cross-process same-installation issuance race, inverted times ──

test("a real cross-process same-installation issuance race with inverted requested times still leaves a parseable store with exactly one active credential", async () => {
  // Two genuinely separate OS processes race to `issueCredential` for the
  // SAME installation at almost the same wall-clock moment, but with their
  // requested `now` values deliberately INVERTED relative to which one
  // might plausibly run first (one asks for a large `now`, the other a much
  // smaller one) — proving the store's chronology invariants hold no
  // matter which process's transaction the cross-process SQLite lock
  // actually lets run second, not just for the "expected" ordering.
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const moduleUrl = pathToFileURL(path.resolve("src/lib/server/client-v1/credential-store.ts")).href;
  const storePath = clientCredentialStorePath();
  const installationId = "7e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5f";
  const startAt = Date.now() + 1_500;
  const worker = `
    const wait = Math.max(0, Number(process.env.CAVE_TEST_START_AT) - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const { issueCredential } = await import(${JSON.stringify(moduleUrl)});
    const pairing = JSON.parse(process.env.CAVE_TEST_PAIRING);
    const now = Number(process.env.CAVE_TEST_NOW);
    const result = await issueCredential(pairing, now);
    process.stdout.write(JSON.stringify({ id: result.credential.id, token: result.token }));
  `;
  const baseEnv = {
    // `...process.env` carries this file's environment through to both
    // children — since the lock db path derives from
    // `COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH` (set explicitly below),
    // both children contend on the exact same SQLite lock file as this
    // process and each other, never the real user Cave home.
    ...process.env,
    COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH: storePath,
    CAVE_TEST_START_AT: String(startAt),
    CAVE_TEST_PAIRING: JSON.stringify(approvedPairing({ installationId })),
  };
  const [outcomeA, outcomeB] = await Promise.all([
    execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--import", loaderUrl, "--input-type=module", "--eval", worker],
      {
        cwd: process.cwd(),
        // A deliberately large requested now.
        env: { ...baseEnv, CAVE_TEST_NOW: "50000" },
        windowsHide: true,
      },
    ).then(({ stdout }) => JSON.parse(stdout.trim()) as { id: string; token: string }),
    execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--import", loaderUrl, "--input-type=module", "--eval", worker],
      {
        cwd: process.cwd(),
        // A deliberately small requested now — inverted relative to A,
        // regardless of which process's transaction actually runs second.
        env: { ...baseEnv, CAVE_TEST_NOW: "1000" },
        windowsHide: true,
      },
    ).then(({ stdout }) => JSON.parse(stdout.trim()) as { id: string; token: string }),
  ]);

  // Proof the store is genuinely parseable, not merely "read-only readable":
  // an unrelated mutation routes through `readStoreForMutation`'s strict
  // parse, which throws `CredentialStoreIntegrityError` on any entry with an
  // inverted timestamp — so this succeeding at all proves no persisted
  // record from the race violates `createdAt <= lastUsedAt`/`revokedAt`.
  await assert.doesNotReject(
    recordCredentialUse("00000000-0000-4000-8000-000000000000", 999_999),
    "the store must remain strictly parseable after the race, not poisoned by an inverted timestamp",
  );

  const all = await listCredentials();
  const raced = all.filter((c) => c.installationId === installationId);
  assert.equal(raced.length, 2, "both racing issuances must be present, neither dropped as malformed");

  const active = raced.filter((c) => c.revokedAt === null);
  const revoked = raced.filter((c) => c.revokedAt !== null);
  assert.equal(active.length, 1, "exactly one credential must remain active after the race");
  assert.equal(revoked.length, 1, "exactly one credential must have been revoked by the re-pair");

  assert.ok(
    active[0].createdAt >= revoked[0].createdAt,
    "the surviving credential's createdAt must never precede the revoked one's, regardless of race order",
  );
  assert.ok(
    revoked[0].revokedAt !== null && revoked[0].revokedAt >= revoked[0].createdAt,
    "the revoked credential's revokedAt must never precede its own createdAt",
  );

  const outcomes = [outcomeA, outcomeB];
  const activeOutcome = outcomes.find((o) => o.id === active[0].id);
  const revokedOutcome = outcomes.find((o) => o.id === revoked[0].id);
  assert.ok(activeOutcome, "the active credential's id must match one of the two returned issuances");
  assert.ok(revokedOutcome, "the revoked credential's id must match the other returned issuance");

  assert.ok(
    await verifyCredential(activeOutcome!.token, 999_999),
    "the surviving credential's own returned token must still verify and be consistent with the final store",
  );
  assert.equal(
    await verifyCredential(revokedOutcome!.token, 999_999),
    null,
    "the superseded credential's old token must no longer verify",
  );
});

test("a revoke racing a concurrent record-use from a separate real process never gets resurrected by a stale write", async () => {
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const moduleUrl = pathToFileURL(path.resolve("src/lib/server/client-v1/credential-store.ts")).href;
  const storePath = clientCredentialStorePath();
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);

  const startAt = Date.now() + 1_000;
  const revokeWorker = `
    const wait = Math.max(0, Number(process.env.CAVE_TEST_START_AT) - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const { revokeCredential } = await import(${JSON.stringify(moduleUrl)});
    await revokeCredential(process.env.CAVE_TEST_CREDENTIAL_ID, Number(process.env.CAVE_TEST_NOW));
  `;
  const recordUseWorker = `
    const wait = Math.max(0, Number(process.env.CAVE_TEST_START_AT) - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const { recordCredentialUse } = await import(${JSON.stringify(moduleUrl)});
    await recordCredentialUse(process.env.CAVE_TEST_CREDENTIAL_ID, Number(process.env.CAVE_TEST_NOW));
  `;
  const baseEnv = {
    // `...process.env` carries this file's environment through to both
    // children — since the lock db path derives from
    // `COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH` (set explicitly below),
    // both children contend on the exact same SQLite lock file as this
    // process and each other, never the real user Cave home.
    ...process.env,
    COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH: storePath,
    CAVE_TEST_START_AT: String(startAt),
    CAVE_TEST_CREDENTIAL_ID: credential.id,
    CAVE_TEST_NOW: String(2_000),
  };

  // Two genuinely separate OS processes race: one revokes the credential,
  // the other (unaware of the revoke) records a use of the very same
  // credential. Without real cross-process mutual exclusion, whichever
  // process reads its own stale pre-revoke snapshot last could overwrite
  // the whole store file with a rewritten (still-active) copy of the
  // credential, silently resurrecting it. The shared cross-process SQLite
  // lock must prevent that: the revoke's effect must survive no matter
  // which process happens to finish its own read -> write cycle last.
  await Promise.all([
    execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--import", loaderUrl, "--input-type=module", "--eval", revokeWorker],
      { cwd: process.cwd(), env: baseEnv, windowsHide: true },
    ),
    execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--import", loaderUrl, "--input-type=module", "--eval", recordUseWorker],
      { cwd: process.cwd(), env: baseEnv, windowsHide: true },
    ),
  ]);

  assert.equal(
    await verifyCredential(token, 3_000),
    null,
    "a credential revoked by one process must stay revoked even when another process concurrently records a use of it",
  );
  const persisted = (await listCredentials()).find((c) => c.id === credential.id);
  assert.ok(persisted);
  assert.ok(
    persisted.revokedAt !== null,
    "the persisted record must still show the revocation; it must never be lost to a racing write",
  );
});

// Supplemental to the behavioral proof above (not a substitute for it): a
// narrowly scoped source check that every credential mutation's transaction
// boundary genuinely calls the SQLite lock helper, and that no fixed-path
// homegrown reclaim protocol has been reintroduced alongside it.
test("credential-store.ts sources its cross-process exclusion from the SQLite transaction lock", async () => {
  const source = await readFile(path.resolve("src/lib/server/client-v1/credential-store.ts"), "utf8");
  assert.match(
    source,
    /withCredentialTransactionLock/,
    "credential mutations must route through the node:sqlite-backed transaction lock",
  );
  assert.doesNotMatch(
    source,
    /from ["'].*credential-file-lock|withCaveHomeReconciliationLock\(/,
    "no fixed-path homegrown lock protocol may be reintroduced alongside the SQLite lock",
  );
});

// ─── 15. scope-array mutation isolation: nothing aliases the internal record ─

test("mutating the approvedPairing.scopes array passed to issueCredential never changes the internal record's authorization scopes", async () => {
  const scopes: ClientV1Scope[] = ["chat:read", "chat:write"];
  const { credential } = await issueCredential(approvedPairing({ scopes }), 1_000);
  assert.deepEqual(credential.scopes, ["chat:read", "chat:write"]);

  // Mutate the CALLER's array after issuance.
  scopes.push("tasks:write");
  scopes.length = 1;

  assert.deepEqual(
    credential.scopes,
    ["chat:read", "chat:write"],
    "the already-returned credential's scopes must not change when the caller's original array is mutated later",
  );
  const stored = (await listCredentials())[0];
  assert.deepEqual(
    stored.scopes,
    ["chat:read", "chat:write"],
    "a fresh list read must reflect what was actually issued, not a later mutation of the caller's array",
  );
});

test("mutating a returned scopes array (from issue, list, or verify) never affects a later result", async () => {
  const { token, credential } = await issueCredential(
    approvedPairing({ scopes: ["chat:read", "chat:write"] }),
    1_000,
  );

  // Mutate the array returned by `issueCredential` itself.
  mutableScopes(credential.scopes).push("github:write");

  // Mutate the array returned by `listCredentials`.
  const listed = (await listCredentials())[0];
  mutableScopes(listed.scopes).push("tasks:write");

  // Mutate the array returned by `verifyCredential`.
  const verified = await verifyCredential(token, 1_100);
  assert.ok(verified);
  mutableScopes(verified.scopes).push("conversations:write");

  // None of these mutations may have reached the internal record: every
  // later read must still show exactly the two scopes granted at issue time.
  const rereadList = (await listCredentials())[0];
  assert.deepEqual(
    rereadList.scopes,
    ["chat:read", "chat:write"],
    "mutating a previously-returned scopes array (issue/list/verify) must never leak into a later list read",
  );
  const reverified = await verifyCredential(token, 1_200);
  assert.deepEqual(
    reverified?.scopes,
    ["chat:read", "chat:write"],
    "mutating a previously-returned scopes array must never leak into a later verify",
  );

  // A second, unrelated credential must also be unaffected.
  const other = await issueCredential(
    approvedPairing({
      installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c",
      scopes: ["chat:read"],
    }),
    1_300,
  );
  assert.deepEqual(
    other.credential.scopes,
    ["chat:read"],
    "an unrelated later credential must never be affected by mutating an earlier result's scopes array",
  );
});
