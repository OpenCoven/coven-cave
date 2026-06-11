import assert from "node:assert/strict";
import { workflowToGraph, workflowNodeTone } from "./workflow-graph.ts";
import type { WorkflowDryRunPlan, WorkflowSummary } from "./workflows.ts";

const workflow: WorkflowSummary = {
  id: "nova-release-review",
  version: "1.0.0",
  name: "Release Review",
  summary: "Review a release with gate, familiar, validator, and output.",
  familiar: "nova",
  pattern: "sequential",
  validation_state: "valid",
  steps: [
    { id: "gate", kind: "human-gate", name: "Val approval", uses: "valentina" },
    { id: "review", kind: "agent", name: "Nova review", uses: "nova" },
    { id: "lint", kind: "skill", name: "Schema lint", uses: "cwf-validator@^1.0.0" },
    { id: "brief", kind: "tool", name: "Release brief", uses: "cave.output" },
  ],
};

const graph = workflowToGraph(workflow);

assert.equal(graph.nodes.length, 4, "each workflow step becomes a graph node");
assert.equal(graph.edges.length, 3, "sequential workflows connect adjacent steps");
assert.deepEqual(
  graph.edges.map((edge) => `${edge.source}->${edge.target}`),
  ["gate->review", "review->lint", "lint->brief"],
  "steps without requires fall back to adjacent sequential edges",
);
assert.equal(graph.nodes[0].id, "gate", "node IDs use stable step IDs");
assert.equal(graph.nodes[0].type, "workflowStep", "graph nodes use the workflow step renderer type");
assert.equal(graph.nodes[0].data.kind, "human-gate", "node data preserves step kind");
assert.equal(graph.nodes[0].data.tone, "gate", "human gates use gate tone");
assert.equal(graph.nodes[1].position.x > graph.nodes[0].position.x, true, "nodes are laid out left to right");
assert.equal(workflowNodeTone("workflow"), "workflow", "nested workflow nodes get workflow tone");

const dependencyWorkflow: WorkflowSummary = {
  id: "fanout-synthesis",
  version: "1.0.0",
  pattern: "fan-out-and-synthesize",
  steps: [
    { id: "intake", kind: "human-gate" },
    { id: "research", kind: "agent", requires: ["intake"] },
    { id: "risk", kind: "agent", requires: ["intake"] },
    { id: "synthesize", kind: "agent", requires: ["research", "risk"] },
    { id: "brief", kind: "tool", requires: ["synthesize"] },
  ],
};
const dependencyGraph = workflowToGraph(dependencyWorkflow);
assert.deepEqual(
  dependencyGraph.edges.map((edge) => `${edge.source}->${edge.target}`),
  ["intake->research", "intake->risk", "research->synthesize", "risk->synthesize", "synthesize->brief"],
  "steps with requires render manifest dependency edges instead of array-order edges",
);

const dryRun: WorkflowDryRunPlan = {
  ok: true,
  workflowId: "nova-release-review",
  steps: [
    { id: "gate", kind: "human-gate", uses: "valentina", status: "blocked", blockers: [{ code: "gate.waiting", tier: "preflight" }] },
    { id: "review", kind: "agent", uses: "nova", status: "ready" },
  ],
  issues: [],
};
const dryRunGraph = workflowToGraph(workflow, dryRun);
assert.equal(dryRunGraph.nodes[0].data.issues, 1, "step blockers become node issue counts");
assert.equal(dryRunGraph.nodes[0].data.status, "blocked", "blocked dry-run status is preserved");
assert.equal(dryRunGraph.nodes[1].data.status, "ready", "ready dry-run status is preserved");
assert.equal(dryRunGraph.edges.every((edge) => edge.animated), true, "successful dry-runs animate graph edges");

const fallback = workflowToGraph({ id: "empty", version: "0.1.0", validation_state: "unknown" });
assert.equal(fallback.nodes.length, 1, "missing steps render an overview node");
assert.equal(fallback.nodes[0].data.kind, "workflow", "fallback node is a workflow overview");

console.log("workflow-graph.test.ts: ok");
