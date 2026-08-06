import assert from "node:assert/strict";
import test from "node:test";
import {
  listActiveGroupReplyRuns,
  registerActiveGroupReplyRun,
  stopActiveGroupReplyRuns,
  unregisterActiveGroupReplyRun,
  updateActiveGroupReplyRunSession,
  type ActiveGroupReplyRun,
} from "./group-chat-stop.ts";

function makeEntry(
  runId: string,
  scopeId: number,
  overrides: Partial<Omit<ActiveGroupReplyRun, "runId" | "scopeId">> = {},
) {
  return {
    runId,
    replyId: overrides.replyId ?? `reply-${runId}`,
    groupId: overrides.groupId ?? "group-1",
    familiarId: overrides.familiarId ?? `fam-${runId}`,
    sessionId: overrides.sessionId ?? null,
    scopeId,
    controller: overrides.controller ?? new AbortController(),
    terminalOutcome: overrides.terminalOutcome ?? null,
  } satisfies ActiveGroupReplyRun;
}

test("stopActiveGroupReplyRuns stops every concurrent run and aborts only after stop settles", async () => {
  const registry = new Map<string, ActiveGroupReplyRun>();
  const aborts: string[] = [];
  const releases: Array<() => void> = [];
  const seen: string[] = [];
  const first = makeEntry("run-a", 7, { sessionId: "session-a" });
  const second = makeEntry("run-b", 7);
  first.controller.signal.addEventListener("abort", () => aborts.push(first.runId));
  second.controller.signal.addEventListener("abort", () => aborts.push(second.runId));
  registerActiveGroupReplyRun(registry, first);
  registerActiveGroupReplyRun(registry, second);

  const pending = stopActiveGroupReplyRuns({
    entries: listActiveGroupReplyRuns(registry, 7),
    stopRun: ({ runId }) =>
      new Promise((resolve) => {
        seen.push(runId);
        releases.push(() => resolve({ ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null }));
      }),
  });

  assert.deepEqual(aborts, [], "local controllers stay live until stop dispatch settles");
  assert.deepEqual(seen, ["run-a", "run-b"]);

  releases.shift()?.();
  await Promise.resolve();
  assert.deepEqual(aborts, [], "group stop waits to abort local streams until every run settles");

  releases.shift()?.();
  const results = await pending;
  assert.deepEqual(aborts.sort(), ["run-a", "run-b"]);
  assert.deepEqual(
    results.map(({ runId, ok, stopped, status, state, terminalOutcome }) => ({
      runId,
      ok,
      stopped,
      status,
      state,
      terminalOutcome,
    })),
    [
      { runId: "run-a", ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null },
      { runId: "run-b", ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null },
    ],
  );
});

test("stopActiveGroupReplyRuns retries a registration race until the server accepts the exact runId", async () => {
  const sharedController = new AbortController();
  const registry = new Map<string, ActiveGroupReplyRun>();
  const entry = makeEntry("run-retry", 8, { controller: sharedController });
  registerActiveGroupReplyRun(registry, entry);
  let attempts = 0;

  const results = await stopActiveGroupReplyRuns({
    entries: [entry],
    stopRun: async ({ runId }) => {
      attempts += 1;
      assert.equal(runId, "run-retry");
      return attempts === 1
        ? { ok: true, stopped: false, status: 200, state: "not-found", terminalOutcome: null }
        : { ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null };
    },
    isEntryActive: (candidate) => registry.get(candidate.runId) === candidate,
    sleep: async () => {},
  });

  assert.equal(attempts, 2, "a 200 stopped:false is not success while the run is still active");
  assert.equal(sharedController.signal.aborted, true, "local teardown waits until the accepted stop arrives");
  assert.deepEqual(results, [{
    runId: "run-retry", ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null,
  }]);
});

