// Behavioral tests for the persistent mutation idempotency ledger
// (idempotency-store.ts): composite-identity claim/replay/conflict/reclaim
// lifecycle, restart persistence, concurrency, capacity, corruption
// handling, and the deterministic request-hash helper. Mirrors
// credential-store.test.ts's established pattern for this facade: a workdir
// inside this worktree's own `.test-tmp` (never `os.tmpdir()`), env var
// override, and injected read/delay test seams instead of mocking `node:fs`
// or timers.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-idempotency-store-"));
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "client-v1-operations.json");

const {
  MAX_OPERATIONS,
  MAX_JSON_NESTING_DEPTH,
  clientOperationStorePath,
  claimOperation,
  completeOperation,
  findCompletedOperation,
  releaseOperation,
  canonicalizeJsonValue,
  hashNormalizedRequest,
  isIdempotencyStoreIntegrityError,
  isUnhashableRequestValueError,
  setPostReadDelayForTest,
  setReadFileForTest,
} = await import("./idempotency-store.ts");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(clientOperationStorePath(), { force: true });
  setPostReadDelayForTest(null);
  setReadFileForTest(null);
});

// Deterministic delay for the concurrency tests below: every locked
// mutation awaits this hook right after its own `readStoreForMutation()`
// and before it mutates/writes. A real (if short) async delay here — rather
// than a same-tick `Promise.resolve()` — widens the window a concurrently
// invoked second call WOULD read a stale snapshot in if the module-local
// mutation queue were missing or broken; these tests still pass
// deterministically with the queue in place because a queued mutation's
// `readStoreForMutation()` never even runs until every earlier-queued
// mutation's entire critical section (delay included) has finished.
function delayHook(ms: number): () => Promise<void> {
  return () => new Promise((resolve) => setTimeout(resolve, ms));
}

let fixtureSeed = 0;
function fixtureUuid(): string {
  fixtureSeed += 1;
  return `4e8b1b3e-9c1a-4f0a-8b1a-${String(fixtureSeed).padStart(12, "0")}`;
}

function claimInput(overrides: Partial<Parameters<typeof claimOperation>[0]> = {}) {
  return {
    key: fixtureUuid(),
    credentialId: fixtureUuid(),
    route: "conversations",
    requestHash: hashNormalizedRequest({ ok: true }),
    ...overrides,
  };
}

async function claimedInput() {
  const input = claimInput();
  const result = await claimOperation(input);
  assert.equal(result.kind, "claimed");
  return { input, claimId: (result as { kind: "claimed"; claimId: string }).claimId };
}

// ─── 1. claim / complete / replay / conflict (the plan's own worked example,
//        adapted to this module's actual completeOperation signature — see
//        the header comment on completeOperation for why `key` alone is
//        unsafe and a claim id is required instead) ───────────────────────

test("a brand-new key claims fresh", async () => {
  const input = claimInput();
  const result = await claimOperation(input);
  assert.equal(result.kind, "claimed");
  assert.ok((result as { claimId: string }).claimId);
});

test("a retryable release retains request-hash ownership while allowing an exact retry to claim fresh", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  assert.equal(first.kind, "claimed");
  const firstClaimId = (first as { claimId: string }).claimId;

  assert.deepEqual(await releaseOperation({ key: input.key, claimId: firstClaimId }, 2_000), { kind: "released" });

  const released = JSON.parse(await readFile(clientOperationStorePath(), "utf8")).operations[0];
  assert.equal(released.state, "retryable");
  assert.equal(released.requestHash, input.requestHash);
  assert.equal(released.response, null);
  assert.equal(released.expiresAt, 2_000 + 24 * 60 * 60_000);

  const differentRequest = await claimOperation(
    { ...input, requestHash: hashNormalizedRequest({ ok: false }) },
    2_001,
  );
  assert.equal(differentRequest.kind, "conflict", "a retryable key must retain its original request-hash ownership");

  const retry = await claimOperation(input, 2_001);
  assert.equal(retry.kind, "claimed");
  const retryClaimId = (retry as { claimId: string }).claimId;
  assert.notEqual(retryClaimId, firstClaimId);
  assert.deepEqual(
    await releaseOperation({ key: input.key, claimId: firstClaimId }, 2_002),
    { kind: "not_found" },
    "a stale claimant cannot release its successor",
  );

  await completeOperation({ key: input.key, claimId: retryClaimId }, { status: 202, body: { ok: true } }, 2_003);
  assert.deepEqual(
    await releaseOperation({ key: input.key, claimId: retryClaimId }, 2_004),
    { kind: "completed" },
    "release never deletes a terminal exact replay",
  );
  assert.equal((await claimOperation(input, 2_005)).kind, "replay");
});

test("a retryable reservation expires after the operation TTL, releasing the key for a new request hash", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  assert.equal(first.kind, "claimed");
  const claimId = (first as { claimId: string }).claimId;
  await releaseOperation({ key: input.key, claimId }, 2_000);

  const differentInput = { ...input, requestHash: hashNormalizedRequest({ ok: false }) };
  assert.equal((await claimOperation(differentInput, 2_000 + 24 * 60 * 60_000 - 1)).kind, "conflict");

  const expired = await claimOperation(differentInput, 2_000 + 24 * 60 * 60_000);
  assert.equal(expired.kind, "claimed");
});

test("completing a claimed operation returns the completed response, and the same identity later replays it verbatim", async () => {
  const input = claimInput();
  const claimed = await claimOperation(input);
  assert.equal(claimed.kind, "claimed");
  const claimId = (claimed as { kind: "claimed"; claimId: string }).claimId;

  const completed = await completeOperation({ key: input.key, claimId }, { status: 201, body: { ok: true, id: "session-1" } });
  assert.equal(completed.kind, "completed");
  assert.deepEqual((completed as { response: unknown }).response, { status: 201, body: { ok: true, id: "session-1" } });

  const replay = await claimOperation(input);
  assert.equal(replay.kind, "replay");
  assert.deepEqual((replay as { response: unknown }).response, { status: 201, body: { ok: true, id: "session-1" } });
});

