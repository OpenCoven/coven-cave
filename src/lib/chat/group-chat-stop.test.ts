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
  } satisfies ActiveGroupReplyRun;
}

test("stopActiveGroupReplyRuns stops every concurrent run and aborts only after stop settles", async () => {
  const registry = new Map<string, ActiveGroupReplyRun>();
  const aborts: string[] = [];
  const releases: Array<() => void> = [];
  const seen: Array<{ runId: string; sessionId: string | null }> = [];
  const first = makeEntry("run-a", 7, { sessionId: "session-a" });
  const second = makeEntry("run-b", 7);
  first.controller.signal.addEventListener("abort", () => aborts.push(first.runId));
  second.controller.signal.addEventListener("abort", () => aborts.push(second.runId));
  registerActiveGroupReplyRun(registry, first);
  registerActiveGroupReplyRun(registry, second);

  const pending = stopActiveGroupReplyRuns({
    entries: listActiveGroupReplyRuns(registry, 7),
    stopRun: ({ runId, sessionId }) =>
      new Promise((resolve) => {
        seen.push({ runId, sessionId });
        releases.push(() => resolve({ ok: true, stopped: true, status: 200 }));
      }),
  });

  assert.deepEqual(aborts, [], "local controllers stay live until stop dispatch settles");
  assert.deepEqual(seen, [
    { runId: "run-a", sessionId: "session-a" },
    { runId: "run-b", sessionId: null },
  ]);

  releases.shift()?.();
  await Promise.resolve();
  assert.deepEqual(aborts, ["run-a"], "each local controller aborts only after its own stop settles");

  releases.shift()?.();
  const results = await pending;
  assert.deepEqual(aborts.sort(), ["run-a", "run-b"]);
  assert.deepEqual(
    results.map(({ runId, ok, stopped, status }) => ({ runId, ok, stopped, status })),
    [
      { runId: "run-a", ok: true, stopped: true, status: 200 },
      { runId: "run-b", ok: true, stopped: true, status: 200 },
    ],
  );
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
        ? { ok: false, stopped: false, status: 404, error: "not found" }
        : Promise.reject(new Error("gateway down")),
    onError: (result) => {
      errors.push({ runId: result.runId, error: result.error, status: result.status });
    },
  });

  assert.equal(notFound.controller.signal.aborted, true, "404 stop still tears down the local stream");
  assert.equal(throwing.controller.signal.aborted, true, "endpoint failures do not strand the local UI");
  assert.deepEqual(
    results.map(({ runId, ok, stopped, status, error }) => ({ runId, ok, stopped, status, error })),
    [
      { runId: "run-not-found", ok: false, stopped: false, status: 404, error: "not found" },
      { runId: "run-throw", ok: false, stopped: false, status: null, error: "gateway down" },
    ],
  );
  assert.deepEqual(
    errors,
    [{ runId: "run-throw", error: "gateway down", status: null }],
    "404/not-found is idempotent, but true endpoint failures are reported",
  );
});

console.log("group-chat-stop.test.ts: ok");
