// Behavioral tests for `exchangePairingRequest` (pairing-exchange.ts) — the
// transactional claim -> issueCredential -> finalize/rollback lifecycle the
// exchange route now delegates to. These exercise the DI seam directly
// (fake `issueCredential`, spies on `finalize`/`rollback`) rather than
// mocking `node:fs`/timers or monkeypatching `credential-store.ts`, matching
// this repo's established pattern for injectable business logic (see
// `@/lib/server/voice-chat-create.ts` and
// `@/lib/server/client-v1/read-model.ts`'s
// `ClientSlashCommandCapabilityDependencies`).
//
// The real `pairing-store.ts` claim/finalize/rollback functions are used
// throughout (never re-mocked) so these tests prove the actual exclusivity
// invariant those functions provide, not a paraphrase of it — only
// `issueCredential` itself is faked, since that's the one dependency this
// module needs to inject to simulate a store failure without touching real
// disk I/O.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";

import {
  claimApprovedPairingWithIdempotency,
  createPairingRequest,
  decidePairingRequest,
  finalizeApprovedPairingClaim,
  isPairingRequestExpired,
  readPairingRequest,
  resetPairingRequestsForTest,
  rollbackApprovedPairingClaim,
} from "./pairing-store.ts";
import type { ApprovedPairing } from "./pairing-store.ts";
import { exchangePairingRequest, type PairingExchangeDeps } from "./pairing-exchange.ts";
import type { SafeClientCredential } from "./credential-store.ts";
import { hashNormalizedRequest } from "./idempotency-store.ts";

afterEach(() => {
  resetPairingRequestsForTest();
});

function input(overrides: Record<string, unknown> = {}) {
  return {
    appName: "OpenCoven Chat",
    installationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    scopes: ["chat:read" as const, "chat:write" as const],
    ...overrides,
  };
}

