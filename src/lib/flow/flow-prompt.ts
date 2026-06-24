import { createNode } from "./flow-catalog.ts";
import { connect, emptyFlow, type FlowDoc } from "./flow-doc.ts";

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ");
}

export function flowNameFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/)[0] ?? "";
  const normalized = normalizePrompt(firstLine);
  if (!normalized) return "Prompt flow";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function buildPromptFlow(id: string, prompt: string, now: string): FlowDoc {
  const promptText = prompt.trim();
  let flow = emptyFlow(id, flowNameFromPrompt(promptText), now);
  const trigger = createNode(flow, "trigger.manual", { x: 120, y: 160 });
  if (trigger) flow = { ...flow, nodes: [trigger] };
  const familiar = createNode(flow, "familiar", { x: 420, y: 160 });
  if (!familiar) return flow;

  const promptNode = {
    ...familiar,
    params: { ...familiar.params, prompt: promptText },
  };
  flow = { ...flow, nodes: [...flow.nodes, promptNode] };
  return trigger ? connect(flow, trigger.id, "main", promptNode.id, "in") : flow;
}
