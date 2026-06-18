import assert from "node:assert/strict";
import { workflowExecutionOrder } from "./workflow-graph.ts";
import {
  activeStepId,
  advancePlayback,
  blockedCount,
  nodePhase,
  nodePhases,
  playbackFinished,
  playbackFromPlan,
  playbackFromRun,
  playbackSummary,
} from "./workflow-playback.ts";
import type { WorkflowDryRunPlan, WorkflowRunRecord, WorkflowSummary } from "./workflows.ts";

const sequential: WorkflowSummary = {
  id: "wf",
  version: "1.0.0",
  steps: [
    { id: "a", kind: "agent" },
    { id: "b", kind: "agent" },
    { id: "c", kind: "tool" },
  ],
};

const dependent: WorkflowSummary = {
  id: "wf2",
  version: "1.0.0",
  steps: [
    { id: "synth", kind: "agent", requires: ["one", "two"] },
    { id: "one", kind: "agent" },
    { id: "two", kind: "agent" },
  ],
};

// --- execution order ---
assert.deepEqual(
  workflowExecutionOrder(sequential),
  ["a", "b", "c"],
  "no-dependency workflows keep manifest order",
);
assert.deepEqual(
  workflowExecutionOrder(dependent),
  ["one", "two", "synth"],
  "dependency depth orders roots before the step that requires them",
);

// --- playback from a plan ---
const plan: WorkflowDryRunPlan = {
  ok: false,
  steps: [
    { id: "a", kind: "agent", status: "ready" },
    { id: "b", kind: "agent", status: "blocked" },
    { id: "c", kind: "tool", status: "ready" },
  ],
};
let state = playbackFromPlan(sequential, plan, "dry-run");
assert.equal(state.cursor, 0, "playback starts at the first step");
assert.equal(state.source, "dry-run", "source is preserved for honest labelling");
assert.equal(activeStepId(state), "a", "first step is active at cursor 0");
assert.equal(nodePhase(state, "a"), "active", "node at the cursor is active");
assert.equal(nodePhase(state, "b"), "pending", "nodes ahead of the cursor are pending");
assert.equal(playbackFinished(state), false, "fresh playback is not finished");
assert.equal(playbackSummary(state), "step 1 / 3", "summary shows progress while running");

state = advancePlayback(state);
assert.equal(nodePhase(state, "a"), "done", "ready step behind the cursor resolves to done");
assert.equal(nodePhase(state, "b"), "active", "cursor advanced to the next step");

state = advancePlayback(state);
assert.equal(nodePhase(state, "b"), "blocked", "blocked plan verdict resolves to a blocked node");

state = advancePlayback(state);
assert.equal(playbackFinished(state), true, "cursor past the last step finishes playback");
assert.equal(activeStepId(state), null, "no active step once finished");
assert.equal(blockedCount(state), 1, "blocked count reflects the plan");
assert.equal(playbackSummary(state), "3 steps · 1 blocked", "finished summary rolls up blockers");
assert.equal(advancePlayback(state).cursor, state.cursor, "advancing a finished playback is a no-op");

const phases = nodePhases(state);
assert.deepEqual(phases, { a: "done", b: "blocked", c: "done" }, "phase map resolves every step");

// --- replay from a recorded run ---
const run: WorkflowRunRecord = {
  id: "r1",
  workflowId: "wf",
  kind: "dry-run",
  status: "plan",
  startedAt: "2026-06-12T00:00:00.000Z",
  source: "cave",
  steps: [
    { id: "a", kind: "agent", status: "succeeded" },
    { id: "b", kind: "agent", status: "failed" },
  ],
};
const replay = playbackFromRun(run);
assert.equal(replay.source, "replay", "replays are labelled as replays");
assert.deepEqual(replay.order, ["a", "b"], "replay order follows the recorded steps");
const replayEnd = advancePlayback(advancePlayback(replay));
assert.equal(nodePhase(replayEnd, "a"), "done", "succeeded replay step resolves to done");
assert.equal(nodePhase(replayEnd, "b"), "blocked", "failed replay step resolves to blocked");

// --- live session run (the session executor) ---
const live = playbackFromPlan(sequential, plan, "play", { sessionId: "abc-123" });
assert.equal(live.live, true, "a live run is flagged live");
assert.equal(live.sessionId, "abc-123", "a live run carries the spawned session id");
assert.equal(live.source, "play", "a live run keeps the play source");
assert.equal(
  playbackSummary(live),
  "3 steps · live",
  "a live run reports scope, not a per-step cursor it can't trust",
);
// Without the live option the run is an ordinary preview (no live flag, no session id).
const preview = playbackFromPlan(sequential, plan, "play");
assert.equal(preview.live, undefined, "a preview run is not flagged live");
assert.equal(preview.sessionId, undefined, "a preview run has no session id");

console.log("workflow-playback.test.ts: ok");
