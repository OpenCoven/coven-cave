// Integration: probe evidence → verdict → board mutation under the lock, on
// a real board file in an isolated home (#6562 slice 2).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-task-runs-"));
process.env.HOME = tmpHome;
process.env.COVEN_CAVE_HOME = tmpHome;

const longAgo = "2026-09-28T07:44:24.761Z";
const nowMs = Date.parse("2026-11-25T12:00:00.000Z");
const recent = new Date(nowMs - 60_000).toISOString();

function card(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    notes: "",
    status: "running",
    priority: "medium",
    familiarId: "nova",
    sessionId: `session-${id}`,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: longAgo,
    updatedAt: longAgo,
    lifecycle: "running",
    lifecycleAt: longAgo,
    runningSince: longAgo,
    retryCount: 0,
    maxRetries: 3,
    steps: [],
    dependencies: [],
    primaryBlockerId: null,
    primaryBlockerPinned: false,
    nextStep: null,
    ...overrides,
  };
}

const enhanceStep = {
  summary: "Audit the specs against the four blockers",
  requiresApproval: false,
  origin: "enhance",
  updatedAt: longAgo,
};
const blockerStep = { summary: "Provision the deploy key", requiresApproval: false, origin: "system", updatedAt: longAgo };
const humanStep = { summary: "Ask Val about scope", requiresApproval: false, origin: "human", updatedAt: longAgo };
const enhanceDependency = {
  id: "outbox-effect-identity",
  kind: "external",
  label: "No spec line yet confirms a per-intent outbox effect ID",
  taskId: null,
  ref: null,
  state: "unresolved",
  origin: "enhance",
  createdAt: longAgo,
};

await mkdir(tmpHome, { recursive: true });
await writeFile(
  path.join(tmpHome, "board.json"),
  JSON.stringify({
    version: 2,
    cards: [
      // The issue's example shape: native transcript, enhance blockers and step.
      card("finished", { dependencies: [enhanceDependency], primaryBlockerId: enhanceDependency.id, nextStep: enhanceStep }),
      card("errored", { nextStep: humanStep }),
      card("blocker-step", { nextStep: blockerStep }),
      card("unanswered"),
      card("stopped"),
      card("live"),
      card("fresh", { lifecycleAt: recent, runningSince: recent }),
      card("daemon-done", { lifecycle: "dispatched", status: "running", runningSince: undefined }),
      card("daemon-running"),
      card("daemon-ghost"),
      card("daemon-missing"),
      card("unreadable"),
      card("queued", { lifecycle: "queued", status: "backlog", runningSince: undefined }),
    ],
  }),
);

const board = await import("@/lib/cave-board");
const liveness = await import("@/lib/server/task-run-liveness");

const transcripts: Record<string, { turns: unknown[] } | null> = {
  "session-finished": { turns: [
    { role: "user", createdAt: "2026-10-28T21:13:13.368Z" },
    { role: "assistant", createdAt: "2026-10-28T21:13:13.368Z", durationMs: 2000 },
  ] },
  "session-blocker-step": { turns: [{ role: "assistant", createdAt: longAgo }] },
  "session-errored": { turns: [{ role: "assistant", createdAt: longAgo, isError: true }] },
  "session-unanswered": { turns: [{ role: "user", createdAt: longAgo }] },
  "session-stopped": { turns: [{ role: "assistant", createdAt: longAgo, cancelled: true }] },
  "session-live": { turns: [{ role: "assistant", createdAt: longAgo }] },
  "session-fresh": { turns: [{ role: "assistant", createdAt: longAgo }] },
  "session-unreadable": null,
};

const daemonCalls: string[] = [];
let daemonOnline = true;
const daemonRows: Record<string, { id: string; status: string; created_at: string; updated_at: string }> = {
  "session-daemon-done": { id: "session-daemon-done", status: "completed", created_at: longAgo, updated_at: longAgo },
  "session-daemon-running": { id: "session-daemon-running", status: "running", created_at: longAgo, updated_at: longAgo },
  "session-daemon-ghost": { id: "session-daemon-ghost", status: "running", created_at: longAgo, updated_at: longAgo },
};
const settledBatches: number[] = [];

const deps = {
  nowMs: () => nowMs,
  hasActiveChatRun: (sessionId: string) => sessionId === "session-live",
  loadTranscript: async (sessionId: string) =>
    sessionId in transcripts ? (transcripts[sessionId] as never) : undefined,
  getDaemonSession: async (sessionId: string) => {
    daemonCalls.push(sessionId);
    if (!daemonOnline) return null;
    return daemonRows[sessionId] ?? ("missing" as const);
  },
  ghostSessions: async (rows: Array<{ id: string }>) =>
    new Set(rows.filter((row) => row.id === "session-daemon-ghost").map((row) => row.id)),
  settle: async (settlements: Parameters<typeof board.settleEndedTaskRuns>[0]) => {
    settledBatches.push(settlements.length);
    return board.settleEndedTaskRuns(settlements);
  },
};

