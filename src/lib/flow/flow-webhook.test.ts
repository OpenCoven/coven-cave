import assert from "node:assert/strict";
import { findWebhookFlow, webhookProductionPath } from "./flow-webhook.ts";
import { emptyFlow, type FlowDoc, type FlowNode } from "./flow-doc.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function webhookNode(id: string, path: string, method = "POST", disabled = false): FlowNode {
  return {
    id,
    type: "trigger.webhook",
    name: id,
    position: { x: 0, y: 0 },
    params: { path, method },
    ...(disabled ? { disabled: true } : {}),
  };
}

function flow(id: string, active: boolean, nodes: FlowNode[]): FlowDoc {
  return { ...emptyFlow(id, id, NOW), active, nodes };
}

// Production webhooks only dispatch to active saved flows with an enabled
// Webhook trigger whose method and normalized path match the request.
{
  const inactive = flow("inactive", false, [webhookNode("hook", "/deploy")]);
  const disabled = flow("disabled", true, [webhookNode("hook", "/deploy", "POST", true)]);
  const active = flow("active", true, [webhookNode("hook", "deploy", "post")]);

  const match = findWebhookFlow([inactive, disabled, active], "POST", "/deploy");

  assert.equal(match.ok, true);
  assert.equal(match.flow?.id, "active");
  assert.equal(match.trigger?.id, "hook");
}

// Matching the same production method/path in more than one active flow is
// ambiguous and should be rejected rather than choosing a random flow.
{
  const first = flow("first", true, [webhookNode("hook", "/deploy")]);
  const second = flow("second", true, [webhookNode("hook", "/deploy")]);

  const match = findWebhookFlow([first, second], "POST", "/deploy");

  assert.equal(match.ok, false);
  assert.equal(match.error, "webhook path conflict");
  assert.equal(match.status, 409);
}

// The node panel uses the same normalization as production matching when it
// shows a webhook URL to copy.
{
  assert.equal(webhookProductionPath("deploy"), "/api/flows/webhook/deploy");
  assert.equal(webhookProductionPath("/deploy/"), "/api/flows/webhook/deploy");
  assert.equal(webhookProductionPath("/"), "/api/flows/webhook");
}

console.log("flow-webhook.test.ts OK");