test("stopActiveGroupReplyRuns stops retrying once the terminal stream already removed the run", async () => {
  const registry = new Map<string, ActiveGroupReplyRun>();
  const entry = makeEntry("run-terminal", 9);
  registerActiveGroupReplyRun(registry, entry);
  const errors: Array<{ runId: string; error?: string }> = [];
  let sleeps = 0;

  const results = await stopActiveGroupReplyRuns({
    entries: [entry],
    stopRun: async () => ({ ok: true, stopped: false, status: 200, state: "not-found", terminalOutcome: null }),
    isEntryActive: (candidate) => registry.get(candidate.runId) === candidate,
    sleep: async () => {
      sleeps += 1;
      unregisterActiveGroupReplyRun(registry, entry.runId);
    },
    onError: (result) => errors.push({ runId: result.runId, error: result.error }),
  });

  assert.equal(sleeps, 1, "one bounded retry window lets the terminal cleanup win the race");
  assert.deepEqual(results, [{
    runId: "run-terminal", ok: true, stopped: false, status: 200, state: "not-found", terminalOutcome: null,
  }]);
  assert.deepEqual(errors, [], "terminal cleanup is not reported as a stop failure");
});

test("stopActiveGroupReplyRuns retries network errors before surfacing a final success", async () => {
  const entry = makeEntry("run-network", 10);
  let attempts = 0;

  const results = await stopActiveGroupReplyRuns({
    entries: [entry],
    stopRun: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("gateway down");
      return { ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null };
    },
    sleep: async () => {},
  });

  assert.equal(attempts, 2, "transient stop transport failures retry within the bounded window");
  assert.deepEqual(results, [{
    runId: "run-network", ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null,
  }]);
});

test("stopActiveGroupReplyRuns times out a still-live run and reports the final failure", async () => {
  const entry = makeEntry("run-timeout", 11);
  const errors: Array<{ runId: string; error?: string; status: number | null }> = [];
  let clock = 0;

  const results = await stopActiveGroupReplyRuns({
    entries: [entry],
    stopRun: async () => ({ ok: true, stopped: false, status: 200, state: "not-found", terminalOutcome: null }),
    now: () => clock,
    sleep: async () => {
      clock += 50;
    },
    retryDelayMs: 50,
    timeoutMs: 100,
    onError: (result) => {
      errors.push({ runId: result.runId, error: result.error, status: result.status });
    },
  });

  assert.equal(entry.controller.signal.aborted, true, "timeout policy explicitly tears down the local stream");
  assert.deepEqual(results, [{
    runId: "run-timeout", ok: true, stopped: false, status: 200, state: "not-found", terminalOutcome: null, error: "stop timed out",
  }]);
  assert.deepEqual(errors, [{ runId: "run-timeout", error: "stop timed out", status: 200 }]);
});

test("stopActiveGroupReplyRuns keeps retrying a retired scope until an exact run is finally accepted", async () => {
  const entry = makeEntry("run-retired-scope", 12);
  let attempts = 0;

  const results = await stopActiveGroupReplyRuns({
    entries: [entry],
    stopRun: async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: true, stopped: false, status: 200, state: "not-found", terminalOutcome: null }
        : { ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null };
    },
    sleep: async () => {},
  });

  assert.equal(attempts, 2, "retired-scope cleanup still gets one bounded retry window");
  assert.equal(entry.controller.signal.aborted, true, "accepted stop still tears down the local stream");
  assert.deepEqual(results, [{
    runId: "run-retired-scope", ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null,
  }]);
});

test("stopActiveGroupReplyRuns preserves completed transports through slow persistence", async () => {
  const sharedController = new AbortController();
  const completed = makeEntry("run-completed-save", 13, { controller: sharedController });
  const active = makeEntry("run-active-save", 13, { controller: sharedController });

  const results = await stopActiveGroupReplyRuns({
    entries: [completed, active],
    stopRun: async ({ runId }) =>
      runId === completed.runId
        ? {
            ok: true,
            stopped: false,
            status: 200,
            state: "transport-settled",
            terminalOutcome: "completed",
          }
        : { ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null },
  });

  assert.equal(sharedController.signal.aborted, true, "the still-live sibling stop tears down the shared scope");
  assert.equal(completed.terminalOutcome, "completed", "terminal evidence is retained for aborted completed transports");
  assert.deepEqual(results, [
    {
      runId: "run-completed-save",
      ok: true,
      stopped: false,
      status: 200,
      state: "transport-settled",
      terminalOutcome: "completed",
    },
    {
      runId: "run-active-save",
      ok: true,
      stopped: true,
      status: 200,
      state: "accepted",
      terminalOutcome: null,
    },
  ]);
});

