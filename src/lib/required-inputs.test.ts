import assert from "node:assert/strict";
import { flowMissingRequiredInputs } from "./required-inputs.ts";
import { addNode, emptyFlow, type FlowDoc, type FlowNode } from "./flow/flow-doc.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function inputNode(id: string, value: string, requiredParams: string[] = ["value"]): FlowNode {
  return {
    id,
    type: "input.text",
    name: id,
    position: { x: 0, y: 0 },
    params: { label: "Research topic", value },
    requiredParams,
  };
}

function node(id: string, type: string, params: FlowNode["params"], requiredParams?: string[]): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params, requiredParams };
}

function docWith(...nodes: FlowNode[]): FlowDoc {
  let doc = emptyFlow("f", "F", NOW);
  for (const item of nodes) doc = addNode(doc, item);
  return doc;
}

{
  const missing = flowMissingRequiredInputs(docWith(inputNode("topic", "")));
  assert.equal(missing.length, 1);
  assert.equal(missing[0].key, "topic:value");
  assert.equal(missing[0].label, "Research topic");
  assert.equal(missing[0].control, "textarea");
  assert.equal(missing[0].nodeId, "topic");
  assert.equal(missing[0].paramKey, "value");
  assert.equal(missing[0].paramLabel, "Value");
}

assert.deepEqual(flowMissingRequiredInputs(docWith(inputNode("topic", "LLM agents"))), []);
assert.equal(flowMissingRequiredInputs(docWith(inputNode("topic", "   "))).length, 1);
assert.deepEqual(flowMissingRequiredInputs(docWith(inputNode("topic", "", []))), []);

{
  const item = inputNode("topic", "");
  item.disabled = true;
  assert.deepEqual(flowMissingRequiredInputs(docWith(item)), []);
}

{
  const missing = flowMissingRequiredInputs(docWith(inputNode("a", ""), inputNode("b", "")));
  assert.deepEqual(
    missing.map((item) => item.key).sort(),
    ["a:value", "b:value"],
  );
}

{
  const missing = flowMissingRequiredInputs(
    docWith(node("agent", "familiar", { familiar: "", prompt: "  " }, ["familiar", "prompt"])),
  );
  assert.deepEqual(
    missing.map((input) => ({ key: input.key, nodeId: input.nodeId, paramKey: input.paramKey, label: input.label })),
    [
      { key: "agent:familiar", nodeId: "agent", paramKey: "familiar", label: "agent Familiar" },
      { key: "agent:prompt", nodeId: "agent", paramKey: "prompt", label: "agent Prompt" },
    ],
  );
}

assert.deepEqual(
  flowMissingRequiredInputs(docWith(node("agent", "familiar", { familiar: "", prompt: "  " }))),
  [],
  "nodes without requiredParams should not be prompted",
);

console.log("required-inputs.test.ts: ok");
