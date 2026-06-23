// @ts-nocheck
import assert from "node:assert/strict";
import { parseWorkflowStepProgress } from "./workflow-step-progress.ts";

const ORDER = ["gather", "draft", "review", "publish"];

// 1. No markers at all → everything pending, markersFound false (UI falls back).
{
  const r = parseWorkflowStepProgress("just some prose, no markers here", ORDER);
  assert.equal(r.markersFound, false, "no markers detected");
  assert.deepEqual(r.steps.map((s) => s.status), ["pending", "pending", "pending", "pending"]);
  assert.equal(r.activeStepId, null);
  assert.equal(r.done, false);
}

// 2. Mid-run: first done, second active.
{
  const t = [
    "@@step-start gather",
    "pulled 12 sources from the repo",
    "@@step-done gather",
    "@@step-start draft",
    "writing the first pass now…",
  ].join("\n");
  const r = parseWorkflowStepProgress(t, ORDER);
  assert.equal(r.markersFound, true);
  assert.deepEqual(r.steps.map((s) => s.status), ["succeeded", "active", "pending", "pending"]);
  assert.equal(r.activeStepId, "draft");
  assert.equal(r.done, false);
  assert.match(r.steps[0].detail, /pulled 12 sources/, "gather captures its narration");
  assert.match(r.steps[1].detail, /writing the first pass/, "draft captures its in-progress narration");
}

// 3. Full success → all succeeded, done true, no active.
{
  const t = ORDER.flatMap((id) => [`@@step-start ${id}`, `did ${id}`, `@@step-done ${id}`]).join("\n");
  const r = parseWorkflowStepProgress(t, ORDER);
  assert.deepEqual(r.steps.map((s) => s.status), ["succeeded", "succeeded", "succeeded", "succeeded"]);
  assert.equal(r.activeStepId, null);
  assert.equal(r.done, true);
}

// 4. Failure is terminal for that step.
{
  const t = [
    "@@step-start gather", "ok", "@@step-done gather",
    "@@step-start draft", "couldn't reach the API", "@@step-fail draft",
  ].join("\n");
  const r = parseWorkflowStepProgress(t, ORDER);
  assert.equal(r.steps[1].status, "failed");
  assert.match(r.steps[1].detail, /couldn't reach the API/);
  assert.equal(r.activeStepId, null, "a failed (not running) step isn't active");
}

// 5. Implicit succession: a step that started but the agent moved on without a
//    @@step-done is treated as succeeded, not stuck-active.
{
  const t = [
    "@@step-start gather", "forgot to close this one",
    "@@step-start draft", "moved straight on",
  ].join("\n");
  const r = parseWorkflowStepProgress(t, ORDER);
  assert.equal(r.steps[0].status, "succeeded", "superseded start is implicitly succeeded");
  assert.equal(r.steps[1].status, "active", "latest open start is active");
  assert.equal(r.activeStepId, "draft");
}

// 6. Unknown ids the agent invents (or echoes from the prompt) are ignored.
{
  const t = ["@@step-start bogus", "noise", "@@step-start gather", "real work"].join("\n");
  const r = parseWorkflowStepProgress(t, ORDER);
  assert.equal(r.activeStepId, "gather");
  assert.equal(r.steps.find((s) => s.id === "gather").status, "active");
}

// 7. Markers must be on their own line (won't match mid-sentence prose).
{
  const r = parseWorkflowStepProgress("we will @@step-start gather when ready", ORDER);
  assert.equal(r.markersFound, false, "inline mention is not a marker");
}

console.log("workflow-step-progress.test.ts: ok");
