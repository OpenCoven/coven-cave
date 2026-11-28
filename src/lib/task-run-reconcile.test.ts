import assert from "node:assert/strict";
import {
  classifyTaskRun,
  isTaskRunProbeCandidate,
  lastTranscriptTurn,
  TASK_RUN_STALE_AFTER_MS,
  type TaskSessionEvidence,
} from "./task-run-reconcile.ts";

const nowMs = Date.parse("2026-11-25T12:00:00.000Z");
const longAgo = "2026-09-28T07:44:24.761Z";
const recent = new Date(nowMs - 5 * 60 * 1000).toISOString();

const running = {
  lifecycle: "running" as const,
  lifecycleAt: longAgo,
  runningSince: longAgo,
  sessionId: "675fb6b5-2f9e-40f0-b785-b04e4345c85f",
};

function verdict(evidence: TaskSessionEvidence, card = running) {
  return classifyTaskRun(card, evidence, { nowMs });
}

// Candidates: running-tone lifecycle, a session, and past the grace window.
assert.equal(isTaskRunProbeCandidate(running, nowMs), true);
assert.equal(isTaskRunProbeCandidate({ ...running, lifecycle: "dispatched" }, nowMs), true, "dispatched tasks are running work too");
for (const lifecycle of ["queued", "review", "completed", "failed", "cancelled"] as const) {
  assert.equal(isTaskRunProbeCandidate({ ...running, lifecycle }, nowMs), false, `${lifecycle} is not running`);
}
assert.equal(isTaskRunProbeCandidate({ ...running, sessionId: null }, nowMs), false, "no session, nothing to observe");
assert.equal(
  isTaskRunProbeCandidate({ ...running, lifecycleAt: recent, runningSince: undefined }, nowMs),
  false,
  "a task dispatched inside the grace window is never probed",
);
assert.equal(
  isTaskRunProbeCandidate({ ...running, lifecycleAt: longAgo, runningSince: recent }, nowMs),
  false,
  "the later of dispatch and running marks starts the grace window",
);
assert.equal(
  isTaskRunProbeCandidate({ ...running, lifecycleAt: "not a date", runningSince: undefined }, nowMs),
  false,
  "an unparsable stamp never qualifies",
);

// Evidence that cannot rule keeps the card.
assert.deepEqual(verdict({ kind: "live" }), { kind: "keep" });
assert.deepEqual(verdict({ kind: "unknown" }), { kind: "keep" }, "an offline daemon never settles a task");
assert.deepEqual(verdict({ kind: "native", lastTurn: null }), { kind: "keep" }, "an empty transcript proves nothing");

// The issue's example: a native transcript whose last reply landed on 10-28.
const finished = verdict({
  kind: "native",
  lastTurn: { role: "assistant", createdAt: "2026-10-28T21:13:13.368Z", durationMs: 4_000 },
});
assert.equal(finished.kind, "ended");
assert.equal(finished.kind === "ended" && finished.outcome, "review", "a clean finish goes to Review, never Completed");
assert.match(finished.kind === "ended" ? finished.evidence : "", /Session 675fb6b5 finished its last reply at 2026-10-28T21:13:17\.368Z/);
assert.match(finished.kind === "ended" ? finished.evidence : "", /checked 2026-11-25T12:00:00\.000Z/, "the evidence says when it was checked");

const errored = verdict({ kind: "native", lastTurn: { role: "assistant", createdAt: longAgo, isError: true } });
assert.equal(errored.kind === "ended" && errored.outcome, "failed");
const stopped = verdict({ kind: "native", lastTurn: { role: "assistant", createdAt: longAgo, cancelled: true } });
assert.equal(stopped.kind === "ended" && stopped.outcome, "cancelled", "a reply the person stopped is a cancelled run");
const unanswered = verdict({ kind: "native", lastTurn: { role: "user", createdAt: longAgo } });
assert.equal(unanswered.kind === "ended" && unanswered.outcome, "failed", "a run that died before replying failed");
assert.match(unanswered.kind === "ended" ? unanswered.evidence : "", /got no reply to the message sent at .* no run in progress here/);
assert.deepEqual(
  verdict({ kind: "native", lastTurn: { role: "user", createdAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString() } }),
  { kind: "keep" },
  "an unanswered message two hours old may still be streaming in another Cave server",
);
assert.equal(
  verdict({ kind: "native", lastTurn: { role: "user", createdAt: new Date(nowMs - 25 * 60 * 60 * 1000).toISOString() } }).kind,
  "ended",
  "after a day with no reply, the run failed",
);

assert.deepEqual(
  verdict({ kind: "native", lastTurn: { role: "assistant", createdAt: recent } }),
  { kind: "keep" },
  "a recent turn means the conversation may still be going",
);
assert.deepEqual(
  verdict({
    kind: "native",
    lastTurn: { role: "assistant", createdAt: new Date(nowMs - TASK_RUN_STALE_AFTER_MS - 1_000).toISOString(), durationMs: 10_000 },
  }),
  { kind: "keep" },
  "the grace window runs from when the reply finished, not when it began",
);
assert.deepEqual(verdict({ kind: "native", lastTurn: { role: "assistant", createdAt: "garbage" } }), { kind: "keep" });

// Daemon sessions.
const daemon = (status: string, ghost = false): TaskSessionEvidence => ({ kind: "daemon", status, updatedAt: longAgo, ghost });
assert.deepEqual(verdict(daemon("running")), { kind: "keep" }, "a running daemon session with a process stays Running");
const ghost = verdict(daemon("running", true));
assert.equal(ghost.kind === "ended" && ghost.outcome, "failed", "a ghost row is a dead run");
assert.equal((verdict(daemon("completed")) as { outcome?: string }).outcome, "review");
assert.equal((verdict(daemon("failed")) as { outcome?: string }).outcome, "failed");
assert.equal((verdict(daemon("orphaned")) as { outcome?: string }).outcome, "failed");
assert.deepEqual(verdict(daemon("created")), { kind: "keep" }, "idle-tone rows prove nothing");
assert.deepEqual(verdict(daemon("")), { kind: "keep" });

const missing = verdict({ kind: "missing" });
assert.equal(missing.kind === "ended" && missing.outcome, "failed");
assert.match(missing.kind === "ended" ? missing.evidence : "", /no longer exists/);

// Not a candidate → keep, whatever the evidence says.
assert.deepEqual(verdict({ kind: "missing" }, { ...running, lifecycle: "review" as never }), { kind: "keep" });

// lastTranscriptTurn: latest by time, replies win ties, system rows skipped.
assert.equal(lastTranscriptTurn([]), null);
assert.equal(
  lastTranscriptTurn([
    { role: "user", createdAt: "2026-10-28T21:13:13.368Z" },
    { role: "assistant", createdAt: "2026-10-28T21:13:13.368Z" },
  ])?.role,
  "assistant",
);
assert.equal(
  lastTranscriptTurn([
    { role: "assistant", createdAt: "2026-10-28T21:13:13.368Z" },
    { role: "user", createdAt: "2026-10-29T00:00:00.000Z" },
    { role: "system", createdAt: "2026-11-01T00:00:00.000Z" },
    { role: "assistant", createdAt: "bad" },
  ])?.role,
  "user",
);

console.log("task-run-reconcile: ok");