test("completed run metadata is readable only by its credential and route after persistence", async () => {
  const input = claimInput({ route: "messages-send" });
  const claimed = await claimOperation(input);
  assert.equal(claimed.kind, "claimed");
  const response = {
    status: 409,
    body: {
      error: {
        code: "operation_already_started",
        details: {
          runId: input.key,
          conversationId: "conversation-safe",
          resumePath: `/api/client/v1/runs/${input.key}/stream`,
        },
      },
    },
  };
  await completeOperation(
    { key: input.key, claimId: (claimed as { claimId: string }).claimId },
    response,
  );
  assert.deepEqual(await findCompletedOperation({
    key: input.key,
    credentialId: input.credentialId,
    route: input.route,
  }), response);
  assert.equal(await findCompletedOperation({
    key: input.key,
    credentialId: fixtureUuid(),
    route: input.route,
  }), null);
});

test("the same key with a different requestHash, same composite identity, conflicts — never replaying across a different body", async () => {
  const input = claimInput();
  const claimed = await claimOperation(input);
  const claimId = (claimed as { kind: "claimed"; claimId: string }).claimId;
  await completeOperation({ key: input.key, claimId }, { status: 200, body: {} });

  const conflict = await claimOperation({ ...input, requestHash: hashNormalizedRequest({ ok: false }) });
  assert.equal(conflict.kind, "conflict");
});

// ─── 1b. composite identity: (credentialId, route, key), never key alone ──

test("the same UUID key claimed by a different credentialId is an independent composite identity, claiming fresh rather than conflicting", async () => {
  const input = claimInput();
  const claimed = await claimOperation(input);
  const claimId = (claimed as { kind: "claimed"; claimId: string }).claimId;
  await completeOperation({ key: input.key, claimId }, { status: 200, body: { owner: "first" } });

  const otherCredentialId = fixtureUuid();
  const independent = await claimOperation({ ...input, credentialId: otherCredentialId });
  assert.equal(independent.kind, "claimed", "a different credentialId must claim the same bare key independently, not conflict");

  const otherClaimId = (independent as { claimId: string }).claimId;
  const completedForOther = await completeOperation(
    { key: input.key, claimId: otherClaimId },
    { status: 201, body: { owner: "second" } },
  );
  assert.equal(completedForOther.kind, "completed");

  // Each credential's own completed result must still replay independently
  // — completing the second credential's claim must never disturb the
  // first credential's already-persisted result.
  const firstReplay = await claimOperation(input);
  assert.equal(firstReplay.kind, "replay");
  assert.deepEqual((firstReplay as { response: unknown }).response, { status: 200, body: { owner: "first" } });

  const secondReplay = await claimOperation({ ...input, credentialId: otherCredentialId });
  assert.equal(secondReplay.kind, "replay");
  assert.deepEqual((secondReplay as { response: unknown }).response, { status: 201, body: { owner: "second" } });
});

test("the same UUID key claimed against a different route is an independent composite identity, claiming fresh rather than conflicting", async () => {
  const input = claimInput();
  const claimed = await claimOperation(input);
  const claimId = (claimed as { kind: "claimed"; claimId: string }).claimId;
  await completeOperation({ key: input.key, claimId }, { status: 200, body: { route: "conversations" } });

  const independent = await claimOperation({ ...input, route: "attachments" });
  assert.equal(independent.kind, "claimed", "a different route must claim the same bare key independently, not conflict");

  const otherClaimId = (independent as { claimId: string }).claimId;
  const completedForOther = await completeOperation(
    { key: input.key, claimId: otherClaimId },
    { status: 201, body: { route: "attachments" } },
  );
  assert.equal(completedForOther.kind, "completed");

  const firstReplay = await claimOperation(input);
  assert.equal(firstReplay.kind, "replay");
  assert.deepEqual((firstReplay as { response: unknown }).response, { status: 200, body: { route: "conversations" } });

  const secondReplay = await claimOperation({ ...input, route: "attachments" });
  assert.equal(secondReplay.kind, "replay");
  assert.deepEqual((secondReplay as { response: unknown }).response, { status: 201, body: { route: "attachments" } });
});

test("a live in-progress claim under one composite identity does not block an independent claim under a different credentialId/route sharing the same key", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  assert.equal(first.kind, "claimed");

  // Still well within the first claim's own 10-minute retry window — a
  // second claim for the SAME composite identity would report "pending",
  // but a DIFFERENT composite identity sharing only the bare key must claim
  // fresh regardless.
  const independentByCredential = await claimOperation({ ...input, credentialId: fixtureUuid() }, 1_000 + 1);
  assert.equal(independentByCredential.kind, "claimed");

  const independentByRoute = await claimOperation({ ...input, route: "attachments" }, 1_000 + 2);
  assert.equal(independentByRoute.kind, "claimed");

  // The original composite identity's own claim is still live and unaffected.
  const stillPending = await claimOperation(input, 1_000 + 3);
  assert.equal(stillPending.kind, "pending");
});

// ─── 2. live pending claims never grant a second concurrent claim ─────────

test("a second claim of the exact same identity while the first is still pending reports pending with a retry hint", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  assert.equal(first.kind, "claimed");

  const second = await claimOperation(input, 1_000 + 60_000);
  assert.equal(second.kind, "pending");
  assert.equal((second as { retryAfterMs: number }).retryAfterMs, 10 * 60_000 - 60_000);
});

test("a pending claim older than 10 minutes becomes reclaimable, issuing a fresh claim id", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  assert.equal(first.kind, "claimed");
  const firstClaimId = (first as { claimId: string }).claimId;

  const stillPending = await claimOperation(input, 1_000 + 10 * 60_000 - 1);
  assert.equal(stillPending.kind, "pending");

  const reclaimed = await claimOperation(input, 1_000 + 10 * 60_000);
  assert.equal(reclaimed.kind, "claimed");
  const secondClaimId = (reclaimed as { claimId: string }).claimId;
  assert.notEqual(secondClaimId, firstClaimId, "a reclaim must mint a fresh claim id");
});

test("a stale claimant from before a reclaim can never complete the entry the reclaimer now owns", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  const staleClaimId = (first as { kind: "claimed"; claimId: string }).claimId;

  const reclaimed = await claimOperation(input, 1_000 + 10 * 60_000);
  assert.equal(reclaimed.kind, "claimed");

  const staleComplete = await completeOperation({ key: input.key, claimId: staleClaimId }, { status: 200, body: {} }, 1_000 + 10 * 60_000 + 1);
  assert.equal(staleComplete.kind, "not_found", "a stale claim id must never be able to complete a reclaimed entry");

  const freshClaimId = (reclaimed as { claimId: string }).claimId;
  const freshComplete = await completeOperation({ key: input.key, claimId: freshClaimId }, { status: 200, body: { fresh: true } }, 1_000 + 10 * 60_000 + 2);
  assert.equal(freshComplete.kind, "completed", "the reclaimer's own claim id must still be able to complete");
});

