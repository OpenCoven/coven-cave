// Compile a FlowDoc into an execution plan + an orchestration prompt.
//
// The Flow editor has no native step engine; like the Workflow Studio it runs
// a flow by spawning ONE capable agent session whose prompt describes the graph
// and asks it to print `@@step-start/done/fail <id>` markers as it works. The
// Executions tab then parses those markers back into per-node progress
// (reusing workflow-step-progress.ts). This module is the pure compiler.

import { catalogNode } from "./flow-catalog.ts";
import type { FlowDoc, FlowNode } from "./flow-doc.ts";

/**
 * Node ids in run order: a topological sort from the trigger(s) following
 * edges. Cycles (Loop nodes) degrade gracefully — any node not yet emitted
 * when the queue drains is appended in declared order so nothing is dropped.
 * Sticky notes are never executable and are excluded.
 */
export function flowExecutionOrder(doc: FlowDoc): string[] {
  const nodes = doc.nodes.filter((node) => !isSticky(node));
  const ids = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  for (const node of nodes) indegree.set(node.id, 0);
  for (const edge of doc.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  // Seed with roots (triggers / no incoming), preserving declared order.
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const order: string[] = [];
  const emitted = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (emitted.has(id)) continue;
    emitted.add(id);
    order.push(id);
    for (const edge of doc.edges) {
      if (edge.source !== id || !ids.has(edge.target) || emitted.has(edge.target)) continue;
      const left = (indegree.get(edge.target) ?? 1) - 1;
      indegree.set(edge.target, left);
      if (left <= 0) queue.push(edge.target);
    }
  }
  // Anything stuck in a cycle: append in declared order.
  for (const node of nodes) if (!emitted.has(node.id)) order.push(node.id);
  return order;
}

export type FlowRunBlock = { ok: boolean; reason?: string };

/** A flow needs at least one trigger and one downstream node to be runnable. */
export function flowRunBlockReason(doc: FlowDoc): FlowRunBlock {
  const executable = doc.nodes.filter((node) => !isSticky(node));
  if (executable.length === 0) return { ok: false, reason: "Add a trigger and at least one step." };
  const hasTrigger = executable.some((node) => catalogNode(node.type)?.isTrigger);
  if (!hasTrigger) return { ok: false, reason: "Add a trigger node to start the flow." };
  if (executable.length < 2) return { ok: false, reason: "Add a step after the trigger." };
  return { ok: true };
}

function isSticky(node: FlowNode): boolean {
  return Boolean(node.sticky) || catalogNode(node.type)?.sticky === true;
}

function describeParams(node: FlowNode): string {
  const def = catalogNode(node.type);
  if (!def || def.params.length === 0) return "";
  const parts: string[] = [];
  for (const field of def.params) {
    const value = node.params[field.key];
    if (value === undefined || value === "" || value === null) continue;
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, 120) : String(value);
    parts.push(`${field.label}: ${text}`);
  }
  return parts.join("; ");
}

/**
 * Compile the flow into an orchestration prompt. Lists nodes in execution
 * order with their type, configured parameters, and downstream targets, then
 * states the marker protocol the Executions parser relies on.
 */
export function compileFlowPrompt(doc: FlowDoc): string {
  const order = flowExecutionOrder(doc);
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const lines: string[] = [];
  lines.push(`You are executing the automation flow "${doc.name}".`);
  lines.push("");
  lines.push(
    "Carry out each node below in order, passing the result of one node as the input to the nodes it connects to. " +
      "Before you start a node print a line `@@step-start <id>`; when it succeeds print `@@step-done <id>`; if it " +
      "fails print `@@step-fail <id>`. Use the exact node id shown in brackets.",
  );
  lines.push("");
  lines.push("Nodes:");
  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const def = catalogNode(node.type);
    const targets = doc.edges
      .filter((edge) => edge.source === id)
      .map((edge) => `${edge.target}${edge.sourceHandle !== "main" ? ` (via ${edge.sourceHandle})` : ""}`);
    const params = describeParams(node);
    const disabled = node.disabled ? " [disabled — skip]" : "";
    lines.push(
      `- [${id}] ${node.name} — ${def?.label ?? node.type}${disabled}` +
        (params ? `\n    config: ${params}` : "") +
        (targets.length ? `\n    then → ${targets.join(", ")}` : ""),
    );
  }
  lines.push("");
  lines.push("When every node is done, print a one-line summary of what the flow accomplished.");
  return lines.join("\n");
}
