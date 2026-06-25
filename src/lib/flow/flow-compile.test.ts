import assert from "node:assert/strict";
import { compileFlowPrompt, flowExecutionOrder, flowPartialExecutionOrder, flowRunBlockReason } from "./flow-compile.ts";
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

// branch execution follows n8n v1 canvas order: complete the top branch before
// lower branches, even when edges were created in a different order.
{
  const base = build(
    [
      ["t", "trigger.manual"],
      ["lower", "familiar"],
      ["lowerOut", "data.output"],
      ["upper", "familiar"],
      ["upperOut", "data.output"],
    ],
    [["t", "lower"], ["t", "upper"], ["lower", "lowerOut"], ["upper", "upperOut"]],
  );
  const doc = {
    ...base,
    nodes: base.nodes.map((node) => {
      const positions: Record<string, FlowNode["position"]> = {
        t: { x: 0, y: 0 },
        lower: { x: 240, y: 320 },
        lowerOut: { x: 480, y: 320 },
        upper: { x: 240, y: 120 },
        upperOut: { x: 480, y: 120 },
      };
      return { ...node, position: positions[node.id] ?? node.position };
    }),
  };
  assert.deepEqual(flowExecutionOrder(doc), ["t", "upper", "upperOut", "lower", "lowerOut"]);
}

// partial execution: target node runs with only the trigger/upstream path it needs
{
  const doc = build(
    [
      ["t", "trigger.manual"],
      ["prep", "familiar"],
      ["target", "familiar"],
      ["sibling", "familiar"],
      ["after", "data.output"],
    ],
    [["t", "prep"], ["prep", "target"], ["prep", "sibling"], ["target", "after"]],
  );
  assert.deepEqual(flowPartialExecutionOrder(doc, "target"), ["t", "prep", "target"]);
  const prompt = compileFlowPrompt(doc, { targetNodeId: "target" });
  assert.match(prompt, /partial execution/i);
  assert.match(prompt, /\[target\]/);
  assert.doesNotMatch(prompt, /\[sibling\]/, "unneeded sibling branches are not executed");
  assert.doesNotMatch(prompt, /\[after\]/, "downstream nodes after the target are not executed");
}

// sticky notes excluded from execution order
{
  const doc = build([["t", "trigger.manual"], ["note", "sticky"]], []);
  assert.ok(!flowExecutionOrder(doc).includes("note"), "sticky note is not executable");
}

// disabled nodes are skipped by execution order, so run records do not wait on
// marker lines the agent was told not to emit.
{
  const base = build(
    [["t", "trigger.manual"], ["disabled", "familiar"], ["out", "data.output"]],
    [["t", "disabled"], ["disabled", "out"]],
  );
  const doc = {
    ...base,
    nodes: base.nodes.map((node) => (node.id === "disabled" ? { ...node, disabled: true } : node)),
  };
  assert.deepEqual(flowExecutionOrder(doc), ["t", "out"]);
  const prompt = compileFlowPrompt(doc);
  assert.doesNotMatch(prompt, /\[disabled\]/, "disabled node is not listed in the prompt");
  assert.match(prompt, /then → out/, "disabled node is bypassed so its downstream target still runs");
}

// pinned data substitutes a node's output during manual runs instead of asking
// the agent to perform that node's external work again.
{
  const base = build(
    [["t", "trigger.manual"], ["api", "http"], ["out", "data.output"]],
    [["t", "api"], ["api", "out"]],
  );
  const doc = {
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === "api" ? { ...node, pinnedData: '{"items":[{"id":42}]}' } : node,
    ),
  };
  const prompt = compileFlowPrompt(doc);
  assert.match(prompt, /\[api\]/, "pinned node remains in the execution graph");
  assert.match(prompt, /Pinned output/, "prompt calls out pinned output");
  assert.match(prompt, /do not call external services/i, "pinned node should not repeat external work");
  assert.match(prompt, /"id":42/, "pinned payload is supplied to downstream nodes");
}

// production executions ignore pinned development data.
{
  const base = build(
    [["hook", "trigger.webhook"], ["api", "http"], ["out", "data.output"]],
    [["hook", "api"], ["api", "out"]],
  );
  const doc = {
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === "api" ? { ...node, pinnedData: '{"devOnly":true}' } : node,
    ),
  };
  const prompt = compileFlowPrompt(doc, {
    mode: "production",
    triggerInput: { source: "webhook", method: "POST", path: "/deploy", body: { ok: true } },
  });
  assert.match(prompt, /\[api\]/, "production still executes the pinned node");
  assert.doesNotMatch(prompt, /Pinned output/, "production prompt must not mention pinned output");
  assert.doesNotMatch(prompt, /devOnly/, "production prompt must not leak pinned development data");
}

// webhook/production executions include the incoming request data as the
// trigger node's starting output, so downstream nodes can act on it.
{
  const doc = build(
    [["hook", "trigger.webhook"], ["writer", "familiar"]],
    [["hook", "writer"]],
  );
  const prompt = compileFlowPrompt(doc, {
    triggerInput: {
      source: "webhook",
      method: "POST",
      path: "/deploy",
      query: { ref: "main" },
      body: { action: "published" },
    },
  });
  assert.match(prompt, /Trigger input/);
  assert.match(prompt, /"method":"POST"/);
  assert.match(prompt, /"path":"\/deploy"/);
  assert.match(prompt, /"action":"published"/);
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
  const onlyDisabledStep = build([["t", "trigger.manual"], ["a", "familiar"]], [["t", "a"]]);
  onlyDisabledStep.nodes = onlyDisabledStep.nodes.map((node) =>
    node.id === "a" ? { ...node, disabled: true } : node,
  );
  assert.equal(flowRunBlockReason(onlyDisabledStep).ok, false, "disabled steps do not make a flow runnable");
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