// ─── 3. completeOperation identity/idempotency ─────────────────────────────

test("completeOperation on an unknown key returns not_found", async () => {
  const result = await completeOperation({ key: fixtureUuid(), claimId: fixtureUuid() }, { status: 200, body: {} });
  assert.equal(result.kind, "not_found");
});

test("completeOperation looks up by claimId (globally unique), never by key alone — a valid claimId for a different key returns not_found rather than completing the wrong composite claim", async () => {
  const { claimId } = await claimedInput();
  const unrelatedKey = fixtureUuid();
  const result = await completeOperation({ key: unrelatedKey, claimId }, { status: 200, body: {} });
  assert.equal(
    result.kind,
    "not_found",
    "a claimId that exists but whose owning entry's key doesn't match the caller-supplied key must never complete",
  );
});

test("completeOperation targets the exact composite claim: two independent composite identities sharing a bare key each complete only their own claimId", async () => {
  const input = claimInput();
  const first = await claimOperation(input);
  const firstClaimId = (first as { kind: "claimed"; claimId: string }).claimId;

  const otherCredentialId = fixtureUuid();
  const second = await claimOperation({ ...input, credentialId: otherCredentialId });
  const secondClaimId = (second as { kind: "claimed"; claimId: string }).claimId;
  assert.notEqual(firstClaimId, secondClaimId);

  // Completing with the SECOND claim's id must complete only the second
  // composite identity's entry — the first must remain untouched (still
  // in-progress, still completable by its own claim id).
  const completedSecond = await completeOperation({ key: input.key, claimId: secondClaimId }, { status: 202, body: { who: "second" } });
  assert.equal(completedSecond.kind, "completed");

  const firstStillPending = await claimOperation(input);
  assert.equal(firstStillPending.kind, "pending", "the first composite identity's claim must be untouched by completing the second's");

  const completedFirst = await completeOperation({ key: input.key, claimId: firstClaimId }, { status: 200, body: { who: "first" } });
  assert.equal(completedFirst.kind, "completed");
});

test("completing the same claim twice with an identical response replays idempotently", async () => {
  const { input, claimId } = await claimedInput();
  const first = await completeOperation({ key: input.key, claimId }, { status: 200, body: { a: 1 } });
  assert.equal(first.kind, "completed");
  const second = await completeOperation({ key: input.key, claimId }, { status: 200, body: { a: 1 } });
  assert.equal(second.kind, "replay");
  assert.deepEqual((second as { response: unknown }).response, { status: 200, body: { a: 1 } });
});

test("completing the same claim twice with a different response rejects as conflict, never overwriting the persisted result", async () => {
  const { input, claimId } = await claimedInput();
  await completeOperation({ key: input.key, claimId }, { status: 200, body: { a: 1 } });
  const second = await completeOperation({ key: input.key, claimId }, { status: 200, body: { a: 2 } });
  assert.equal(second.kind, "conflict");

  const replay = await claimOperation(input);
  assert.equal(replay.kind, "replay");
  assert.deepEqual((replay as { response: unknown }).response, { status: 200, body: { a: 1 } }, "the original response must remain unchanged");
});

// ─── 4. completed entries expire after 24h and can then be claimed fresh ──

test("a completed entry expires after 24 hours and is claimed fresh (never replayed) afterward", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  const claimId = (first as { kind: "claimed"; claimId: string }).claimId;
  await completeOperation({ key: input.key, claimId }, { status: 200, body: { once: true } }, 1_000);

  const stillReplays = await claimOperation(input, 1_000 + 24 * 60 * 60_000 - 1);
  assert.equal(stillReplays.kind, "replay");

  const expiredClaim = await claimOperation(input, 1_000 + 24 * 60 * 60_000);
  assert.equal(expiredClaim.kind, "claimed", "an expired completed entry must be claimed fresh, not replayed");
  assert.notEqual((expiredClaim as { claimId: string }).claimId, claimId);
});

// ─── 4b. completeOperation clamps a wall-clock rollback so a completed
//         entry's own `updatedAt` can never regress behind its `claimedAt`
//         (which would otherwise violate parseClientOperation's strict
//         `updatedAt >= claimedAt` invariant and poison every later read of
//         the whole store with IdempotencyStoreIntegrityError) ───────────

test("completing with a caller `now` that has rolled backward behind the claim's own claimedAt never persists an invariant-violating record, and the ledger stays readable/replayable with the exact clamped expiry", async () => {
  const input = claimInput();
  const claimed = await claimOperation(input, 100_000);
  assert.equal(claimed.kind, "claimed");
  const claimId = (claimed as { kind: "claimed"; claimId: string }).claimId;

  // The caller's clock has stepped backward all the way to 0 — well behind
  // this claim's own `claimedAt` of 100_000 — by the time completion runs.
  const completed = await completeOperation({ key: input.key, claimId }, { status: 200, body: { rollback: true } }, 0);
  assert.equal(completed.kind, "completed");
  assert.deepEqual((completed as { response: unknown }).response, { status: 200, body: { rollback: true } });

  // The persisted record itself must satisfy `updatedAt >= claimedAt` and
  // the exact `expiresAt === updatedAt + COMPLETED_OPERATION_TTL_MS`
  // invariant — read the raw file rather than trusting only the return
  // value, since `completeOperation`'s own next-mutation re-read (via
  // `claimOperation` below) would already throw `IdempotencyStoreIntegrityError`
  // if the unclamped `now` (0) had been written through.
  const raw = JSON.parse(await readFile(clientOperationStorePath(), "utf8")) as {
    operations: Array<{ claimId: string; claimedAt: number; updatedAt: number; expiresAt: number }>;
  };
  const persisted = raw.operations.find((operation) => operation.claimId === claimId);
  assert.ok(persisted, "the completed entry must still be present in the ledger");
  assert.equal(persisted!.updatedAt, 100_000, "updatedAt must be clamped to claimedAt, never the rolled-back now (0)");
  assert.equal(
    persisted!.expiresAt,
    100_000 + 24 * 60 * 60_000,
    "expiresAt must be exactly the clamped updatedAt plus COMPLETED_OPERATION_TTL_MS, never now (0) plus the TTL",
  );

  // The ledger must remain fully readable and replayable — a rolled-back
  // `now` at completion time must never surface as a corrupt-store error on
  // any later, unrelated mutation.
  const replay = await claimOperation(input, 100_000);
  assert.equal(replay.kind, "replay", "the ledger must remain readable/replayable after a completion with a rolled-back now");
  assert.deepEqual((replay as { response: unknown }).response, { status: 200, body: { rollback: true } });

  // The completed entry's expiry is exactly clamped-updatedAt + TTL — still
  // replayable one millisecond before it, expired (claimed fresh) exactly
  // at it — never keyed off the rolled-back `now` (0), which would have
  // made it expire 24h+100s earlier than this.
  const stillReplays = await claimOperation(input, 100_000 + 24 * 60 * 60_000 - 1);
  assert.equal(stillReplays.kind, "replay");
  const expiredClaim = await claimOperation(input, 100_000 + 24 * 60 * 60_000);
  assert.equal(expiredClaim.kind, "claimed", "past its clamped expiry the entry must be claimed fresh, not replayed");
  assert.notEqual((expiredClaim as { claimId: string }).claimId, claimId);

  // A completion-time rollback for one composite identity must never poison
  // the whole store for an entirely unrelated one: a brand-new identity
  // still claims fresh normally afterward.
  const otherInput = claimInput();
  const otherClaim = await claimOperation(otherInput, 100_000);
  assert.equal(otherClaim.kind, "claimed", "an unrelated identity must still claim fresh after another entry's rolled-back completion");
});

