import assert from "node:assert/strict";
import { finalizeFlowSteps, flowPhase, parseFlowRunProgress } from "./flow-progress.ts";
import type { FlowRunStepRecord } from "../flows.ts";

// flowPhase mapping
{
  assert.equal(flowPhase("active"), "running");
  assert.equal(flowPhase("pending"), "pending");
  assert.equal(flowPhase("succeeded"), "succeeded");
  assert.equal(flowPhase("failed"), "failed");
}

const ORDER = ["t", "a", "b"];

// mid-run: t done, a running, b pending
{
  const transcript = ["@@step-start t", "...did t...", "@@step-done t", "@@step-start a", "...working on a..."].join("\n");
  const p = parseFlowRunProgress(transcript, ORDER);
  assert.equal(p.phases.t, "succeeded");
  assert.equal(p.phases.a, "running");
  assert.equal(p.phases.b, "pending");
  assert.equal(p.activeNodeId, "a");
  assert.equal(p.done, false);
  assert.equal(p.markersFound, true);
}

// complete run with a failure
{
  const transcript = [
    "@@step-start t",
    "@@step-done t",
    "@@step-start a",
    "@@step-done a",
    "@@step-start b",
    "@@step-fail b",
  ].join("\n");
  const p = parseFlowRunProgress(transcript, ORDER);
  assert.equal(p.done, true);
  assert.equal(p.phases.b, "failed");
  assert.equal(p.activeNodeId, null);
}

// no markers → all pending, not done
{
  const p = parseFlowRunProgress("the agent rambled without markers", ORDER);
  assert.equal(p.markersFound, false);
  assert.equal(p.done, false);
  assert.deepEqual(Object.values(p.phases), ["pending", "pending", "pending"]);
}

// finalizeFlowSteps: preserves type, maps statuses, overall verdict
{
  const runSteps: FlowRunStepRecord[] = [
    { id: "t", type: "trigger.manual", status: "pending" },
    { id: "a", type: "familiar", status: "pending" },
    { id: "b", type: "data.output", status: "pending" },
  ];
  const transcript = ["@@step-start t", "@@step-done t", "@@step-start a", "@@step-done a"].join("\n");
  const progress = parseFlowRunProgress(transcript, ORDER);
  const final = finalizeFlowSteps(runSteps, progress.steps);
  assert.equal(final.steps.find((s) => s.id === "t")?.status, "succeeded");
  assert.equal(final.steps.find((s) => s.id === "t")?.type, "trigger.manual", "type preserved");
  assert.equal(final.steps.find((s) => s.id === "b")?.status, "skipped", "never-started → skipped");
  assert.equal(final.status, "succeeded");

  const failTranscript = ["@@step-start t", "@@step-fail t"].join("\n");
  const failProgress = parseFlowRunProgress(failTranscript, ORDER);
  assert.equal(finalizeFlowSteps(runSteps, failProgress.steps).status, "failed");
}

console.log("flow-progress.test.ts OK");
