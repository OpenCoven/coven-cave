// Behavioral tests for `runIdempotentMutation` (idempotent-mutation.ts) — the
// shared claim -> execute -> complete wrapper every client-v1 mutating route
// (POST/PATCH/DELETE conversations, Task 7) uses over Task 6's persistent
// ledger (idempotency-store.ts). This suite exercises the wrapper directly
// with a controllable `execute` callback so the pending/conflict/
// integrity-error/no-false-success paths are deterministic — the higher-level
// route tests (conversations/route.test.ts, conversations/[id]/route.test.ts)
// cover the same replay/conflict contract through real domain calls, but
// timing-sensitive paths (a live concurrent claim, a corrupted ledger read)
// are far more reliable to prove here, against a fake `execute`, than by
// racing real file/daemon I/O.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { after, beforeEach, test } from "node:test";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-idempotent-mutation-"));
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "client-v1-operations.json");
process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH = path.join(workdir, "github-effects.json");

const { runIdempotentMutation, deriveIdempotentEffectId } = await import("./idempotent-mutation.ts");
const {
  claimOperation,
  clientOperationStorePath,
  completeOperation,
  hashNormalizedRequest,
  isIdempotencyStoreIntegrityError,
  PENDING_CLAIM_RETRY_MS,
  setPostReadDelayForTest,
  setReadFileForTest,
} = await import("./idempotency-store.ts");
const {
  beginGitHubEffect,
  settleGitHubEffectSuccess,
} = await import("./github-effect-store.ts");
const { clientV1Ok, clientV1Error } = await import("./responses.ts");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(clientOperationStorePath(), { force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH}.lock.sqlite3-wal`, { force: true });
  setPostReadDelayForTest(null);
  setReadFileForTest(null);
});

function baseRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    idempotencyKey: crypto.randomUUID(),
    credentialId: crypto.randomUUID(),
    route: "conversations-patch",
    identity: { method: "PATCH", conversationId: "conv-1", input: { pinned: true } },
    ...overrides,
  };
}

test("a brand-new key runs execute exactly once and returns its response", async () => {
  let calls = 0;
  const response = await runIdempotentMutation(baseRequest(), async () => {
    calls += 1;
    return clientV1Ok({ ok: true, conversation: { revision: "rev-1" } });
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, conversation: { revision: "rev-1" } });
});

test("replaying the exact same identity returns the persisted response without re-running execute", async () => {
  const request = baseRequest();
  let calls = 0;
  const execute = async () => {
    calls += 1;
    return clientV1Ok({ ok: true, conversation: { revision: "rev-2" } });
  };

  const first = await runIdempotentMutation(request, execute);
  const second = await runIdempotentMutation(request, execute);

  assert.equal(calls, 1, "execute must never run twice for the same key/identity");
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(second.headers.get("ETag"), "rev-2");
});

test("a cached non-retryable capacity failure remains a 409 after capacity frees without reconciling unreported state", async () => {
  let capacityFull = true;
  let executeCalls = 0;
  let reconciliationCalls = 0;
  let createdEffects = 0;
  const request = {
    ...baseRequest({ route: "attachments-upload" }),
    reconcileReplay: async () => {
      reconciliationCalls += 1;
      createdEffects += 1;
    },
  };
  const execute = async () => {
    executeCalls += 1;
    if (capacityFull) {
      return clientV1Error(409, "conflict", "Attachment capacity is full.", false);
    }
    createdEffects += 1;
    return clientV1Ok({ ok: true, attachments: [{ id: "would-be-created" }] }, { status: 201 });
  };

  const first = await runIdempotentMutation(request, execute);
  assert.equal(first.status, 409);
  capacityFull = false;

  const replay = await runIdempotentMutation(request, execute);
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, "conflict");
  assert.equal(executeCalls, 1, "a cached failure must not execute again");
  assert.equal(reconciliationCalls, 0, "a cached failure must not reconcile external state");
  assert.equal(createdEffects, 0, "a cached failure must not create an unreported effect");
});

test("a cached successful response still reconciles durable state before replay", async () => {
  let executeCalls = 0;
  let reconciliationCalls = 0;
  let attachmentExists = false;
  const request = {
    ...baseRequest({ route: "attachments-upload" }),
    reconcileReplay: async () => {
      reconciliationCalls += 1;
      attachmentExists = true;
    },
  };
  const execute = async () => {
    executeCalls += 1;
    attachmentExists = true;
    return clientV1Ok({ ok: true, attachments: [{ id: "repaired-on-replay" }] }, { status: 201 });
  };

  assert.equal((await runIdempotentMutation(request, execute)).status, 201);
  attachmentExists = false;
  const replay = await runIdempotentMutation(request, execute);

  assert.equal(replay.status, 201);
  assert.equal(executeCalls, 1);
  assert.equal(reconciliationCalls, 1);
  assert.equal(attachmentExists, true, "successful replay repairs its durable attachment state");
});

test("the same key with a different identity conflicts with 409 and never runs execute", async () => {
  const key = crypto.randomUUID();
  const credentialId = crypto.randomUUID();
  let calls = 0;
  const execute = async () => {
    calls += 1;
    return clientV1Ok({ ok: true });
  };

  const first = await runIdempotentMutation(
    baseRequest({ idempotencyKey: key, credentialId, identity: { method: "PATCH", conversationId: "conv-a" } }),
    execute,
  );
  assert.equal(first.status, 200);

  const second = await runIdempotentMutation(
    baseRequest({ idempotencyKey: key, credentialId, identity: { method: "PATCH", conversationId: "conv-b" } }),
    execute,
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "conflict");
  assert.equal(calls, 1, "a conflicting key must never run execute a second time");
});

test("a live pending claim for the same identity reports a retryable 409 and never runs execute twice", async () => {
  const request = baseRequest();
  let executeCalls = 0;
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const firstPromise = runIdempotentMutation(request, async () => {
    executeCalls += 1;
    await gate;
    return clientV1Ok({ ok: true, conversation: { revision: "rev-3" } });
  });

  // The first call's OWN claimOperation (a single small ledger read/write) is
  // fast and runs before its `execute` (gated open above), so this window is
  // generous enough for the ledger to durably record the pending claim
  // before the second call's claimOperation runs.
  await new Promise((resolve) => setTimeout(resolve, 25));

  const secondResponse = await runIdempotentMutation(request, async () => {
    executeCalls += 1;
    return clientV1Ok({ ok: true });
  });

  assert.equal(secondResponse.status, 409);
  const secondBody = await secondResponse.json();
  assert.equal(secondBody.error.code, "conflict");
  assert.equal(secondBody.error.retryable, true);
  assert.ok(secondResponse.headers.get("Retry-After"), "a pending claim reports a Retry-After hint");
  assert.equal(executeCalls, 1, "the second call must never run execute while the first is still pending");

  releaseFirst();
  const firstResponse = await firstPromise;
  assert.equal(firstResponse.status, 200);
});

test("a corrupted ledger read (IdempotencyStoreIntegrityError) reports a stable retryable 503 without leaking any on-disk detail", async () => {
  setReadFileForTest(async () => {
    throw new Error("EIO: read failed at /definitely/secret/path/client-v1-operations.json");
  });
  const response = await runIdempotentMutation(baseRequest(), async () => clientV1Ok({ ok: true }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "service_unavailable");
  assert.equal(body.error.retryable, true);
  const raw = JSON.stringify(body);
  assert.equal(
    /EIO|secret|client-v1-operations\.json/i.test(raw),
    false,
    "the raw storage error must never reach the wire",
  );
});

// Deps for the claim-failure tests below: a FAKE `claimOperation` that throws
// a specific error shape, paired with the REAL hash/integrity-check/complete
// bindings — the only seam these tests need to deterministically force each
// distinct claimOperation failure mode (generic secret-bearing error,
// lock-timeout-shaped error) without racing the real on-disk store or a real
// SQLite lock contention window.
function depsWithFakeClaim(claimOperationImpl: (...args: unknown[]) => Promise<unknown>) {
  return {
    claimOperation: claimOperationImpl as never,
    completeOperation,
    hashNormalizedRequest,
    isIdempotencyStoreIntegrityError,
  };
}

test("claimOperation throwing a generic secret-bearing error reports a stable retryable 503 with no leak", async () => {
  const response = await runIdempotentMutation(
    baseRequest(),
    async () => clientV1Ok({ ok: true }),
    depsWithFakeClaim(async () => {
      throw new Error("db credential=hunter2 at /very/secret/internal/path.db");
    }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "service_unavailable");
  assert.equal(body.error.retryable, true);
  const raw = JSON.stringify(body);
  assert.equal(
    /hunter2|secret|internal\/path/i.test(raw),
    false,
    "a raw generic claimOperation error must never leak to the wire",
  );
});

test("claimOperation throwing a lock-timeout-shaped error reports the same stable retryable 503 with no leak", async () => {
  const response = await runIdempotentMutation(
    baseRequest(),
    async () => clientV1Ok({ ok: true }),
    depsWithFakeClaim(async () => {
      throw new Error(
        "operation lock: /home/user/.coven-cave/client-v1-operations.lock timed out waiting for contention to clear",
      );
    }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "service_unavailable");
  assert.equal(body.error.retryable, true);
  const raw = JSON.stringify(body);
  assert.equal(
    /\.lock|home\/user|timed out waiting for contention/i.test(raw),
    false,
    "a raw lock-timeout error must never leak its path/message to the wire",
  );
});

test("a >= 500 execute response is never persisted — a retry sees a live pending claim, not a cached failure", async () => {
  const request = baseRequest();
  let calls = 0;

  const failing = await runIdempotentMutation(request, async () => {
    calls += 1;
    return clientV1Error(500, "internal_error", "boom", true);
  });
  assert.equal(failing.status, 500);
  assert.equal(calls, 1);

  // Nothing was completed for this key: an immediate retry with the SAME
  // identity must never replay a false "success" (or even replay the 500
  // itself) — it must see the claim is still live/pending from the first
  // call, since that call never reached `completeOperation`.
  const retry = await runIdempotentMutation(request, async () => {
    calls += 1;
    return clientV1Ok({ ok: true });
  });
  assert.equal(retry.status, 409, "a >=500 outcome must never be cached as a replayable result");
  assert.equal((await retry.json()).error.code, "conflict");
  assert.equal(calls, 1, "execute must not run again while the failed attempt's claim is still live");
});

test("a retryable 409 execute response stays pending instead of becoming a permanently replayed result", async () => {
  let reconciliationCalls = 0;
  const request = {
    ...baseRequest(),
    reconcileReplay: async () => {
      reconciliationCalls += 1;
    },
  };
  let calls = 0;
  const launching = await runIdempotentMutation(request, async () => {
    calls += 1;
    return clientV1Error(409, "operation_already_started", "Still launching.", true);
  });
  assert.equal(launching.status, 409);
  assert.equal((await launching.json()).error.retryable, true);

  const retry = await runIdempotentMutation(request, async () => {
    calls += 1;
    return clientV1Ok({ ok: true });
  });
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).error.code, "conflict");
  assert.equal(calls, 1, "the retryable result must leave its claim in progress, never replay it");
  assert.equal(reconciliationCalls, 0, "a retryable failure is never cached or reconciled");
});

test("execute throwing an unexpected error returns a safe 500 and is never persisted", async () => {
  const request = baseRequest();
  const response = await runIdempotentMutation(request, async () => {
    throw new Error("unexpected domain crash with sensitive/path/data");
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "internal_error");
  const raw = JSON.stringify(body);
  assert.equal(/sensitive|crash/i.test(raw), false, "a thrown domain error must never leak to the wire");
});

// Deps for the completion-verification tests below: the REAL claim/hash/
// integrity-check bindings (so claiming still behaves exactly like
// production), paired with a FAKE `completeOperation` — the only seam these
// tests need to deterministically force a completion failure/non-durable
// result without racing the real on-disk store.
function depsWithFakeCompletion(completeOperation: (...args: unknown[]) => Promise<unknown>) {
  return {
    claimOperation,
    completeOperation: completeOperation as never,
    hashNormalizedRequest,
    isIdempotencyStoreIntegrityError,
  };
}

test("completeOperation throwing a secret-bearing error returns a stable 503 with no leak, never the real success body", async () => {
  const request = baseRequest();
  const response = await runIdempotentMutation(
    request,
    async () => clientV1Ok({ ok: true, conversation: { revision: "rev-secret" } }),
    depsWithFakeCompletion(async () => {
      throw new Error("secret-token=abc123 at /very/secret/internal/path.json");
    }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "service_unavailable");
  const raw = JSON.stringify(body);
  assert.equal(/secret|abc123|internal\/path/i.test(raw), false, "no raw completion error may leak to the wire");
  assert.equal(
    /rev-secret/.test(raw),
    false,
    "the real (unconfirmed) success body must never be returned when completion throws",
  );
});

test("completeOperation returning a non-durable kind (conflict/not_found) never returns the real success body", async () => {
  for (const kind of ["conflict", "not_found"] as const) {
    const request = baseRequest({ idempotencyKey: crypto.randomUUID() });
    const response = await runIdempotentMutation(
      request,
      async () => clientV1Ok({ ok: true, conversation: { revision: `rev-${kind}` } }),
      depsWithFakeCompletion(async () => ({ kind })),
    );
    assert.equal(response.status, 503, `completion kind ${kind} must not be treated as success`);
    const body = await response.json();
    assert.equal(body.error.code, "service_unavailable");
    assert.equal(
      JSON.stringify(body).includes(`rev-${kind}`),
      false,
      "a non-durable completion must never surface the mutation's real response body",
    );
  }
});

test("a completed/replay completion result returns the real response verbatim", async () => {
  for (const kind of ["completed", "replay"] as const) {
    const request = baseRequest({ idempotencyKey: crypto.randomUUID() });
    const response = await runIdempotentMutation(
      request,
      async () => clientV1Ok({ ok: true, conversation: { revision: `rev-${kind}-ok` } }),
      depsWithFakeCompletion(async (_input: unknown, saved: unknown) => ({ kind, response: saved })),
    );
    assert.equal(response.status, 200, `completion kind ${kind} must return the real success response`);
    const body = await response.json();
    assert.equal(body.conversation.revision, `rev-${kind}-ok`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// deriveIdempotentEffectId / execute context (Task 7 quality finding #1:
// recoverable deterministic create)
// ─────────────────────────────────────────────────────────────────────────

test("deriveIdempotentEffectId is deterministic: the exact same composite identity always derives the exact same id", () => {
  const identity = {
    credentialId: crypto.randomUUID(),
    route: "conversations-create",
    idempotencyKey: crypto.randomUUID(),
    requestHash: crypto.createHash("sha256").update("same-body").digest("hex"),
  };
  const first = deriveIdempotentEffectId(identity);
  const second = deriveIdempotentEffectId({ ...identity });
  assert.equal(first, second);
  // Formatted as a UUID (8-4-4-4-12 hex groups), so downstream consumers
  // that expect a UUID-shaped id never need special-casing.
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("deriveIdempotentEffectId changes when any single field of the composite identity changes", () => {
  const base = {
    credentialId: crypto.randomUUID(),
    route: "conversations-create",
    idempotencyKey: crypto.randomUUID(),
    requestHash: crypto.createHash("sha256").update("body").digest("hex"),
  };
  const baseline = deriveIdempotentEffectId(base);
  assert.notEqual(deriveIdempotentEffectId({ ...base, credentialId: crypto.randomUUID() }), baseline);
  assert.notEqual(deriveIdempotentEffectId({ ...base, route: "conversations-patch" }), baseline);
  assert.notEqual(deriveIdempotentEffectId({ ...base, idempotencyKey: crypto.randomUUID() }), baseline);
  assert.notEqual(
    deriveIdempotentEffectId({ ...base, requestHash: crypto.createHash("sha256").update("other-body").digest("hex") }),
    baseline,
  );
});

test("deriveIdempotentEffectId is case-insensitive on credentialId/idempotencyKey/requestHash (matches how UUIDs/hex are normally compared)", () => {
  const identity = {
    credentialId: crypto.randomUUID(),
    route: "conversations-create",
    idempotencyKey: crypto.randomUUID(),
    requestHash: crypto.createHash("sha256").update("body").digest("hex"),
  };
  const lower = deriveIdempotentEffectId(identity);
  const upper = deriveIdempotentEffectId({
    ...identity,
    credentialId: identity.credentialId.toUpperCase(),
    idempotencyKey: identity.idempotencyKey.toUpperCase(),
    requestHash: identity.requestHash.toUpperCase(),
  });
  assert.equal(lower, upper);
});

test("execute receives a stable effectId across a claim -> reclaim (never derived from the ephemeral claimId)", async () => {
  const request = baseRequest();
  const seenEffectIds: string[] = [];
  const seenRequestHashes: string[] = [];

  // First attempt: execute observes ctx.effectId/ctx.requestHash, but its
  // completion is never confirmed (simulated by a completeOperation that
  // throws) — the claim must stay pending/reclaimable (until it expires).
  const first = await runIdempotentMutation(
    request,
    async (ctx) => {
      seenEffectIds.push(ctx.effectId);
      seenRequestHashes.push(ctx.requestHash);
      return clientV1Ok({ ok: true, conversation: { revision: "rev-1" } });
    },
    depsWithFakeCompletion(async () => {
      throw new Error("simulated completion failure");
    }),
  );
  assert.equal(first.status, 503);

  // An IMMEDIATE retry under the same identity must still see a live pending
  // claim (proven by the existing "live pending claim" test above) — so to
  // exercise the actual reclaim path, simulate the wall clock advancing past
  // `PENDING_CLAIM_RETRY_MS`, the same way a real caller's retry sometime
  // after the claim's abandonment window would. `claimOperation` itself
  // takes an optional `now`; only that one argument is faked here, so
  // claiming still runs against the exact same real on-disk ledger.
  const reclaimDeps = {
    claimOperation: (input: Parameters<typeof claimOperation>[0]) =>
      claimOperation(input, Date.now() + PENDING_CLAIM_RETRY_MS + 1_000),
    completeOperation,
    hashNormalizedRequest,
    isIdempotencyStoreIntegrityError,
  };
  const second = await runIdempotentMutation(
    request,
    async (ctx) => {
      seenEffectIds.push(ctx.effectId);
      seenRequestHashes.push(ctx.requestHash);
      return clientV1Ok({ ok: true, conversation: { revision: "rev-1" } });
    },
    reclaimDeps,
  );
  assert.equal(second.status, 200, "an expired claim under the SAME key must reclaim and run execute again");

  assert.equal(seenEffectIds.length, 2);
  assert.equal(seenEffectIds[0], seenEffectIds[1], "effectId must be identical across a same-key reclaim");
  assert.equal(seenRequestHashes[0], seenRequestHashes[1]);
  assert.equal(
    seenEffectIds[0],
    deriveIdempotentEffectId({
      credentialId: request.credentialId,
      route: request.route,
      idempotencyKey: request.idempotencyKey,
      requestHash: seenRequestHashes[0],
    }),
  );
});

test("a completion crash retries the durable GitHub receipt without a second external dispatch", async () => {
  const request = baseRequest({
    route: "github-actions",
    identity: {
      method: "POST",
      conversationId: "conv-1",
      turnId: "assistant-1",
      action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
    },
  });
  const source = { conversationId: "conv-1", turnId: "assistant-1" };
  const body = "Ship it";
  const bodySha256 = crypto.createHash("sha256").update(body).digest("hex");
  const action = {
    kind: "comment" as const,
    repo: "OpenCoven/coven-cave",
    number: 7,
    bodyPreview: body,
    bodyBytes: Buffer.byteLength(body, "utf8"),
    bodySha256,
    bodyTruncated: false,
  };
  const receipt = {
    source,
    action: {
      kind: "comment" as const,
      repo: "OpenCoven/coven-cave",
      number: 7,
      body,
      bodyBytes: Buffer.byteLength(body, "utf8"),
      bodySha256,
    },
    result: {
      kind: "comment" as const,
      commentId: "91",
      body,
      bodyBytes: Buffer.byteLength(body, "utf8"),
      bodySha256,
      createdAt: "2026-08-10T10:02:00.000Z",
      url: "https://github.com/OpenCoven/coven-cave/issues/7#issuecomment-91",
    },
  };
  let githubDispatches = 0;
  const execute = async (ctx: { effectId: string }) => {
    const reservation = await beginGitHubEffect({ effectId: ctx.effectId, source, action });
    if (reservation.kind === "replay") {
      return clientV1Ok({ ok: true, action: reservation.receipt });
    }
    assert.equal(reservation.kind, "dispatch", "the initial action must reserve before dispatching");
    githubDispatches += 1;
    assert.equal(
      await settleGitHubEffectSuccess({
        effectId: ctx.effectId,
        receipt,
        expected: { state: "pending", claim: reservation.claim },
      }),
      true,
    );
    return clientV1Ok({ ok: true, action: receipt });
  };

  const first = await runIdempotentMutation(
    request,
    execute,
    depsWithFakeCompletion(async () => {
      throw new Error("simulated outer completion crash");
    }),
  );
  assert.equal(first.status, 503);
  assert.equal(githubDispatches, 1);

  const reclaimDeps = {
    claimOperation: (input: Parameters<typeof claimOperation>[0]) =>
      claimOperation(input, Date.now() + PENDING_CLAIM_RETRY_MS + 1_000),
    completeOperation,
    hashNormalizedRequest,
    isIdempotencyStoreIntegrityError,
  };
  const retry = await runIdempotentMutation(request, execute, reclaimDeps);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { ok: true, action: receipt });
  assert.equal(
    githubDispatches,
    1,
    "the same-key retry must replay its protected receipt instead of calling GitHub again",
  );
});

test("execute receives DIFFERENT effectIds for two distinct Idempotency-Keys (an intentional new mutation is never conflated with a retry)", async () => {
  const credentialId = crypto.randomUUID();
  const seen: string[] = [];
  await runIdempotentMutation(
    baseRequest({ credentialId, idempotencyKey: crypto.randomUUID() }),
    async (ctx) => {
      seen.push(ctx.effectId);
      return clientV1Ok({ ok: true });
    },
  );
  await runIdempotentMutation(
    baseRequest({ credentialId, idempotencyKey: crypto.randomUUID() }),
    async (ctx) => {
      seen.push(ctx.effectId);
      return clientV1Ok({ ok: true });
    },
  );
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1], "a NEW Idempotency-Key must mint a distinct, independent effectId");
});

test("the completion-unconfirmed response tells the caller to retry with the SAME Idempotency-Key, never a new one", async () => {
  const request = baseRequest();
  const response = await runIdempotentMutation(
    request,
    async () => clientV1Ok({ ok: true, conversation: { revision: "rev-unconfirmed" } }),
    depsWithFakeCompletion(async () => {
      throw new Error("simulated");
    }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  // `clientV1Error` substitutes a fixed generic message for every >= 500
  // response (see responses.ts) — the retry guidance is instead conveyed via
  // the machine-readable `details.retryGuidance`, checked here.
  assert.equal(body.error.details?.reason, "completion_unconfirmed");
  assert.equal(body.error.details?.retryGuidance, "same-key");
});

console.log("client-v1/idempotent-mutation.test.ts: ok");
