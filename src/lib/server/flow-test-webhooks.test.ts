import assert from "node:assert/strict";
import {
  clearTestWebhooks,
  findTestWebhook,
  registerTestWebhook,
  TEST_WEBHOOK_TTL_MS,
} from "./flow-test-webhooks.ts";
import { emptyFlow, type FlowDoc, type FlowNode } from "../flow/flow-doc.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function webhookNode(id: string, path = "/hook", method = "POST"): FlowNode {
  return {
    id,
    type: "trigger.webhook",
    name: id,
    position: { x: 0, y: 0 },
    params: { path, method },
  };
}

function flow(node: FlowNode): FlowDoc {
  return { ...emptyFlow("draft", "Draft", NOW), nodes: [node] };
}

clearTestWebhooks();

// Test webhooks register the current draft snapshot for n8n's 120-second
// listen window, without requiring the flow to be active/published.
{
  const doc = flow(webhookNode("hook", "/incoming", "post"));
  const registration = registerTestWebhook(doc, "hook", 1_000);

  assert.equal(TEST_WEBHOOK_TTL_MS, 120_000);
  assert.equal(registration.method, "POST");
  assert.equal(registration.path, "/incoming");
  assert.equal(registration.expiresAt, 121_000);

  const match = findTestWebhook("POST", "/incoming", 1_500);
  assert.equal(match?.flow.id, "draft");
  assert.equal(match?.trigger.id, "hook");
}

// Expired test webhooks disappear instead of executing stale draft snapshots.
{
  const match = findTestWebhook("POST", "/incoming", 122_000);
  assert.equal(match, null);
}

clearTestWebhooks();

console.log("flow-test-webhooks.test.ts OK");