const changed = await liveness.reconcileStaleTaskRuns(deps);
assert.deepEqual(
  daemonCalls.sort(),
  ["session-daemon-done", "session-daemon-ghost", "session-daemon-missing", "session-daemon-running"],
  "the daemon is asked only about sessions with no transcript and no run in flight",
);
assert.deepEqual(
  changed.map((entry) => entry.id).sort(),
  ["blocker-step", "daemon-done", "daemon-ghost", "daemon-missing", "errored", "finished", "stopped", "unanswered"],
);

const after = new Map((await board.loadBoard()).cards.map((entry) => [entry.id, entry]));

const finished = after.get("finished")!;
assert.equal(finished.lifecycle, "review", "a clean finish settles in Review");
assert.equal(finished.status, "review");
assert.equal(finished.needsHuman, true);
assert.equal(finished.runningSince, undefined);
assert.match(finished.lifecycleReason ?? "", /finished its last reply at 2026-10-28T21:13:15\.368Z/);
assert.deepEqual(finished.nextStep, enhanceStep, "an authored (Enhance) next step is kept");
assert.deepEqual(finished.dependencies, [enhanceDependency], "authored dependencies are untouched");
assert.equal(after.get("blocker-step")!.lifecycle, "review");
assert.deepEqual(after.get("blocker-step")!.nextStep, blockerStep, "a system step from an open blocker is not replaced by the review step");