test("stopActiveGroupReplyRuns can abort stale local continuation after transport settlement without relabeling completion", async () => {
  const entry = makeEntry("run-completed-only", 14);

  const results = await stopActiveGroupReplyRuns({
    entries: [entry],
    stopRun: async () => ({
      ok: true,
      stopped: false,
      status: 200,
      state: "transport-settled",
      terminalOutcome: "completed",
    }),
    abortLocalOnTransportSettled: true,
  });

  assert.equal(entry.controller.signal.aborted, true, "retired-scope cleanup aborts local continuation once the server confirms transport settlement");
  assert.equal(entry.terminalOutcome, "completed", "local abort keeps the retained completed outcome for abort cleanup");
  assert.deepEqual(results, [{
    runId: "run-completed-only",
    ok: true,
    stopped: false,
    status: 200,
    state: "transport-settled",
    terminalOutcome: "completed",
  }]);
});

test("active scope snapshots exclude completed runs and another coven's newer scope", () => {
  const registry = new Map<string, ActiveGroupReplyRun>();
  const completed = makeEntry("run-completed", 1);
  const current = makeEntry("run-current", 1);
  const newerScope = makeEntry("run-newer", 2, { groupId: "group-2" });
  registerActiveGroupReplyRun(registry, completed);
  registerActiveGroupReplyRun(registry, current);
  registerActiveGroupReplyRun(registry, newerScope);
  unregisterActiveGroupReplyRun(registry, completed.runId);

  assert.deepEqual(
    listActiveGroupReplyRuns(registry, 1).map((entry) => entry.runId),
    ["run-current"],
    "serial stop only sees the still-live current reply",
  );
  assert.deepEqual(
    listActiveGroupReplyRuns(registry, 2).map((entry) => entry.runId),
    ["run-newer"],
    "a switch scope does not stop another coven's newly started run",
  );
});

test("session announcements update the active stop payload", () => {
  const registry = new Map<string, ActiveGroupReplyRun>();
  registerActiveGroupReplyRun(registry, makeEntry("run-session", 3));
  updateActiveGroupReplyRunSession(registry, "run-session", "session-live");
  assert.equal(
    listActiveGroupReplyRuns(registry, 3)[0]?.sessionId,
    "session-live",
    "stop payloads reuse the announced familiar session when it exists",
  );
});

test("idempotent stop outcomes are accepted while endpoint failures still abort locally", async () => {
  const notFound = makeEntry("run-not-found", 5);
  const throwing = makeEntry("run-throw", 5);
  const registry = new Map<string, ActiveGroupReplyRun>();
  const errors: Array<{ runId: string; error?: string; status: number | null }> = [];
  registerActiveGroupReplyRun(registry, notFound);
  registerActiveGroupReplyRun(registry, throwing);

  const results = await stopActiveGroupReplyRuns({
    entries: listActiveGroupReplyRuns(registry, 5),
    stopRun: async ({ runId }) =>
      runId === "run-not-found"
        ? { ok: false, stopped: false, status: 404, state: "not-found", terminalOutcome: null, error: "not found" }
        : Promise.reject(new Error("gateway down")),
    onError: (result) => {
      errors.push({ runId: result.runId, error: result.error, status: result.status });
    },
    now: () => 1_000,
    sleep: async () => {},
    timeoutMs: 0,
  });

  assert.equal(notFound.controller.signal.aborted, true, "404 stop still tears down the local stream");
  assert.equal(throwing.controller.signal.aborted, true, "endpoint failures do not strand the local UI");
  assert.deepEqual(
    results.map(({ runId, ok, stopped, status, state, terminalOutcome, error }) => ({
      runId,
      ok,
      stopped,
      status,
      state,
      terminalOutcome,
      error,
    })),
    [
      {
       runId: "run-not-found",
       ok: false,
       stopped: false,
       status: 404,
       state: "not-found",
       terminalOutcome: null,
       error: "not found",
      },
      {
       runId: "run-throw",
       ok: false,
       stopped: false,
       status: null,
       state: null,
       terminalOutcome: null,
       error: "gateway down",
      },
    ],
  );
  assert.deepEqual(
    errors,
    [{ runId: "run-throw", error: "gateway down", status: null }],
    "404/not-found is idempotent, but true endpoint failures are reported",
  );
});

console.log("group-chat-stop.test.ts: ok");