// ─── 5. restart persistence: a fresh module instance, same file, replays ──

test("a completed response persists across a fresh module import (restart) without any in-memory state", async () => {
  const { input, claimId } = await claimedInput();
  await completeOperation({ key: input.key, claimId }, { status: 201, body: { restarted: true } });

  const modulePath = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "idempotency-store.ts");
  const freshModule = (await import(`${pathToFileURL(modulePath).href}?fresh=${Date.now()}-${Math.random()}`)) as typeof import("./idempotency-store.ts");

  const replay = await freshModule.claimOperation(input);
  assert.equal(replay.kind, "replay", "a fresh module instance must replay the completed response purely from disk");
  assert.deepEqual((replay as { response: unknown }).response, { status: 201, body: { restarted: true } });
});

// ─── 6. exactly one claimant wins a concurrent race ───────────────────────

test("concurrent claims for a brand-new identity grant exactly one claim, the rest see pending", async () => {
  const input = claimInput();
  setPostReadDelayForTest(delayHook(20));
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => claimOperation(input, 1_000)));
    const claimed = results.filter((r) => r.kind === "claimed");
    const pending = results.filter((r) => r.kind === "pending");
    assert.equal(claimed.length, 1, "exactly one concurrent claimant must win");
    assert.equal(pending.length, 7, "every other concurrent caller must see pending, never a second claim");
  } finally {
    setPostReadDelayForTest(null);
  }
});

test("concurrent retries of a retryable reservation grant one fresh execution lease", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  assert.equal(first.kind, "claimed");
  await releaseOperation({ key: input.key, claimId: (first as { claimId: string }).claimId }, 2_000);

  setPostReadDelayForTest(delayHook(20));
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => claimOperation(input, 3_000)));
    assert.equal(results.filter((result) => result.kind === "claimed").length, 1);
    assert.equal(results.filter((result) => result.kind === "pending").length, 5);
  } finally {
    setPostReadDelayForTest(null);
  }
});

test("concurrent reclaim attempts on a stale pending entry grant exactly one fresh claim", async () => {
  const input = claimInput();
  await claimOperation(input, 1_000);
  setPostReadDelayForTest(delayHook(20));
  try {
    const now = 1_000 + 10 * 60_000;
    const results = await Promise.all(Array.from({ length: 6 }, () => claimOperation(input, now)));
    const claimed = results.filter((r) => r.kind === "claimed");
    const pending = results.filter((r) => r.kind === "pending");
    assert.equal(claimed.length, 1, "exactly one concurrent reclaimer must win");
    assert.equal(pending.length, 5);
  } finally {
    setPostReadDelayForTest(null);
  }
});

test("a mutation failure inside the queue does not poison later calls", async () => {
  const input = claimInput();
  setPostReadDelayForTest(() => Promise.reject(new Error("simulated queued mutation failure")));
  await assert.rejects(() => claimOperation(input));
  setPostReadDelayForTest(null);
  const retried = await claimOperation(input);
  assert.equal(retried.kind, "claimed", "a prior rejected mutation must never poison a later call for the same or a different key");
});

// ─── 7. capacity: bounded ledger, deterministic eviction, never live pending

function persistedOperation(overrides: Record<string, unknown> = {}) {
  return {
    key: fixtureUuid(),
    credentialId: fixtureUuid(),
    route: "conversations",
    requestHash: "a".repeat(64),
    state: "completed",
    claimId: fixtureUuid(),
    claimedAt: 1_000,
    updatedAt: 1_000,
    expiresAt: 1_000 + 24 * 60 * 60_000,
    response: { status: 200, body: { ok: true } },
    ...overrides,
  };
}

async function writeRawStore(store: unknown): Promise<void> {
  await writeFile(clientOperationStorePath(), JSON.stringify(store), "utf8");
}

test("at capacity, a new claim evicts the oldest completed entries first, never a live pending one", async () => {
  const operations = [];
  for (let i = 0; i < MAX_OPERATIONS - 1; i += 1) {
    operations.push(persistedOperation({ updatedAt: 1_000 + i, expiresAt: 1_000 + i + 24 * 60 * 60_000 }));
  }
  const livePending = persistedOperation({ state: "in_progress", response: null, updatedAt: 500, expiresAt: 500 + 10 * 60_000, claimedAt: 500 });
  operations.push(livePending);
  await writeRawStore({ version: 1, operations });

  const oldestCompletedKey = operations[0].key;
  const newInput = claimInput();
  // Deliberately well inside every persisted entry's 24h completed TTL, so
  // this claim's own TTL-prune step removes nothing — the only reason
  // capacity is freed here is the deterministic oldest-completed-first
  // eviction this test is checking, not an unrelated TTL expiry.
  const now = 2_000;
  const result = await claimOperation(newInput, now);
  assert.equal(result.kind, "claimed", "capacity must be freed by evicting a completed entry, admitting the new claim");

  const raw = JSON.parse(await readFile(clientOperationStorePath(), "utf8"));
  assert.equal(raw.operations.length, MAX_OPERATIONS);
  assert.ok(
    !raw.operations.some((op: { key: string }) => op.key === oldestCompletedKey),
    "the oldest completed entry must be the one evicted",
  );
  assert.ok(
    raw.operations.some((op: { key: string }) => op.key === livePending.key),
    "a live pending claim must never be evicted to admit new work",
  );
});

