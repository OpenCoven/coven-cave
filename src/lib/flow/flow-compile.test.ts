import assert from "node:assert/strict";
import { compileFlowPrompt, flowExecutionOrder, flowRunBlockReason } from "./flow-compile.ts";
import { addNode, connect, emptyFlow, type FlowDoc, type FlowNode } from "./flow-doc.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function n(id: string, type: string): FlowNode {
  const base: FlowNode = { id, type, name: id, position: { x: 0, y: 0 }, params: {} };
  if (type === "sticky") base.sticky = { text: "", color: "yellow", width: 240, height: 160 };
  return base;
}
function build(nodes: Array<[string, string]>, edges: Array<[string, string]>): FlowDoc {
  let doc = emptyFlow("f", "F", NOW);
  for (const [id, type] of nodes) doc = addNode(doc, n(id, type));
  for (const [s, t] of edges) doc = connect(doc, s, "main", t, "in");
  return doc;
}

// flowExecutionOrder: topological from trigger
{
  const doc = build(
    [["trigger", "trigger.manual"], ["a", "familiar"], ["b", "data.output"]],
    [["trigger", "a"], ["a", "b"]],
  );
  assert.deepEqual(flowExecutionOrder(doc), ["trigger", "a", "b"]);
}

// cycle: nothing dropped
{
  const doc = build(
    [["t", "trigger.manual"], ["a", "familiar"], ["b", "familiar"]],
    [["t", "a"], ["a", "b"], ["b", "a"]],
  );
  const order = flowExecutionOrder(doc);
  assert.equal(order.length, 3, "every node still emitted despite the cycle");
  assert.equal(order[0], "t");
}

// sticky notes excluded from execution order
{
  const doc = build([["t", "trigger.manual"], ["note", "sticky"]], []);
  assert.ok(!flowExecutionOrder(doc).includes("note"), "sticky note is not executable");
}

// run block reasons
{
  assert.equal(flowRunBlockReason(build([], [])).ok, false, "empty flow blocked");
  assert.equal(flowRunBlockReason(build([["a", "familiar"]], [])).ok, false, "no trigger blocked");
  assert.equal(
    flowRunBlockReason(build([["t", "trigger.manual"], ["a", "familiar"]], [])).ok,
    true,
    "trigger + step runnable",
  );
}

// compileFlowPrompt: includes marker protocol + node ids in order
{
  const doc = build([["t", "trigger.manual"], ["writer", "familiar"]], [["t", "writer"]]);
  const prompt = compileFlowPrompt(doc);
  assert.match(prompt, /@@step-start <id>/);
  assert.match(prompt, /@@step-done <id>/);
  assert.match(prompt, /\[t\]/);
  assert.match(prompt, /\[writer\]/);
  assert.ok(prompt.indexOf("[t]") < prompt.indexOf("[writer]"), "nodes listed in execution order");
}

console.log("flow-compile.test.ts OK");
