// @ts-nocheck
import assert from "node:assert/strict";
import {
  persistedTurnControls,
  persistSendModelIntent,
  resolveSendModelMetadata,
  turnRetryModel,
} from "./chat-send-models.ts";

const sessionState = {
  familiarId: "nyx",
  harness: "claude",
  runtime: null,
  effectiveModel: "anthropic/claude-opus-4-6",
  source: "session",
  applicationState: "saved",
  reason: "Saved for this chat.",
};

assert.equal(
  turnRetryModel({
    requestedModel: undefined,
    confirmedModel: undefined,
    routedModel: undefined,
  }),
  undefined,
  "a dynamic CLI default stays unpinned",
);
assert.equal(
  turnRetryModel({
    requestedModel: "anthropic/claude-opus-4-6",
    confirmedModel: undefined,
    routedModel: undefined,
  }),
  "anthropic/claude-opus-4-6",
  "an explicit turn choice remains retryable",
);
assert.equal(
  turnRetryModel({
    requestedModel: "provider/alias",
    confirmedModel: "provider/resolved-model",
    routedModel: "provider/alias",
  }),
  "provider/resolved-model",
  "runtime confirmation is the strongest retry identity",
);
assert.deepEqual(
  persistedTurnControls(
    { modelControls: { reasoning: "medium" } },
    undefined,
  ),
  {
    modelControls: { reasoning: "medium" },
  },
  "persisted selected-model controls never invent a model for a dynamic default",
);

const conversation = {
  sessionId: "session-1",
  familiarId: "nyx",
  harness: "claude",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  turns: [],
  modelIntent: {
    model: "anthropic/claude-sonnet-4-5",
    source: "session",
  },
};
assert.equal(
  persistSendModelIntent(
    conversation,
    {
      familiarId: "nyx",
      modelOverride: "anthropic/claude-opus-4-6",
      modelOverrideScope: "session",
    },
    sessionState,
    "anthropic/claude-sonnet-4-5",
  ),
  true,
);
assert.equal(conversation.modelIntent.model, "anthropic/claude-opus-4-6");

conversation.modelIntent = {
  model: "anthropic/claude-haiku-4-5",
  source: "session",
};
assert.equal(
  persistSendModelIntent(
    conversation,
    {
      familiarId: "nyx",
      modelOverride: "anthropic/claude-opus-4-6",
      modelOverrideScope: "session",
    },
    sessionState,
    "anthropic/claude-sonnet-4-5",
  ),
  false,
  "an end-of-stream save cannot overwrite a newer mid-stream model PATCH",
);
assert.equal(conversation.modelIntent.model, "anthropic/claude-haiku-4-5");

const runtimeDefault = resolveSendModelMetadata({
  body: { familiarId: "nyx", modelOverrideScope: "runtime-default" },
  config: { defaults: { model: "openai/gpt-5.6-sol" }, familiars: { nyx: { model: "anthropic/claude-opus-4-6" } } },
  binding: { harness: "claude", model: "anthropic/claude-opus-4-6" },
  existingConversation: conversation,
  modelForwardingEnabled: true,
});
assert.equal(runtimeDefault.desiredModel, "", "an immediate clear send must not forward the old session or familiar model");

console.log("chat-send-models.test.ts: ok");
