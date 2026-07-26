import assert from "node:assert/strict";
import { extractFlowCustomData } from "./flow-execution-data.ts";
import { addNode, emptyFlow, type FlowDoc, type FlowNode } from "./flow-doc.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function node(id: string, type: string, params: FlowNode["params"]): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params };
}

let doc: FlowDoc = emptyFlow("flow", "Flow", NOW);
doc = addNode(doc, node("trigger", "trigger.manual", {}));
doc = addNode(doc, node("priority", "data.execution", { key: "priority", value: "critical" }));
doc = addNode(doc, node("customer", "data.execution", { key: "customer", value: "OpenCoven" }));
doc = addNode(doc, node("blank", "data.execution", { key: "  ", value: "ignored" }));
doc = addNode(doc, node("not-custom", "data.set", { fields: "{\"priority\":\"low\"}" }));

assert.deepEqual(
  extractFlowCustomData(doc),
  { priority: "critical", customer: "OpenCoven" },
  "Execution Data nodes become saved custom execution data",
);

assert.deepEqual(
  extractFlowCustomData({
    ...doc,
    nodes: [node("long", "data.execution", { key: "x".repeat(80), value: "v".repeat(700) })],
  }),
  { ["x".repeat(50)]: "v".repeat(512) },
  "custom execution data is clamped to n8n-style storage limits",
);

console.log("flow-execution-data.test.ts OK");