test("at capacity with no completed entries to evict, a new claim is refused with capacity_exceeded rather than evicting live in-progress work", async () => {
  const operations = [];
  for (let i = 0; i < MAX_OPERATIONS; i += 1) {
    operations.push(
      persistedOperation({ state: "in_progress", response: null, claimedAt: 500, updatedAt: 500, expiresAt: 500 + 10 * 60_000 }),
    );
  }
  await writeRawStore({ version: 1, operations });

  const result = await claimOperation(claimInput(), 600);
  assert.equal(result.kind, "capacity_exceeded");

  const raw = JSON.parse(await readFile(clientOperationStorePath(), "utf8"));
  assert.equal(raw.operations.length, MAX_OPERATIONS, "no in-progress entry may ever be evicted for capacity");
});

test("MAX_OPERATIONS in-progress entries all abandoned (past their 10-minute retry window) are pruned before the capacity check, freeing room without eviction", async () => {
  const operations = [];
  for (let i = 0; i < MAX_OPERATIONS; i += 1) {
    operations.push(
      persistedOperation({ state: "in_progress", response: null, claimedAt: 500, updatedAt: 500, expiresAt: 500 + 10 * 60_000 }),
    );
  }
  await writeRawStore({ version: 1, operations });

  // Exactly at (and past) every entry's abandonment threshold — all
  // MAX_OPERATIONS in-progress entries are abandoned and must be pruned
  // outright before the capacity check runs, never merely "eligible for
  // eviction" (which would still refuse capacity, since in-progress entries
  // are never evicted) and never left occupying a capacity slot forever.
  const now = 500 + 10 * 60_000;
  const result = await claimOperation(claimInput(), now);
  assert.equal(result.kind, "claimed", "abandoned in-progress claims must be pruned before the capacity check, not permanently exhaust capacity");

  const raw = JSON.parse(await readFile(clientOperationStorePath(), "utf8"));
  assert.equal(raw.operations.length, 1, "every abandoned in-progress entry must have been pruned, leaving only the fresh claim");
});

test("an abandoned in-progress entry is pruned outright (not merely reinterpreted) and its composite identity is free for a brand-new independent claim", async () => {
  const input = claimInput();
  const first = await claimOperation(input, 1_000);
  const firstClaimId = (first as { kind: "claimed"; claimId: string }).claimId;

  // Past the 10-minute abandonment threshold with no completion ever
  // recorded — the composite identity's own reclaim path (same
  // credentialId/route/key) already covers "same identity, fresh claim id"
  // (see the earlier "becomes reclaimable" test); this test instead checks
  // that the abandoned row is gone from disk entirely, not merely
  // recognized as stale in memory.
  const now = 1_000 + 10 * 60_000;
  const reclaimed = await claimOperation(input, now);
  assert.equal(reclaimed.kind, "claimed");
  assert.notEqual((reclaimed as { claimId: string }).claimId, firstClaimId);

  const raw = JSON.parse(await readFile(clientOperationStorePath(), "utf8"));
  assert.equal(raw.operations.length, 1, "the abandoned entry must be pruned, leaving only the fresh reclaim");
  assert.equal(raw.operations[0].claimId, (reclaimed as { claimId: string }).claimId);
});

// ─── 8. privacy: the persisted ledger excludes prompts/tokens/raw bodies ──

test("the persisted ledger never contains the raw request body, only its hash, and never a bearer token or authorization header", async () => {
  const sentinelPrompt = "sk-live-secret-token-do-not-persist-this-prompt-or-body";
  const input = claimInput({ requestHash: hashNormalizedRequest({ prompt: sentinelPrompt }) });
  const claimed = await claimOperation(input);
  const claimId = (claimed as { kind: "claimed"; claimId: string }).claimId;
  await completeOperation(
    { key: input.key, claimId },
    { status: 201, body: { ok: true, echoedPromptPreview: "safe-summary-only" } },
  );

  const raw = await readFile(clientOperationStorePath(), "utf8");
  assert.equal(raw.includes(sentinelPrompt), false, "the raw prompt/body must never be written to disk");
  assert.equal(raw.includes("authorization"), false);
  assert.equal(raw.includes("Bearer"), false);

  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  const entry = parsed.operations[0];
  assert.deepEqual(
    Object.keys(entry).sort(),
    ["claimId", "claimedAt", "credentialId", "expiresAt", "key", "requestHash", "response", "route", "state", "updatedAt"],
  );
});

test("mutating the returned response object never reaches back into the persisted ledger (deep clone in and out)", async () => {
  const { input, claimId } = await claimedInput();
  const body: { list: number[] } = { list: [1, 2, 3] };
  const completed = await completeOperation({ key: input.key, claimId }, { status: 200, body });
  body.list.push(999);
  ((completed as { response: { body: { list: number[] } } }).response.body.list as number[]).push(-1);

  const replay = await claimOperation(input);
  assert.deepEqual((replay as { response: { body: { list: number[] } } }).response.body, { list: [1, 2, 3] }, "caller mutation of either the input body or a returned response must never alter the ledger's own copy");
});

// ─── 9. corruption / read errors fail closed for mutations ────────────────

function fsError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("claimOperation still treats a genuinely missing store (ENOENT) as an empty ledger", async () => {
  setReadFileForTest(async () => {
    throw fsError("ENOENT", "no such file or directory");
  });
  const result = await claimOperation(claimInput());
  setReadFileForTest(null);
  assert.equal(result.kind, "claimed");
});

test("claimOperation rejects with a typed integrity error when the store cannot be read, and does not poison later calls", async () => {
  const input = claimInput();
  const claimed = await claimOperation(input);
  const claimId = (claimed as { kind: "claimed"; claimId: string }).claimId;
  await completeOperation({ key: input.key, claimId }, { status: 200, body: {} });
  const before = await readFile(clientOperationStorePath(), "utf8");

  setReadFileForTest(async () => {
    throw fsError("EACCES", "permission denied");
  });
  await assert.rejects(
    () => claimOperation(claimInput()),
    (error: unknown) => isIdempotencyStoreIntegrityError(error),
  );
  assert.equal(await readFile(clientOperationStorePath(), "utf8"), before, "a rejected mutation must never have written anything");

  setReadFileForTest(null);
  const retried = await claimOperation(claimInput());
  assert.equal(retried.kind, "claimed", "a prior read failure must not poison a later mutation");
});

