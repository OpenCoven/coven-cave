// Compile a FlowDoc into an execution plan + an orchestration prompt.
//
// The Flow editor has no native step engine; like the Workflow Studio it runs
// a flow by spawning ONE capable agent session whose prompt describes the graph
// and asks it to print `@@step-start/done/fail <id>` markers as it works. The
// Executions tab then parses those markers back into per-node progress
// (reusing workflow-step-progress.ts). This module is the pure compiler.

import { catalogNode } from "./flow-catalog.ts";
import type { FlowDoc, FlowNode } from "./flow-doc.ts";

export type FlowTriggerInput = {
  source: "manual" | "webhook" | "schedule" | "chat";
  method?: string;
  path?: string;
  query?: Record<string, string>;
  body?: unknown;
};

export type FlowExecutionMode = "manual" | "production";

/**
 * Node ids in run order: a topological sort from the trigger(s) following
 * edges. Cycles (Loop nodes) degrade gracefully — any node not yet emitted
 * when the queue drains is appended in declared order so nothing is dropped.
 * Sticky notes are never executable and are excluded.
 */
export function flowExecutionOrder(doc: FlowDoc): string[] {
  const nodes = sortNodesByCanvasPosition(doc, doc.nodes.filter(isExecutable));
  const ids = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  for (const node of nodes) indegree.set(node.id, 0);
  for (const source of nodes) {
    for (const target of executableTargets(doc, source.id)) {
      if (!ids.has(target)) continue;
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  const order: string[] = [];
  const emitted = new Set<string>();

  const visit = (id: string) => {
    if (emitted.has(id)) return;
    emitted.add(id);
    order.push(id);
    for (const target of sortIdsByCanvasPosition(doc, executableTargets(doc, id))) {
      if (!ids.has(target) || emitted.has(target)) continue;
      const left = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, left);
      if (left <= 0) visit(target);
    }
  };

  // Seed with roots (triggers / no incoming), following visible canvas order.
  for (const node of nodes) {
    if ((indegree.get(node.id) ?? 0) === 0) visit(node.id);
  }
  // Anything stuck in a cycle: append in deterministic canvas order.
  for (const node of nodes) if (!emitted.has(node.id)) order.push(node.id);
  return order;
}

/**
 * Node ids for an n8n-style partial execution: run the selected node plus the
 * executable upstream path needed to provide its input data, but do not continue
 * into sibling or downstream branches.
 */
export function flowPartialExecutionOrder(doc: FlowDoc, targetNodeId: string): string[] {
  const target = doc.nodes.find((node) => node.id === targetNodeId);
  if (!target || !isExecutable(target)) return [];
  const parents = new Map<string, Set<string>>();
  for (const source of doc.nodes.filter(isExecutable)) {
    for (const targetId of executableTargets(doc, source.id)) {
      const set = parents.get(targetId) ?? new Set<string>();
      set.add(source.id);
      parents.set(targetId, set);
    }
  }
  const needed = new Set<string>();
  const visit = (id: string) => {
    if (needed.has(id)) return;
    needed.add(id);
    for (const parent of parents.get(id) ?? []) visit(parent);
  };
  visit(targetNodeId);
  return flowExecutionOrder(doc).filter((id) => needed.has(id));
}

export type FlowRunBlock = { ok: boolean; reason?: string };

/** A flow needs at least one trigger and one downstream node to be runnable. */
export function flowRunBlockReason(doc: FlowDoc, targetNodeId?: string): FlowRunBlock {
  const executable = doc.nodes.filter(isExecutable);
  if (executable.length === 0) return { ok: false, reason: "Add a trigger and at least one step." };
  const hasTrigger = executable.some((node) => catalogNode(node.type)?.isTrigger);
  if (!hasTrigger) return { ok: false, reason: "Add a trigger node to start the flow." };
  if (targetNodeId) {
    const order = flowPartialExecutionOrder(doc, targetNodeId);
    if (order.length === 0) return { ok: false, reason: "Choose an executable node to run." };
    if (!order.some((id) => catalogNode(doc.nodes.find((node) => node.id === id)?.type ?? "")?.isTrigger)) {
      return { ok: false, reason: "Connect this node to a trigger before running it." };
    }
    return { ok: true };
  }
  if (executable.length < 2) return { ok: false, reason: "Add a step after the trigger." };
  return { ok: true };
}

export function flowPublishBlockReason(doc: FlowDoc): FlowRunBlock {
  const productionTriggers = doc.nodes.filter((node) =>
    isExecutable(node) &&
    catalogNode(node.type)?.isTrigger === true &&
    node.type !== "trigger.manual"
  );
  if (productionTriggers.length === 0) {
    return { ok: false, reason: "Add a webhook, schedule, or chat trigger before publishing." };
  }
  if (!productionTriggers.some((node) => executableTargets(doc, node.id).length > 0)) {
    return { ok: false, reason: "Add a step after the production trigger." };
  }
  return { ok: true };
}

function isSticky(node: FlowNode): boolean {
  return Boolean(node.sticky) || catalogNode(node.type)?.sticky === true;
}

function isExecutable(node: FlowNode): boolean {
  return !node.disabled && !isSticky(node);
}

function sortNodesByCanvasPosition(doc: FlowDoc, nodes: FlowNode[]): FlowNode[] {
  const index = new Map(doc.nodes.map((node, i) => [node.id, i]));
  return [...nodes].sort(
    (a, b) =>
      a.position.y - b.position.y ||
      a.position.x - b.position.x ||
      (index.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (index.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function sortIdsByCanvasPosition(doc: FlowDoc, ids: string[]): string[] {
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
  return sortNodesByCanvasPosition(
    doc,
    ids.map((id) => nodeById.get(id)).filter((node): node is FlowNode => Boolean(node)),
  ).map((node) => node.id);
}

function executableTargets(doc: FlowDoc, sourceId: string, seen = new Set<string>()): string[] {
  if (seen.has(sourceId)) return [];
  seen.add(sourceId);
  const targets: string[] = [];
  for (const edge of doc.edges) {
    if (edge.source !== sourceId) continue;
    const target = doc.nodes.find((node) => node.id === edge.target);
    if (!target) continue;
    if (isExecutable(target)) {
      targets.push(target.id);
    } else if (target.disabled) {
      targets.push(...executableTargets(doc, target.id, seen));
    }
  }
  return Array.from(new Set(targets));
}

function describeParams(node: FlowNode): string {
  const def = catalogNode(node.type);
  if (!def || def.params.length === 0) return "";
  const fixedParts: string[] = [];
  const expressionParts: string[] = [];
  const instructionParts: string[] = [];
  for (const field of def.params) {
    const value = node.params[field.key];
    if (value === undefined || value === "" || value === null) continue;
    if (node.type === "familiar" && field.key === "prompt" && typeof value === "string") {
      // Familiar prompts are executable instructions, not card summaries. A
      // 120-character preview silently changes the requested work and can drop
      // required output contracts. Keep the complete bounded instruction block
      // while preserving line breaks used by exact marker protocols.
      instructionParts.push(`${field.label}:\n${value.trim().slice(0, 32_000)}`);
      continue;
    }
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, 120) : String(value);
    if (isExpressionParam(value)) expressionParts.push(`${field.label}: ${text}`);
    else fixedParts.push(`${field.label}: ${text}`);
  }
  const sections: string[] = [];
  if (fixedParts.length) sections.push(`config: ${fixedParts.join("; ")}`);
  if (expressionParts.length) {
    sections.push([
      `Expression parameters: ${expressionParts.join("; ")}`,
      "Evaluate these n8n-style expressions against the incoming item data before running this node.",
    ].join("\n    "));
  }
  sections.push(...instructionParts);
  return sections.join("\n    ");
}

function isExpressionParam(value: FlowNode["params"][string]): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.startsWith("=") || /\{\{[\s\S]+?\}\}/.test(trimmed);
}

function describePinnedData(node: FlowNode): string {
  const pinned = node.pinnedData?.trim();
  if (!pinned) return "";
  const text = pinned.replace(/\s+/g, " ").slice(0, 4000);
  return [
    "Pinned output:",
    text,
    "This node has pinned data; do not call external services or recompute it. Treat the pinned output as this node's result, emit the start/done markers for UI progress, then continue.",
  ].join("\n    ");
}

function describeExecutionSettings(node: FlowNode): string {
  const settings = node.settings;
  if (!settings) return "";
  const parts: string[] = [];
  if (settings.alwaysOutputData) {
    parts.push("Always output data: emit an empty item if this node returns no data.");
  }
  if (settings.executeOnce) {
    parts.push("Execute once: run this node once using only the first input item.");
  }
  if (settings.retryOnFail) {
    const tries = settings.maxTries && settings.maxTries > 1 ? settings.maxTries : 2;
    parts.push(`Retry on fail: up to ${tries} tries.`);
  }
  if (settings.onError === "continue") {
    parts.push("On error: continue with the last valid output.");
  } else if (settings.onError === "continueErrorOutput") {
    parts.push("On error: continue and pass error details downstream.");
  }
  return parts.length ? ["Execution settings:", ...parts].join("\n    ") : "";
}

function describeTriggerInput(input: FlowTriggerInput | undefined): string {
  if (!input) return "";
  try {
    return JSON.stringify(input).slice(0, 4000);
  } catch {
    return JSON.stringify({ source: input.source });
  }
}

/**
 * Compile the flow into an orchestration prompt. Lists nodes in execution
 * order with their type, configured parameters, and downstream targets, then
 * states the marker protocol the Executions parser relies on.
 */
export function compileFlowPrompt(
  doc: FlowDoc,
  options: { targetNodeId?: string; triggerInput?: FlowTriggerInput; mode?: FlowExecutionMode } = {},
): string {
  const mode = options.mode ?? "manual";
  const order = options.targetNodeId ? flowPartialExecutionOrder(doc, options.targetNodeId) : flowExecutionOrder(doc);
  const runSet = new Set(order);
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const lines: string[] = [];
  lines.push(`You are executing the automation flow "${doc.name}".`);
  lines.push("");
  if (options.targetNodeId) {
    lines.push(
      `This is a partial execution for node "${options.targetNodeId}". Run only the trigger/upstream nodes listed below and stop after the target node succeeds.`,
    );
    lines.push("");
  }
  const triggerInput = describeTriggerInput(options.triggerInput);
  if (triggerInput) {
    lines.push("Trigger input:");
    lines.push(triggerInput);
    lines.push("Treat this trigger input as the output of the trigger node before passing data downstream.");
    lines.push("");
  }
  lines.push(
    "Carry out each node below in order, passing the result of one node as the input to the nodes it connects to.",
  );
  lines.push("");
  lines.push("PROGRESS PROTOCOL — REQUIRED. The UI tracks this run only from these markers, so you MUST emit them:");
  lines.push("- Print each marker as plain text on its own line, with nothing else on that line.");
  lines.push("- Do NOT wrap a marker in backticks or a code block, and do NOT put it inside a sentence — a marker that isn't a bare line is ignored and the run will look stuck.");
  lines.push("- Immediately before working a node, print:  @@step-start <id>");
  lines.push("- While working a node, narrate what you are doing in plain language — these lines become that step's expandable log, so be clear and specific (inputs used, actions taken, what you found).");
  lines.push("- When a node succeeds, FIRST print a one-line summary of what it produced:  @@step-note <id> <summary>");
  lines.push("  (e.g. `@@step-note research-search Collected 6 sources on EU/US AI-safety policy`). This becomes the step's headline — keep it to one line, no backticks.");
  lines.push("- Then print:                                 @@step-done <id>");
  lines.push("- If that node fails, print a `@@step-note <id> <why it failed>` then:  @@step-fail <id>  (then stop unless the node says to continue).");
  lines.push("- Use the exact id shown in [brackets] below — not the node's name.");
  if (order.length > 0) {
    lines.push(`For example, the very first line of your reply should be:  @@step-start ${order[0]}`);
  }
  lines.push("");
  lines.push("Nodes:");
  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const def = catalogNode(node.type);
    const targets = executableTargets(doc, id).filter((target) => runSet.has(target));
    const params = describeParams(node);
    const pinned = mode === "manual" ? describePinnedData(node) : "";
    const settings = describeExecutionSettings(node);
    lines.push(
      `- [${id}] ${node.name} — ${def?.label ?? node.type}` +
        (params ? `\n    ${params}` : "") +
        (pinned ? `\n    ${pinned}` : "") +
        (settings ? `\n    ${settings}` : "") +
        (targets.length ? `\n    then → ${targets.join(", ")}` : ""),
    );
  }
  lines.push("");
  lines.push("When every node is done, print a one-line summary of what the flow accomplished.");
  return lines.join("\n");
}
