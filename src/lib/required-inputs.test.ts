import assert from "node:assert/strict";
import { flowMissingRequiredInputs } from "./required-inputs.ts";
import type { FlowDoc, FlowNode } from "./flow/flow-doc.ts";

function node(id: string, type: string, params: FlowNode["params"]): FlowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, params };
}

function doc(nodes: FlowNode[]): FlowDoc {
  return {
    id: "flow",
    name: "Flow",
    active: false,
    nodes,
    edges: [],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    schema: 1,
  };
}

assert.deepEqual(
  flowMissingRequiredInputs(
    doc([
      node("manual", "trigger.manual", {}),
      node("agent", "familiar", { familiar: "", prompt: "  " }),
      node("http", "http", { method: "GET", url: "https://example.com", headers: "{}", body: "{}" }),
    ]),
  ).map((input) => ({
    key: input.key,
    nodeId: input.nodeId,
    paramKey: input.paramKey,
    label: input.label,
  })),
  [
    { key: "agent.familiar", nodeId: "agent", paramKey: "familiar", label: "agent Familiar" },
    { key: "agent.prompt", nodeId: "agent", paramKey: "prompt", label: "agent Prompt" },
  ],
  "missing required flow params should be returned with stable keys and node labels",
);

assert.deepEqual(
  flowMissingRequiredInputs(
    doc([
      node("schedule", "trigger.schedule", { mode: "interval", everyMinutes: 30 }),
      node("cron", "trigger.schedule", { mode: "cron", everyMinutes: 30, cron: "" }),
    ]),
  ).map((input) => input.key),
  ["cron.cron"],
  "cron expression should only be required when the schedule trigger is in cron mode",
);

console.log("required-inputs.test.ts: ok");
