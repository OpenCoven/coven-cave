import { catalogNode, type FlowParamControl } from "./flow/flow-catalog.ts";
import type { FlowDoc, FlowNode, FlowParamValue } from "./flow/flow-doc.ts";

export type RequiredInput = {
  key: string;
  label: string;
  nodeId: string;
  nodeName: string;
  paramKey: string;
  paramLabel: string;
  control: FlowParamControl;
  placeholder?: string;
  help?: string;
};

export function flowMissingRequiredInputs(doc: FlowDoc): RequiredInput[] {
  const missing: RequiredInput[] = [];
  for (const node of doc.nodes) {
    if (node.disabled || node.sticky) continue;
    const requiredParams = node.requiredParams ?? [];
    if (requiredParams.length === 0) continue;
    const def = catalogNode(node.type);
    for (const paramKey of requiredParams) {
      const value = node.params[paramKey];
      if (!isMissingParam(value)) continue;
      const field = def?.params.find((candidate) => candidate.key === paramKey);
      const paramLabel = field?.label ?? paramKey;
      missing.push({
        key: `${node.id}:${paramKey}`,
        label: requiredInputLabel(node, paramKey, paramLabel),
        nodeId: node.id,
        nodeName: node.name,
        paramKey,
        paramLabel,
        control: field?.control ?? "text",
        placeholder: field?.placeholder,
        help: field?.help,
      });
    }
  }
  return missing;
}

function requiredInputLabel(node: FlowNode, paramKey: string, paramLabel: string): string {
  if (node.type === "input.text" && paramKey === "value") {
    const label = node.params.label;
    if (typeof label === "string" && label.trim().length > 0) return label.trim();
  }
  return `${node.name} ${paramLabel}`;
}

function isMissingParam(value: FlowParamValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}
