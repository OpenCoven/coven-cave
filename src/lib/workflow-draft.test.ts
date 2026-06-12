import assert from "node:assert/strict";
import {
  initialWorkflowDraft,
  workflowDraftReducer,
  wouldCreateCycle,
  type WorkflowDraftState,
} from "./workflow-draft.ts";
import type { WorkflowSummary } from "./workflows.ts";

const base: WorkflowSummary = {
  id: "demo",
  version: "0.1.0",
  steps: [
    { id: "plan", kind: "agent", name: "Plan" },
    { id: "execute", kind: "agent", name: "Execute", requires: ["plan"] },
  ],
};

function fresh(): WorkflowDraftState {
  return initialWorkflowDraft(base);
}

// --- reset / initial ---
let state = fresh();
assert.equal(state.dirty, false, "fresh draft is clean");
assert.equal(state.past.length, 0);
assert.notEqual(state.draft.steps, base.steps, "draft deep-copies the source workflow");

// --- add-step: unique generated ids ---
state = workflowDraftReducer(state, { type: "add-step", kind: "human-gate" });
state = workflowDraftReducer(state, { type: "add-step", kind: "agent" });
const ids = (state.draft.steps ?? []).map((s) => s.id);
assert.equal(new Set(ids).size, ids.length, "generated step ids are unique");
assert.equal(state.draft.steps?.[2]?.kind, "human-gate");
assert.equal(state.dirty, true, "edits mark the draft dirty");

// --- update-step: plain field patch ---
state = workflowDraftReducer(state, { type: "update-step", id: "plan", patch: { name: "Plan it" } });
assert.equal(state.draft.steps?.[0]?.name, "Plan it");

// --- update-step: id rename rewrites requires references ---
state = workflowDraftReducer(state, { type: "update-step", id: "plan", patch: { id: "scope" } });
assert.equal(state.draft.steps?.[0]?.id, "scope");
assert.deepEqual(state.draft.steps?.[1]?.requires, ["scope"], "rename rewrites dependents' requires");

// --- update-step: rename to a colliding id is rejected (no-op) ---
const beforeCollision = state;
state = workflowDraftReducer(state, { type: "update-step", id: "scope", patch: { id: "execute" } });
assert.equal(state, beforeCollision, "colliding id rename is a no-op");

// --- connect ---
const gateId = (state.draft.steps ?? [])[2].id;
state = workflowDraftReducer(state, { type: "connect", source: "execute", target: gateId });
assert.deepEqual(state.draft.steps?.[2]?.requires, ["execute"]);

const beforeDup = state;
state = workflowDraftReducer(state, { type: "connect", source: "execute", target: gateId });
assert.equal(state, beforeDup, "duplicate connect is a no-op");
state = workflowDraftReducer(state, { type: "connect", source: gateId, target: gateId });
assert.equal(state, beforeDup, "self connect is a no-op");

// --- cycle guard ---
assert.equal(wouldCreateCycle(state.draft.steps ?? [], gateId, "scope"), true, "gate→scope would close a cycle");
assert.equal(wouldCreateCycle(state.draft.steps ?? [], "scope", gateId), false);
state = workflowDraftReducer(state, { type: "connect", source: gateId, target: "scope" });
assert.equal(state, beforeDup, "cycle-creating connect is a no-op");

// --- disconnect ---
state = workflowDraftReducer(state, { type: "disconnect", source: "execute", target: gateId });
assert.deepEqual(state.draft.steps?.[2]?.requires ?? [], [], "disconnect removes the dependency");

// --- remove-step strips dangling requires ---
state = workflowDraftReducer(state, { type: "remove-step", id: "scope" });
assert.equal(state.draft.steps?.some((s) => s.id === "scope"), false);
assert.equal(
  state.draft.steps?.some((s) => (s.requires ?? []).includes("scope")),
  false,
  "no step keeps a requires reference to the removed step",
);

// --- update-meta ---
state = workflowDraftReducer(state, { type: "update-meta", patch: { name: "Demo flow", pattern: "sequential" } });
assert.equal(state.draft.name, "Demo flow");
assert.equal(state.draft.pattern, "sequential");

// --- undo / redo ---
const beforeUndo = structuredClone(state.draft);
state = workflowDraftReducer(state, { type: "undo" });
assert.equal(state.draft.name, undefined, "undo reverts the meta patch");
state = workflowDraftReducer(state, { type: "redo" });
assert.deepEqual(state.draft, beforeUndo, "redo restores the undone state");

const noFuture = workflowDraftReducer(state, { type: "redo" });
assert.equal(noFuture, state, "redo with no future is a no-op");

// --- new edit clears the future stack ---
state = workflowDraftReducer(state, { type: "undo" });
state = workflowDraftReducer(state, { type: "update-meta", patch: { summary: "fresh branch" } });
assert.equal(state.future.length, 0, "a new edit invalidates the redo stack");

// --- reset returns clean state ---
state = workflowDraftReducer(state, { type: "reset", workflow: base });
assert.equal(state.dirty, false);
assert.equal(state.past.length, 0);
assert.equal(state.future.length, 0);

// --- history cap ---
state = fresh();
for (let i = 0; i < 60; i += 1) {
  state = workflowDraftReducer(state, { type: "update-meta", patch: { summary: `edit ${i}` } });
}
assert.ok(state.past.length <= 50, `history is capped (got ${state.past.length})`);

console.log("workflow-draft.test.ts: ok");
