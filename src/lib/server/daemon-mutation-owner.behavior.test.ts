// @ts-nocheck
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  daemonMutationOwnerSnapshot,
  resetDaemonMutationOwnerForTests,
  runDaemonMutation,
} from "./daemon-mutation-owner.ts";

beforeEach(() => resetDaemonMutationOwnerForTests());
afterEach(() => resetDaemonMutationOwnerForTests());

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function mutation(kind, overrides = {}) {
  return {
    kind,
    run: async () => ({ ok: true, code: "ok" }),
    outcome: (result) => (result.ok ? "ok" : result.code),
    probeReady: async () => false,
    reconciled: () => ({ ok: true, code: "reconciled" }),
    refused: (refusal) => ({ ok: false, ...refusal }),
    now: () => 0,
    ...overrides,
  };
}

test("a start, recovery or restart that arrives during a compatible mutation joins it", async () => {
  const gate = deferred();
  let runs = 0;
  const run = async () => {
    runs += 1;
    return gate.promise;
  };
  const first = runDaemonMutation(mutation("start", { run }));
  const joinedRecovery = runDaemonMutation(mutation("recovery", { run }));
  const joinedStart = runDaemonMutation(mutation("start", { run }));
  assert.deepEqual(daemonMutationOwnerSnapshot().inFlight, { kind: "start", startedAt: 0 });
  gate.resolve({ ok: true, code: "ok" });
  const results = await Promise.all([first, joinedRecovery, joinedStart]);
  assert.equal(runs, 1, "one mutation ran");
  assert.deepEqual(results, [results[0], results[0], results[0]], "joiners receive the same result");
  assert.equal(daemonMutationOwnerSnapshot().inFlight, null);
  assert.deepEqual(daemonMutationOwnerSnapshot().lastOutcome, { kind: "start", code: "ok", settledAt: 0 });
});

test("a restart never joins a start or recovery: it is refused by name while they run", async () => {
  const gate = deferred();
  const start = runDaemonMutation(mutation("recovery", { run: () => gate.promise }));
  const restart = await runDaemonMutation(mutation("restart"));
  assert.deepEqual(restart, { ok: false, code: "mutation_in_flight", inFlight: "recovery" });
  gate.resolve({ ok: true, code: "ok" });
  await start;
  const restartGate = deferred();
  let restartRuns = 0;
  const second = runDaemonMutation(mutation("restart", {
    run: () => {
      restartRuns += 1;
      return restartGate.promise;
    },
  }));
  const joinedRestart = runDaemonMutation(mutation("restart", { run: async () => { throw new Error("must not run"); } }));
  const joinedStart = runDaemonMutation(mutation("start", { run: async () => { throw new Error("must not run"); } }));
  const outcome = { ok: true, code: "ok" };
  restartGate.resolve(outcome);
  assert.equal(await joinedRestart, outcome, "two restarts share one mutation");
  assert.equal(await joinedStart, outcome, "a start during a restart waits for the restart's running daemon");
  assert.equal(await second, outcome);
  assert.equal(restartRuns, 1);
});

test("a duplicate of a timed-out mutation is refused inside the window unless health proves it finished", async () => {
  let now = 10_000;
  const clock = () => now;
  const timedOut = await runDaemonMutation(mutation("start", {
    run: async () => ({ ok: false, code: "readiness_timeout" }),
    now: clock,
  }));
  assert.equal(timedOut.code, "readiness_timeout");

  now += 5_000;
  let runs = 0;
  const refused = await runDaemonMutation(mutation("start", {
    run: async () => {
      runs += 1;
      return { ok: true, code: "ok" };
    },
    timeoutWindowMs: 30_000,
    now: clock,
  }));
  assert.deepEqual(refused, { ok: false, code: "duplicate_after_timeout", retryAfterMs: 25_000, previous: "start" });
  assert.equal(runs, 0, "a refusal never replays the launch");

  const reconciled = await runDaemonMutation(mutation("start", {
    run: async () => {
      runs += 1;
      return { ok: true, code: "ok" };
    },
    probeReady: async () => true,
    timeoutWindowMs: 30_000,
    now: clock,
  }));
  assert.deepEqual(reconciled, { ok: true, code: "reconciled" }, "a late-ready daemon settles the timed-out mutation");
  assert.equal(runs, 0);
  assert.deepEqual(
    daemonMutationOwnerSnapshot().lastOutcome,
    { kind: "start", code: "ok", settledAt: 15_000 },
    "reconciliation records a settled outcome so the window closes",
  );
});

test("the window expires and a different kind is never a duplicate", async () => {
  let now = 0;
  const clock = () => now;
  await runDaemonMutation(mutation("restart", {
    run: async () => ({ ok: false, code: "readiness_timeout" }),
    now: clock,
  }));
  let runs = 0;
  const recovery = await runDaemonMutation(mutation("recovery", {
    run: async () => {
      runs += 1;
      return { ok: true, code: "ok" };
    },
    now: clock,
  }));
  assert.equal(recovery.code, "ok", "an automatic recovery after a timed-out restart is a different mutation");
  await runDaemonMutation(mutation("restart", {
    run: async () => ({ ok: false, code: "readiness_timeout" }),
    now: clock,
  }));
  now = 30_000;
  const afterWindow = await runDaemonMutation(mutation("restart", {
    run: async () => {
      runs += 1;
      return { ok: true, code: "ok" };
    },
    timeoutWindowMs: 30_000,
    now: clock,
  }));
  assert.equal(afterWindow.code, "ok");
  assert.equal(runs, 2);
});

test("a mutation that throws releases the lane and records the throw, not a timeout", async () => {
  await assert.rejects(
    runDaemonMutation(mutation("start", { run: async () => { throw new Error("boom"); } })),
    /boom/,
  );
  assert.equal(daemonMutationOwnerSnapshot().inFlight, null);
  assert.deepEqual(daemonMutationOwnerSnapshot().lastOutcome, { kind: "start", code: "unexpected-error", settledAt: 0 });
  const next = await runDaemonMutation(mutation("start"));
  assert.equal(next.code, "ok", "the next request runs normally");
});

test("other failures are recorded but never refuse the next request", async () => {
  await runDaemonMutation(mutation("start", { run: async () => ({ ok: false, code: "spawn_failed" }) }));
  let runs = 0;
  await runDaemonMutation(mutation("start", {
    run: async () => {
      runs += 1;
      return { ok: true, code: "ok" };
    },
  }));
  assert.equal(runs, 1);
});