const errored = after.get("errored")!;
assert.equal(errored.lifecycle, "failed");
assert.equal(errored.status, "blocked", "a failed run is failure-blocked");
const executionBlocker = errored.dependencies?.find((dependency) => dependency.kind === "execution");
assert.ok(executionBlocker, "a failed run carries the execution blocker");
assert.equal(executionBlocker.origin, "system");
assert.match(executionBlocker.label, /^Run failed: Session session-'s last reply failed at 2026-09-28T07:44:24\.761Z \(checked 2026-11-25T12:00:00\.000Z\)$/);
assert.equal(errored.primaryBlockerId, executionBlocker.id);
assert.deepEqual(errored.nextStep, humanStep, "a human next step survives the failure");

const unanswered = after.get("unanswered")!;
assert.equal(unanswered.lifecycle, "failed");
assert.equal(unanswered.nextStep?.origin, "system", "the failure's own step asks a person to retry or repair");
assert.equal(unanswered.nextStep?.requiresApproval, true);

const stopped = after.get("stopped")!;
assert.equal(stopped.lifecycle, "cancelled", "a reply the person stopped is a cancelled run, which keeps its blocker");
assert.match(stopped.dependencies?.at(-1)?.label ?? "", /^Run was cancelled/);

assert.equal(after.get("daemon-done")!.lifecycle, "review", "a dispatched daemon task that completed settles in Review");
assert.equal(after.get("daemon-done")!.nextStep?.origin, "system");
assert.equal(after.get("daemon-ghost")!.lifecycle, "failed");
assert.equal(after.get("daemon-missing")!.lifecycle, "failed");
assert.match(after.get("daemon-missing")!.lifecycleReason ?? "", /no longer exists/);

for (const id of ["live", "fresh", "daemon-running", "unreadable", "queued"]) {
  const entry = after.get(id)!;
  const original = id === "queued" ? "queued" : "running";
  assert.equal(entry.lifecycle, original, `${id} is left as it was`);
}

// Idempotent: a second sweep settles nothing and writes nothing.
const boardBytes = await readFile(path.join(tmpHome, "board.json"), "utf8");
assert.deepEqual(await liveness.reconcileStaleTaskRuns(deps), []);
assert.equal(await readFile(path.join(tmpHome, "board.json"), "utf8"), boardBytes, "a repeat sweep doesn't rewrite the board");

// An offline daemon settles nothing it would have needed the daemon for.
daemonOnline = false;
await writeFile(
  path.join(tmpHome, "board.json"),
  JSON.stringify({ version: 2, cards: [card("offline")] }),
);
assert.deepEqual(await liveness.reconcileStaleTaskRuns(deps), [], "daemon offline → unknown → nothing settles");
assert.equal((await board.loadBoard()).cards[0].lifecycle, "running");

// A transition that lands between the probe and the mutation wins.
await writeFile(
  path.join(tmpHome, "board.json"),
  JSON.stringify({ version: 2, cards: [card("raced")] }),
);
transcripts["session-raced"] = { turns: [{ role: "assistant", createdAt: longAgo }] };
const raced = await liveness.reconcileStaleTaskRuns({
  ...deps,
  settle: async (settlements) => {
    await board.transitionCard("raced", { to: "completed", reason: "Done by hand" });
    return board.settleEndedTaskRuns(settlements);
  },
});
assert.deepEqual(raced, [], "a card that moved since the probe is not settled");
assert.equal((await board.loadBoard()).cards[0].lifecycle, "completed");

// Completing a reviewed run clears the system review step it asked for.
await writeFile(
  path.join(tmpHome, "board.json"),
  JSON.stringify({ version: 2, cards: [card("reviewed")] }),
);
transcripts["session-reviewed"] = { turns: [{ role: "assistant", createdAt: longAgo }] };
const [reviewed] = await liveness.reconcileStaleTaskRuns(deps);
assert.equal(reviewed.lifecycle, "review");
assert.equal(reviewed.nextStep?.summary, "Review what the task chat produced");
const completed = await board.transitionCard("reviewed", { to: "completed", reason: "Looks right" });
assert.equal(completed?.nextStep, null, "completing is the review the step asked for");
assert.equal(completed?.needsHuman, false);

// Throttle: one sweep a minute, and the in-flight sweep is shared.
liveness.resetTaskRunSweepForTest();
let sweeps = 0;
const counting = { ...deps, settle: async () => { sweeps += 1; return []; } };
await writeFile(
  path.join(tmpHome, "board.json"),
  JSON.stringify({ version: 2, cards: [card("throttled")] }),
);
transcripts["session-throttled"] = { turns: [{ role: "assistant", createdAt: longAgo }] };
await Promise.all([liveness.maybeReconcileStaleTaskRuns(counting), liveness.maybeReconcileStaleTaskRuns(counting)]);
await liveness.maybeReconcileStaleTaskRuns(counting);
assert.equal(sweeps, 1, "concurrent and repeated calls inside the interval share one sweep");
await liveness.maybeReconcileStaleTaskRuns({ ...counting, nowMs: () => nowMs + liveness.TASK_RUN_SWEEP_INTERVAL_MS });
assert.equal(sweeps, 2, "the next interval sweeps again");

// A sweep that throws is logged, never thrown into the board load.
liveness.resetTaskRunSweepForTest();
const originalWarn = console.warn;
console.warn = () => {};
try {
  assert.deepEqual(
    await liveness.maybeReconcileStaleTaskRuns({ ...deps, settle: async () => { throw new Error("disk full"); } }),
    [],
  );
} finally {
  console.warn = originalWarn;
}

// A hung daemon costs one timeout per sweep, and the board load waits a bounded time.
{
  liveness.resetTaskRunSweepForTest();
  await writeFile(
    path.join(tmpHome, "board.json"),
    JSON.stringify({ version: 2, cards: [card("slow-a"), card("slow-b"), card("slow-c")] }),
  );
  let open = 0;
  let peak = 0;
  const slow = {
    ...deps,
    loadTranscript: async () => undefined,
    getDaemonSession: async () => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise((resolve) => setTimeout(resolve, 300));
      open -= 1;
      return null;
    },
    settle: async () => [],
  };
  const started = Date.now();
  await liveness.reconcileStaleTaskRunsBriefly(50, slow);
  assert.ok(Date.now() - started < 250, "the board load stops waiting at its deadline");
  await liveness.maybeReconcileStaleTaskRuns(slow); // joins the sweep still in flight
  assert.equal(peak, 3, "daemon reads for every candidate run in parallel");
  liveness.resetTaskRunSweepForTest();
}

// Only Coven's typed not-found proves a session is gone.
const row = { id: "s", status: "completed", created_at: longAgo, updated_at: longAgo, extra: 1 };
assert.deepEqual(
  liveness.daemonSessionFromResponse({ ok: true, status: 200, data: row }),
  { id: "s", status: "completed", created_at: longAgo, updated_at: longAgo },
);
assert.equal(
  liveness.daemonSessionFromResponse({ ok: false, status: 404, data: { error: { code: "session_not_found", message: "Session was not found." } } }),
  "missing",
);
assert.equal(liveness.daemonSessionFromResponse({ ok: false, status: 404, data: null }), null, "a bare 404 (a proxy) proves nothing");
assert.equal(liveness.daemonSessionFromResponse({ ok: false, status: 0, data: null }), null, "offline proves nothing");
assert.equal(liveness.daemonSessionFromResponse({ ok: false, status: 500, data: { error: { code: "session_not_found" } } }), null);
assert.equal(liveness.daemonSessionFromResponse({ ok: true, status: 200, data: { id: "s" } }), null, "a row without a status is unreadable");

console.log("task-run-liveness: ok");
