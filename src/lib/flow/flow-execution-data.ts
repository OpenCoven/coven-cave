import type { FlowDoc } from "./flow-doc.ts";

export const FLOW_CUSTOM_DATA_MAX_ITEMS = 10;
export const FLOW_CUSTOM_DATA_KEY_MAX = 50;
export const FLOW_CUSTOM_DATA_VALUE_MAX = 512;

export function extractFlowCustomData(doc: FlowDoc): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const node of doc.nodes) {
    if (node.type !== "data.execution") continue;
    const key = stringParam(node.params.key).slice(0, FLOW_CUSTOM_DATA_KEY_MAX);
    const value = stringParam(node.params.value).slice(0, FLOW_CUSTOM_DATA_VALUE_MAX);
    if (!key || !value) continue;
    entries.push([key, value]);
    if (entries.length >= FLOW_CUSTOM_DATA_MAX_ITEMS) break;
  }
  return Object.fromEntries(entries);
}

function stringParam(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