test("invalid JSON in the store rejects claimOperation and completeOperation with a typed integrity error", async () => {
  await writeFile(clientOperationStorePath(), "{ not json", "utf8");
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
  await assert.rejects(
    () => completeOperation({ key: fixtureUuid(), claimId: fixtureUuid() }, { status: 200, body: {} }),
    (error: unknown) => isIdempotencyStoreIntegrityError(error),
  );
});

test("a wrong top-level version or an extra top-level key rejects the whole store", async () => {
  await writeRawStore({ version: 2, operations: [] });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));

  await writeRawStore({ version: 1, operations: [], extra: "nope" });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));

  await writeRawStore({ version: 1, operations: "nope" });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
});

test("a single malformed persisted entry rejects the whole store rather than being silently dropped", async () => {
  await writeRawStore({ version: 1, operations: [persistedOperation({ requestHash: "not-hex" })] });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));

  await writeRawStore({ version: 1, operations: [persistedOperation({ route: "Not_Valid_Route!" })] });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));

  await writeRawStore({ version: 1, operations: [persistedOperation({ state: "done" })] });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));

  // The legacy "pending" spelling must never be silently accepted as a
  // synonym for the persisted "in_progress" literal.
  await writeRawStore({ version: 1, operations: [persistedOperation({ state: "pending", response: null })] });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));

  await writeRawStore({ version: 1, operations: [persistedOperation({ extraField: "nope" })] });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));

  await writeRawStore({ version: 1, operations: [persistedOperation({ state: "in_progress", response: { status: 200, body: {} } })] });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));

  await writeRawStore({ version: 1, operations: [persistedOperation({ state: "completed", response: null })] });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
});

// ─── 9b. cross-entry invariants: duplicate composite identity, duplicate
//         claim id, over-capacity, and exact expiry-formula drift ─────────

test("a malformed file with two entries sharing the same composite identity (credentialId, route, key) rejects the whole store", async () => {
  const shared = { key: fixtureUuid(), credentialId: fixtureUuid(), route: "conversations" };
  const operations = [
    persistedOperation({ ...shared, claimId: fixtureUuid() }),
    persistedOperation({ ...shared, claimId: fixtureUuid(), updatedAt: 2_000, expiresAt: 2_000 + 24 * 60 * 60_000 }),
  ];
  await writeRawStore({ version: 1, operations });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
  await assert.rejects(
    () => completeOperation({ key: shared.key, claimId: operations[0].claimId }, { status: 200, body: {} }),
    (error: unknown) => isIdempotencyStoreIntegrityError(error),
  );
});

test("a malformed file with two entries sharing the same requestHash but different composite identities is NOT a duplicate — only shared (credentialId, route, key) is rejected", async () => {
  const operations = [
    persistedOperation({ requestHash: "a".repeat(64) }),
    persistedOperation({ requestHash: "a".repeat(64) }),
  ];
  await writeRawStore({ version: 1, operations });
  // Distinct key/credentialId/route (persistedOperation mints a fresh
  // fixtureUuid() for each unless overridden) — this must NOT trip the
  // duplicate-composite-identity check.
  const result = await claimOperation(claimInput());
  assert.equal(result.kind, "claimed");
});

test("a malformed file with two entries sharing the same claim id (even under different composite identities) rejects the whole store", async () => {
  const sharedClaimId = fixtureUuid();
  const operations = [
    persistedOperation({ claimId: sharedClaimId }),
    persistedOperation({ claimId: sharedClaimId, updatedAt: 2_000, expiresAt: 2_000 + 24 * 60 * 60_000 }),
  ];
  await writeRawStore({ version: 1, operations });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
});

test("a malformed file with more than MAX_OPERATIONS entries rejects the whole store rather than silently truncating", async () => {
  const operations = Array.from({ length: MAX_OPERATIONS + 1 }, (_, i) =>
    persistedOperation({ updatedAt: 1_000 + i, expiresAt: 1_000 + i + 24 * 60 * 60_000 }),
  );
  await writeRawStore({ version: 1, operations });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
});

test("a malformed file with an in-progress entry whose expiresAt drifts from claimedAt + PENDING_CLAIM_RETRY_MS by even one millisecond rejects the whole store", async () => {
  await writeRawStore({
    version: 1,
    operations: [
      persistedOperation({
        state: "in_progress",
        response: null,
        claimedAt: 1_000,
        updatedAt: 1_000,
        expiresAt: 1_000 + 10 * 60_000 + 1, // one millisecond off the exact formula
      }),
    ],
  });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
});

test("a malformed file with an in-progress entry whose updatedAt has drifted from claimedAt rejects the whole store", async () => {
  await writeRawStore({
    version: 1,
    operations: [
      persistedOperation({
        state: "in_progress",
        response: null,
        claimedAt: 1_000,
        updatedAt: 1_001, // an in-progress claim must never have been "updated" since it was granted
        expiresAt: 1_001 + 10 * 60_000,
      }),
    ],
  });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
});

test("a malformed file with a completed entry whose expiresAt drifts from updatedAt + COMPLETED_OPERATION_TTL_MS rejects the whole store", async () => {
  await writeRawStore({
    version: 1,
    operations: [
      persistedOperation({
        state: "completed",
        updatedAt: 1_000,
        expiresAt: 1_000 + 24 * 60 * 60_000 - 1, // one millisecond off the exact formula
      }),
    ],
  });
  await assert.rejects(() => claimOperation(claimInput()), (error: unknown) => isIdempotencyStoreIntegrityError(error));
});

test("a write failure (e.g. a blocked target directory) rejects the mutation without poisoning the queue once cleared", async () => {
  const nestedDir = path.join(workdir, "blocked-parent");
  const blockedStorePath = path.join(nestedDir, "operations.json");
  await writeFile(nestedDir, "this occupies the path a directory would need", "utf8");
  process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = blockedStorePath;

  const input = claimInput();
  await assert.rejects(() => claimOperation(input), "mkdir over an existing file must reject the write");

  await rm(nestedDir, { force: true });
  const retried = await claimOperation(input);
  assert.equal(retried.kind, "claimed", "once the blocking file is removed, the same call must succeed and not be poisoned");

  process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "client-v1-operations.json");
});

