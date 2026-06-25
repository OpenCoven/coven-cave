import assert from "node:assert/strict";
import {
  finalizeFlowSteps,
  flowPhase,
  phasesFromRunSteps,
  parseFlowRunProgress,
  selectNodeRunData,
} from "./flow-progress.ts";
import type { FlowRunStepRecord } from "../flows.ts";
import type { FlowEdge } from "./flow-doc.ts";

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

// finalizeFlowSteps: persists per-step output detail for later inspection
{
  const runSteps: FlowRunStepRecord[] = [
    { id: "t", type: "trigger.manual", status: "pending" },
    { id: "a", type: "familiar", status: "pending" },
    { id: "b", type: "data.output", status: "pending" },
  ];
  const transcript = [
    "@@step-start t", "trigger payload ready", "@@step-done t",
    "@@step-start a", "researcher found the source set", "@@step-done a",
  ].join("\n");
  const final = finalizeFlowSteps(runSteps, parseFlowRunProgress(transcript, ORDER).steps);

  assert.match(final.steps.find((s) => s.id === "t")?.detail ?? "", /trigger payload/);
  assert.match(final.steps.find((s) => s.id === "a")?.detail ?? "", /source set/);
  assert.equal(final.steps.find((s) => s.id === "b")?.detail, undefined, "skipped nodes do not get fabricated detail");
}

// finalizeFlowSteps: redacted runs keep statuses but do not persist output detail
{
  const runSteps: FlowRunStepRecord[] = [
    { id: "t", type: "trigger.manual", status: "pending", detail: "old trigger payload" },
    { id: "a", type: "familiar", status: "pending", detail: "old agent output" },
  ];
  const transcript = [
    "@@step-start t", "sensitive trigger payload", "@@step-done t",
    "@@step-start a", "sensitive agent output", "@@step-done a",
  ].join("\n");
  const final = finalizeFlowSteps(runSteps, parseFlowRunProgress(transcript, ["t", "a"]).steps, {
    redactDetails: true,
  });

  assert.equal(final.status, "succeeded");
  assert.equal(final.steps.find((s) => s.id === "t")?.status, "succeeded");
  assert.equal(final.steps.find((s) => s.id === "t")?.detail, undefined, "redacted run drops trigger detail");
  assert.equal(final.steps.find((s) => s.id === "a")?.detail, undefined, "redacted run drops node detail");
}

// phasesFromRunSteps: paints inspected historical executions on the canvas
{
  const phases = phasesFromRunSteps([
    { id: "t", type: "trigger.manual", status: "succeeded" },
    { id: "a", type: "familiar", status: "failed" },
    { id: "b", type: "data.output", status: "skipped" },
  ]);
  assert.deepEqual(phases, { t: "succeeded", a: "failed", b: "skipped" });
}

// selectNodeRunData: node output + upstream inputs from the parsed transcript
{
  const transcript = [
    "@@step-start t", "trigger fired", "@@step-done t",
    "@@step-start a", "researcher gathered 3 sources", "@@step-done a",
    "@@step-start b", "writing the summary now",
  ].join("\n");
  const progress = parseFlowRunProgress(transcript, ["t", "a", "b"]);
  const edges: FlowEdge[] = [
    { id: "t->a", source: "t", sourceHandle: "main", target: "a", targetHandle: "in" },
    { id: "a->b", source: "a", sourceHandle: "main", target: "b", targetHandle: "in" },
  ];
  const dataB = selectNodeRunData(edges, progress.steps, "b");
  assert.equal(dataB.status, "running");
  assert.match(dataB.output, /writing the summary/);
  assert.equal(dataB.inputs.length, 1);
  assert.equal(dataB.inputs[0].nodeId, "a");
  assert.match(dataB.inputs[0].detail, /researcher gathered/, "input = upstream node's output");

  const dataT = selectNodeRunData(edges, progress.steps, "t");
  assert.equal(dataT.inputs.length, 0, "a root node has no inputs");
  assert.equal(dataT.status, "succeeded");
}

// selectNodeRunData: historical persisted steps provide node output + inputs
{
  const steps: FlowRunStepRecord[] = [
    { id: "t", type: "trigger.manual", status: "succeeded", detail: "stored trigger payload" },
    { id: "a", type: "familiar", status: "succeeded", detail: "stored research summary" },
    { id: "b", type: "data.output", status: "running", detail: "stored final writeup" },
  ];
  const edges: FlowEdge[] = [
    { id: "t->a", source: "t", sourceHandle: "main", target: "a", targetHandle: "in" },
    { id: "a->b", source: "a", sourceHandle: "main", target: "b", targetHandle: "in" },
  ];
  const dataB = selectNodeRunData(edges, steps, "b");

  assert.equal(dataB.status, "running");
  assert.match(dataB.output, /final writeup/);
  assert.equal(dataB.inputs[0].nodeId, "a");
  assert.match(dataB.inputs[0].detail, /research summary/);
}

console.log("flow-progress.test.ts OK");