let credentialCounter = 0;
function fakeCredential(approved: ApprovedPairing): { token: string; credential: SafeClientCredential } {
  credentialCounter += 1;
  return {
    token: `fake-token-${credentialCounter}`,
    credential: {
      id: `fake-credential-${credentialCounter}`,
      appName: approved.appName,
      installationId: approved.installationId,
      scopes: [...approved.scopes],
      createdAt: Date.now(),
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

/** Real claim/finalize/rollback/readPairing, with an overridable `issueCredential`. */
function depsWithIssue(issueCredential: PairingExchangeDeps["issueCredential"]): PairingExchangeDeps {
  return {
    claim: claimApprovedPairingWithIdempotency,
    finalize: finalizeApprovedPairingClaim,
    rollback: rollbackApprovedPairingClaim,
    readPairing: readPairingRequest,
    issueCredential,
  };
}

function exchangeKey(seed = crypto.randomUUID()): string {
  return seed;
}

function exchangeRequestHash(id: string): string {
  return hashNormalizedRequest({ method: "POST", pairingId: id });
}

test("an injected credential issuance failure preserves the approved request, and a retry can then succeed", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");

  let calls = 0;
  const failingThenSucceeding: PairingExchangeDeps["issueCredential"] = async (approved, _now) => {
    calls += 1;
    if (calls === 1) throw new Error("simulated credential store write failure");
    return fakeCredential(approved as ApprovedPairing);
  };

  const idempotencyKey = exchangeKey("9f4145de-9b43-4abc-876d-81ef63de60e0");
  const first = await exchangePairingRequest(
    request.id,
    secret,
    idempotencyKey,
    exchangeRequestHash(request.id),
    1_000,
    depsWithIssue(failingThenSucceeding),
  );
  assert.deepEqual(first, { kind: "issue_failed" });

  // The approval itself must have survived the failure: still readable and
  // reported as approved, never tombstoned/expired.
  const stillApproved = readPairingRequest(request.id, secret, 1_100);
  assert.equal(stillApproved?.status, "approved");
  assert.equal(isPairingRequestExpired(request.id, secret, 1_100), false);

  const retry = await exchangePairingRequest(
    request.id,
    secret,
    idempotencyKey,
    exchangeRequestHash(request.id),
    1_200,
    depsWithIssue(failingThenSucceeding),
  );
  assert.equal(retry.kind, "ok");
  if (retry.kind === "ok") {
    assert.equal(typeof retry.token, "string");
    assert.ok(retry.token.length > 0);
  }
  assert.equal(calls, 2, "issueCredential must have been attempted exactly twice — once failing, once succeeding");

  // Now genuinely finalized — a further exchange attempt is the generic
  // "expired" outcome, never a resurrection of the same approval.
  const replay = await exchangePairingRequest(
    request.id,
    secret,
    idempotencyKey,
    exchangeRequestHash(request.id),
    1_300,
    depsWithIssue(failingThenSucceeding),
  );
  assert.equal(replay.kind, "already_exchanged");
  if (replay.kind === "already_exchanged") {
    assert.equal(replay.credential.appName, "OpenCoven Chat");
  }
});

test("no finalize ever runs before issueCredential has actually resolved successfully", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");

  let finalizeCalls = 0;
  const spyingFinalize: PairingExchangeDeps["finalize"] = (id, claimId, now) => {
    finalizeCalls += 1;
    return finalizeApprovedPairingClaim(id, claimId, now);
  };

  let releaseIssue!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseIssue = resolve;
  });
  const deferredIssue: PairingExchangeDeps["issueCredential"] = async (approved) => {
    await gate;
    return fakeCredential(approved as ApprovedPairing);
  };

  const exchangePromise = exchangePairingRequest(
    request.id,
    secret,
    exchangeKey("0f4145de-9b43-4abc-876d-81ef63de60e0"),
    exchangeRequestHash(request.id),
    1_000,
    {
      claim: claimApprovedPairingWithIdempotency,
      finalize: spyingFinalize,
      rollback: rollbackApprovedPairingClaim,
      readPairing: readPairingRequest,
      issueCredential: deferredIssue,
    },
  );

  // Let the microtask queue drain a few turns while issueCredential is still
  // pending on `gate` — finalize must not have run yet.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.equal(finalizeCalls, 0, "finalize must never run while issueCredential is still in flight");
  // The record must still be claimed (not yet finalized/deleted).
  assert.equal(readPairingRequest(request.id, secret, 1_050)?.status, "approved");

  releaseIssue();
  const result = await exchangePromise;
  assert.equal(result.kind, "ok");
  assert.equal(finalizeCalls, 1, "finalize must run exactly once, only after issueCredential resolved");
});

test("two concurrent exact retries against the same approved request yield one token and one in-flight pending result", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");
  const idempotencyKey = exchangeKey("1f4145de-9b43-4abc-876d-81ef63de60e0");

  let issueCalls = 0;
  const issue: PairingExchangeDeps["issueCredential"] = async (approved) => {
    issueCalls += 1;
    // A microtask hop so both racing calls are genuinely in flight together
    // rather than trivially resolving synchronously.
    await Promise.resolve();
    return fakeCredential(approved as ApprovedPairing);
  };
  const deps = depsWithIssue(issue);

  const [first, second] = await Promise.all([
    exchangePairingRequest(request.id, secret, idempotencyKey, exchangeRequestHash(request.id), 1_000, deps),
    exchangePairingRequest(request.id, secret, idempotencyKey, exchangeRequestHash(request.id), 1_000, deps),
  ]);

  const outcomes = [first.kind, second.kind].sort();
  assert.deepEqual(outcomes, ["ok", "processing"], "exactly one of the two concurrent attempts must claim and issue");
  assert.equal(issueCalls, 1, "issueCredential must be invoked exactly once across both concurrent attempts");

  const okResult = first.kind === "ok" ? first : second;
  assert.equal(okResult.kind, "ok");
  if (okResult.kind === "ok") assert.ok(okResult.token.length > 0);

  const processing = first.kind === "processing" ? first : second;
  assert.equal(processing.kind, "processing");
  if (processing.kind === "processing") {
    assert.equal(processing.retryAfterMs, 1_000);
  }
});