// ─── 10. hashNormalizedRequest: canonicalization equivalence / distinction / rejection

test("hashNormalizedRequest produces the same hash for structurally identical objects regardless of key order", () => {
  const a = hashNormalizedRequest({ a: 1, b: 2, c: { x: 1, y: 2 } });
  const b = hashNormalizedRequest({ c: { y: 2, x: 1 }, b: 2, a: 1 });
  assert.equal(a, b);
});

test("hashNormalizedRequest preserves array order as meaningfully distinct", () => {
  const a = hashNormalizedRequest({ list: [1, 2, 3] });
  const b = hashNormalizedRequest({ list: [3, 2, 1] });
  assert.notEqual(a, b);
});

test("hashNormalizedRequest treats different JSON value kinds as distinct", () => {
  const asNumber = hashNormalizedRequest({ value: 1 });
  const asString = hashNormalizedRequest({ value: "1" });
  const asNull = hashNormalizedRequest({ value: null });
  const asMissing = hashNormalizedRequest({});
  const asTrue = hashNormalizedRequest({ value: true });
  const hashes = new Set([asNumber, asString, asNull, asMissing, asTrue]);
  assert.equal(hashes.size, 5, "every distinct JSON value kind must hash differently");
});

test("hashNormalizedRequest is a lowercase 64-character hex SHA-256 digest", () => {
  const hash = hashNormalizedRequest({ anything: true });
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("hashNormalizedRequest rejects non-finite numbers, undefined, functions, symbols, bigints, and cycles", () => {
  assert.throws(() => hashNormalizedRequest({ n: Number.NaN }));
  assert.throws(() => hashNormalizedRequest({ n: Infinity }));
  assert.throws(() => hashNormalizedRequest({ n: -Infinity }));
  assert.throws(() => hashNormalizedRequest({ n: undefined }));
  assert.throws(() => hashNormalizedRequest({ n: () => {} }));
  assert.throws(() => hashNormalizedRequest({ n: Symbol("x") }));
  assert.throws(() => hashNormalizedRequest({ n: BigInt(1) }));
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.throws(() => hashNormalizedRequest(cyclic));
  const cyclicArray: unknown[] = [1, 2];
  cyclicArray.push(cyclicArray);
  assert.throws(() => hashNormalizedRequest(cyclicArray));
});

// ─── 10b. canonicalizeJsonValue: own "__proto__" keys, prototype safety,
//          and the nesting-depth cap ─────────────────────────────────────
//
// `JSON.parse` special-cases a `"__proto__"` key in its source text: it
// defines it as a genuine OWN enumerable data property, never routing the
// assignment through `Object.prototype`'s `__proto__` accessor the way a
// plain `obj.__proto__ = x` or `obj["__proto__"] = x` would. `parseOwnProto`
// below reproduces that exact shape without relying on `JSON.parse` itself,
// so these tests exercise the same "own data property named __proto__" input
// a real parsed request/response body can carry.
function parseOwnProto<T>(json: string): T {
  return JSON.parse(json) as T;
}

test("canonicalizeJsonValue preserves an own JSON __proto__ key as an own data property, not a prototype mutation", () => {
  const parsed = parseOwnProto<Record<string, unknown>>('{"a":1,"__proto__":{"evil":true}}');
  assert.ok(Object.prototype.hasOwnProperty.call(parsed, "__proto__"), "the fixture itself must carry an own __proto__ key");

  const canonical = canonicalizeJsonValue(parsed) as Record<string, unknown>;
  assert.ok(Object.prototype.hasOwnProperty.call(canonical, "__proto__"), "canonicalization must not drop an own __proto__ key");
  assert.equal(JSON.stringify(canonical.__proto__), JSON.stringify({ evil: true }));
  assert.equal(Object.getPrototypeOf(canonical), null, "the canonical result itself must be prototype-safe (null-proto)");
  assert.equal(JSON.stringify(canonical), '{"__proto__":{"evil":true},"a":1}');

  // No pollution: some other, brand-new plain object must never observe
  // `.evil` through its own (real) prototype chain.
  assert.equal(({} as Record<string, unknown>).evil, undefined);
});

test("hashNormalizedRequest hashes an own __proto__ key differently from a body without it, and differently across distinct proto subtree values", () => {
  const withProto = parseOwnProto<Record<string, unknown>>('{"a":1,"__proto__":{"evil":true}}');
  const withoutProto = { a: 1 };
  const withDifferentProtoValue = parseOwnProto<Record<string, unknown>>('{"a":1,"__proto__":{"evil":false}}');

  const hashWith = hashNormalizedRequest(withProto);
  const hashWithout = hashNormalizedRequest(withoutProto);
  const hashDifferent = hashNormalizedRequest(withDifferentProtoValue);

  assert.notEqual(hashWith, hashWithout, "an own __proto__ key must not be invisible to the hash");
  assert.notEqual(hashWith, hashDifferent, "distinct __proto__ subtree values must hash differently");
});

test("a completed response with an own __proto__ key replays it verbatim, on disk and in the returned object, without prototype pollution", async () => {
  const { input, claimId } = await claimedInput();
  const bodyWithOwnProto = parseOwnProto<Record<string, unknown>>('{"ok":true,"__proto__":{"evil":true}}');

  const completed = await completeOperation({ key: input.key, claimId }, { status: 200, body: bodyWithOwnProto });
  assert.equal(completed.kind, "completed");
  const completedBody = (completed as { response: { body: Record<string, unknown> } }).response.body;
  assert.ok(Object.prototype.hasOwnProperty.call(completedBody, "__proto__"), "the returned response must carry an own __proto__ key");
  assert.deepEqual(completedBody.__proto__, { evil: true });

  const onDisk = JSON.parse(await readFile(clientOperationStorePath(), "utf8")) as {
    operations: Array<{ key: string; response: { body: Record<string, unknown> } | null }>;
  };
  const persisted = onDisk.operations.find((operation) => operation.key === input.key.toLowerCase());
  assert.ok(persisted?.response, "the completed entry must be persisted");
  assert.ok(
    Object.prototype.hasOwnProperty.call(persisted!.response!.body, "__proto__"),
    "the persisted body must carry an own __proto__ key, not have it dropped",
  );
  assert.deepEqual(persisted!.response!.body.__proto__, { evil: true });

  const replay = await claimOperation(input);
  assert.equal(replay.kind, "replay");
  const replayedBody = (replay as { response: { body: Record<string, unknown> } }).response.body;
  assert.ok(Object.prototype.hasOwnProperty.call(replayedBody, "__proto__"), "a replay must preserve the own __proto__ key too");
  assert.deepEqual(replayedBody.__proto__, { evil: true });

  // No pollution: some other, brand-new plain object must never observe
  // `.evil` through its own (real) prototype chain after all of this.
  assert.equal(({} as Record<string, unknown>).evil, undefined);
});

function nestedArrayOfDepth(depth: number): unknown {
  let value: unknown = null;
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}

function nestedObjectOfDepth(depth: number): unknown {
  let value: unknown = null;
  for (let i = 0; i < depth; i++) value = { nested: value };
  return value;
}

test("canonicalizeJsonValue accepts exactly MAX_JSON_NESTING_DEPTH levels and rejects one level deeper with a typed error, for arrays and objects", () => {
  assert.doesNotThrow(() => canonicalizeJsonValue(nestedArrayOfDepth(MAX_JSON_NESTING_DEPTH)));
  assert.doesNotThrow(() => canonicalizeJsonValue(nestedObjectOfDepth(MAX_JSON_NESTING_DEPTH)));

  assert.throws(() => canonicalizeJsonValue(nestedArrayOfDepth(MAX_JSON_NESTING_DEPTH + 1)), (error: unknown) =>
    isUnhashableRequestValueError(error),
  );
  assert.throws(() => canonicalizeJsonValue(nestedObjectOfDepth(MAX_JSON_NESTING_DEPTH + 1)), (error: unknown) =>
    isUnhashableRequestValueError(error),
  );
});

test("canonicalizeJsonValue throws the typed UnhashableRequestValueError before a stack overflow, never a raw RangeError", () => {
  const veryDeepArray = nestedArrayOfDepth(200_000);
  assert.throws(() => canonicalizeJsonValue(veryDeepArray), (error: unknown) => isUnhashableRequestValueError(error));

  const veryDeepObject = nestedObjectOfDepth(200_000);
  assert.throws(() => canonicalizeJsonValue(veryDeepObject), (error: unknown) => isUnhashableRequestValueError(error));
});

test("canonicalizeJsonValue rejects Date, Map, class instances, accessor properties, and own symbol keys with a typed error rather than invoking getters or collapsing to {}", () => {
  assert.throws(() => canonicalizeJsonValue(new Date()), (error: unknown) => isUnhashableRequestValueError(error));
  assert.throws(() => canonicalizeJsonValue(new Map([["a", 1]])), (error: unknown) => isUnhashableRequestValueError(error));

  class Foo {
    x = 1;
  }
  assert.throws(() => canonicalizeJsonValue(new Foo()), (error: unknown) => isUnhashableRequestValueError(error));

  let getterInvoked = false;
  const withAccessor: Record<string, unknown> = {};
  Object.defineProperty(withAccessor, "x", {
    enumerable: true,
    get() {
      getterInvoked = true;
      return 1;
    },
  });
  assert.throws(() => canonicalizeJsonValue(withAccessor), (error: unknown) => isUnhashableRequestValueError(error));
  assert.equal(getterInvoked, false, "an accessor property must be rejected without ever invoking its getter");

  const withSymbolKey: Record<string, unknown> = { a: 1 };
  (withSymbolKey as Record<symbol, unknown>)[Symbol("s")] = 2;
  assert.throws(() => canonicalizeJsonValue(withSymbolKey), (error: unknown) => isUnhashableRequestValueError(error));
});

test("canonicalizeJsonValue still accepts plain object literals, null-prototype records, arrays, and JSON.parse output", () => {
  // `canonicalizeJsonValue`'s own output is intentionally null-prototype
  // (see its doc comment), so these compare serialized form rather than
  // `assert.deepEqual`, which treats a null-prototype object and an
  // `Object.prototype` object with identical own properties as unequal.
  assert.equal(JSON.stringify(canonicalizeJsonValue({ a: 1, b: [1, 2, 3] })), JSON.stringify({ a: 1, b: [1, 2, 3] }));

  const nullProto = Object.create(null) as Record<string, unknown>;
  nullProto.a = 1;
  assert.equal(JSON.stringify(canonicalizeJsonValue(nullProto)), JSON.stringify({ a: 1 }));

  assert.equal(JSON.stringify(canonicalizeJsonValue([1, "two", null, { three: 3 }])), JSON.stringify([1, "two", null, { three: 3 }]));
  assert.equal(JSON.stringify(canonicalizeJsonValue(JSON.parse('{"a":1,"b":[1,2,3]}'))), JSON.stringify({ a: 1, b: [1, 2, 3] }));
});

// ─── 11. claim/complete input validation is bounded and strict ────────────

test("claimOperation rejects a non-UUID key, credentialId, malformed route, or non-hash requestHash", async () => {
  const base = claimInput();
  await assert.rejects(() => claimOperation({ ...base, key: "not-a-uuid" }));
  await assert.rejects(() => claimOperation({ ...base, credentialId: "not-a-uuid" }));
  await assert.rejects(() => claimOperation({ ...base, route: "Has Spaces" }));
  await assert.rejects(() => claimOperation({ ...base, route: "a".repeat(129) }));
  await assert.rejects(() => claimOperation({ ...base, requestHash: "not-hex" }));
  await assert.rejects(() => claimOperation({ ...base, requestHash: "a".repeat(63) }));
});

test("completeOperation rejects an out-of-range status, an unhashable body, or an oversized body", async () => {
  const { input, claimId } = await claimedInput();
  await assert.rejects(() => completeOperation({ key: input.key, claimId }, { status: 99, body: {} }));
  await assert.rejects(() => completeOperation({ key: input.key, claimId }, { status: 600, body: {} }));
  await assert.rejects(() => completeOperation({ key: input.key, claimId }, { status: 200, body: { n: Number.NaN } }));

  const oversizedBody = { blob: "x".repeat(70 * 1024) };
  await assert.rejects(() => completeOperation({ key: input.key, claimId }, { status: 200, body: oversizedBody }));
});

test("claim and complete input validation happens before any transaction/write is attempted", async () => {
  const before = await readFile(clientOperationStorePath(), "utf8").catch(() => null);
  await assert.rejects(() => claimOperation({ key: "nope", credentialId: fixtureUuid(), route: "conversations", requestHash: "a".repeat(64) }));
  const after = await readFile(clientOperationStorePath(), "utf8").catch(() => null);
  assert.equal(after, before, "invalid input must never reach a write");
});
