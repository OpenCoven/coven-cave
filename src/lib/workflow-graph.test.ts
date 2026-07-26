import assert from "node:assert/strict";
import { workflowExecutionOrder } from "./workflow-graph.ts";
import type { WorkflowSummary } from "./workflows.ts";

// No declared dependencies → authored manifest order.
const sequential: WorkflowSummary = {
  id: "release-review",
  version: "1.0.0",
  name: "Release Review",
  pattern: "sequential",
  validation_state: "valid",
  steps: [
    { id: "gate", kind: "human-gate" },
    { id: "review", kind: "agent" },
    { id: "lint", kind: "skill" },
    { id: "brief", kind: "tool" },
  ],
};
assert.deepEqual(
  workflowExecutionOrder(sequential),
  ["gate", "review", "lint", "brief"],
  "no requires → authored order",
);

// Declared dependencies → dependency-depth order (roots first, then dependents),
// keeping manifest order within a depth.
const dependency: WorkflowSummary = {
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
assert.deepEqual(
  workflowExecutionOrder(dependency),
  ["intake", "research", "risk", "synthesize", "brief"],
  "dependents activate after their requirements; parallel steps keep manifest order",
);

// A cyclic requires graph degrades to depth 0 rather than hanging/throwing.
const cyclic: WorkflowSummary = {
  id: "cyclic",
  version: "0.0.1",
  steps: [
    { id: "a", kind: "agent", requires: ["b"] },
    { id: "b", kind: "agent", requires: ["a"] },
  ],
};
// Order within a cycle is degenerate; what matters is it returns every id
// without hanging or throwing.
assert.deepEqual([...workflowExecutionOrder(cyclic)].sort(), ["a", "b"], "cyclic graphs still return every step id");

// Missing steps → a single fallback overview step id (the workflow's own id).
assert.deepEqual(
  workflowExecutionOrder({ id: "empty", version: "0.1.0", validation_state: "unknown" }),
  ["empty"],
  "missing steps yield a single overview node id",
);

console.log("workflow-graph.test.ts: ok");