test("a rollback that lands after the claim's original TTL has passed finishes the request; the caller sees a generic expired result on retry, never a resurrection", async () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);

  const alwaysFails: PairingExchangeDeps["issueCredential"] = async () => {
    throw new Error("simulated credential store write failure");
  };

  // `exchangePairingRequest` always rolls back with a fresh `Date.now()`
  // snapshot (never the stale synthetic `now` used for claim/issue), so this
  // deps override pins the ROLLBACK's own effective time to well past the
  // claim's original TTL — proving the "expired while claimed" branch of
  // `rollbackApprovedPairingClaim` (finish it off, never leave it claimable)
  // without depending on real wall-clock drift inside a synchronous test.
  const pastTtl = request.expiresAt + 1;
  const deps: PairingExchangeDeps = {
    claim: claimApprovedPairingWithIdempotency,
    finalize: finalizeApprovedPairingClaim,
    rollback: (id, claimId) => rollbackApprovedPairingClaim(id, claimId, pastTtl),
    readPairing: readPairingRequest,
    issueCredential: alwaysFails,
  };

  const idempotencyKey = exchangeKey("2f4145de-9b43-4abc-876d-81ef63de60e0");
  const result = await exchangePairingRequest(
    request.id,
    secret,
    idempotencyKey,
    exchangeRequestHash(request.id),
    1_200,
    deps,
  );
  assert.deepEqual(result, { kind: "issue_failed" });

  assert.equal(readPairingRequest(request.id, secret, pastTtl + 10), null);
  assert.equal(isPairingRequestExpired(request.id, secret, pastTtl + 10), true);

  const retry = await exchangePairingRequest(
    request.id,
    secret,
    idempotencyKey,
    exchangeRequestHash(request.id),
    pastTtl + 20,
    depsWithIssue(async (approved) => fakeCredential(approved as ApprovedPairing)),
  );
  assert.deepEqual(retry, { kind: "expired" });
});

test("a wrong secret, a still-pending request, and a denied request are classified distinctly and never claim", async () => {
  const deps = depsWithIssue(async (approved) => fakeCredential(approved as ApprovedPairing));

  const pendingReq = createPairingRequest(input({ installationId: "1a1a1a1a-2222-4333-8444-000000000001" }));
  const pending = await exchangePairingRequest(
    pendingReq.request.id,
    pendingReq.secret,
    exchangeKey("3f4145de-9b43-4abc-876d-81ef63de60e0"),
    exchangeRequestHash(pendingReq.request.id),
    1_000,
    deps,
  );
  assert.deepEqual(pending, { kind: "pending" });

  const deniedReq = createPairingRequest(input({ installationId: "1a1a1a1a-2222-4333-8444-000000000002" }));
  decidePairingRequest(deniedReq.request.id, "denied");
  const denied = await exchangePairingRequest(
    deniedReq.request.id,
    deniedReq.secret,
    exchangeKey("4f4145de-9b43-4abc-876d-81ef63de60e0"),
    exchangeRequestHash(deniedReq.request.id),
    1_000,
    deps,
  );
  assert.deepEqual(denied, { kind: "denied" });

  const approvedReq = createPairingRequest(input({ installationId: "1a1a1a1a-2222-4333-8444-000000000003" }));
  decidePairingRequest(approvedReq.request.id, "approved");
  const wrongSecret = await exchangePairingRequest(
    approvedReq.request.id,
    "wrong-secret",
    exchangeKey("5f4145de-9b43-4abc-876d-81ef63de60e0"),
    exchangeRequestHash(approvedReq.request.id),
    1_000,
    deps,
  );
  assert.deepEqual(wrongSecret, { kind: "expired" });

  // The wrong secret must not have consumed anything — the real secret still works.
  const real = await exchangePairingRequest(
    approvedReq.request.id,
    approvedReq.secret,
    exchangeKey("6f4145de-9b43-4abc-876d-81ef63de60e0"),
    exchangeRequestHash(approvedReq.request.id),
    1_100,
    deps,
  );
  assert.equal(real.kind, "ok");
});

console.log("pairing-exchange.test.ts: ok");
