import { normalizeWebhookPath } from "../flow/flow-webhook.ts";
import type { FlowDoc, FlowNode } from "../flow/flow-doc.ts";

export const TEST_WEBHOOK_TTL_MS = 120_000;

export type TestWebhookRegistration = {
  flow: FlowDoc;
  trigger: FlowNode;
  method: string;
  path: string;
  expiresAt: number;
};

const registrations = new Map<string, TestWebhookRegistration>();

function key(method: string, path: string): string {
  return `${method.trim().toUpperCase()} ${normalizeWebhookPath(path)}`;
}

function triggerMethod(node: FlowNode): string {
  return typeof node.params.method === "string" && node.params.method.trim()
    ? node.params.method.trim().toUpperCase()
    : "POST";
}

function triggerPath(node: FlowNode): string {
  return typeof node.params.path === "string" ? normalizeWebhookPath(node.params.path) : "/hook";
}

export function registerTestWebhook(
  flow: FlowDoc,
  triggerId: string,
  nowMs = Date.now(),
): TestWebhookRegistration {
  const trigger = flow.nodes.find((node) => node.id === triggerId);
  if (!trigger || trigger.type !== "trigger.webhook" || trigger.disabled) {
    throw new Error("choose an enabled webhook trigger");
  }
  const method = triggerMethod(trigger);
  const path = triggerPath(trigger);
  const registration: TestWebhookRegistration = {
    flow,
    trigger,
    method,
    path,
    expiresAt: nowMs + TEST_WEBHOOK_TTL_MS,
  };
  registrations.set(key(method, path), registration);
  return registration;
}

export function findTestWebhook(
  method: string,
  path: string,
  nowMs = Date.now(),
): TestWebhookRegistration | null {
  const registration = registrations.get(key(method, path));
  if (!registration) return null;
  if (registration.expiresAt <= nowMs) {
    registrations.delete(key(method, path));
    return null;
  }
  return registration;
}

export function clearTestWebhooks(): void {
  registrations.clear();
}
