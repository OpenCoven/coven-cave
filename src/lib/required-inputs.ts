import { catalogNode, type FlowParamControl, type FlowParamField } from "./flow/flow-catalog.ts";
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
    const def = catalogNode(node.type);
    if (!def) continue;
    for (const field of def.params) {
      if (!requiredFieldApplies(node, field)) continue;
      const value = node.params[field.key];
      if (!isMissingParam(value)) continue;
      missing.push({
        key: `${node.id}.${field.key}`,
        label: `${node.name} ${field.label}`,
        nodeId: node.id,
        nodeName: node.name,
        paramKey: field.key,
        paramLabel: field.label,
        control: field.control,
        placeholder: field.placeholder,
        help: field.help,
      });
    }
  }
  return missing;
}

function requiredFieldApplies(node: FlowNode, field: FlowParamField): boolean {
  if (field.default !== undefined) return false;
  if (node.type === "trigger.schedule" && field.key === "cron") {
    return node.params.mode === "cron";
  }
  return true;
}

function isMissingParam(value: FlowParamValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}
