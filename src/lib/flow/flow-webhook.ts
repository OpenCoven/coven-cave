import type { FlowDoc, FlowNode } from "./flow-doc.ts";

export type FlowWebhookMatch =
  | { ok: true; flow: FlowDoc; trigger: FlowNode }
  | { ok: false; error: string; status: number };

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function webhookProductionPath(path: string): string {
  const normalized = normalizeWebhookPath(path);
  return normalized === "/"
    ? "/api/flows/webhook"
    : `/api/flows/webhook${normalized}`;
}

export function webhookTestPath(path: string): string {
  const normalized = normalizeWebhookPath(path);
  return normalized === "/"
    ? "/api/flows/webhook-test"
    : `/api/flows/webhook-test${normalized}`;
}

function webhookTriggerMatches(node: FlowNode, method: string, path: string): boolean {
  if (node.disabled || node.type !== "trigger.webhook") return false;
  const nodeMethod = typeof node.params.method === "string" ? node.params.method : "POST";
  const nodePath = typeof node.params.path === "string" ? node.params.path : "/hook";
  return normalizeMethod(nodeMethod) === normalizeMethod(method) && normalizeWebhookPath(nodePath) === normalizeWebhookPath(path);
}

export function findWebhookFlow(flows: FlowDoc[], method: string, path: string): FlowWebhookMatch {
  const matches: Array<{ flow: FlowDoc; trigger: FlowNode }> = [];
  for (const flow of flows) {
    if (!flow.active) continue;
    for (const node of flow.nodes) {
      if (webhookTriggerMatches(node, method, path)) matches.push({ flow, trigger: node });
    }
  }
  if (matches.length === 0) return { ok: false, error: "webhook not found", status: 404 };
  if (matches.length > 1) return { ok: false, error: "webhook path conflict", status: 409 };
  return { ok: true, ...matches[0] };
}
