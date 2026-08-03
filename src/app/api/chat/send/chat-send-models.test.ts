// @ts-nocheck
import assert from "node:assert/strict";
import {
  modelIntentForSend,
  isModelOverrideScope,
  isValidModelOverrideIntent,
  persistedTurnControls,
  persistSendModelIntent,
  resolveSendModelMetadata,
  turnRetryModel,
} from "./chat-send-models.ts";

for (const scope of [undefined, "next-message", "session", "runtime-default"]) {
  assert.equal(isModelOverrideScope(scope), true, `${String(scope)} is a supported model scope`);
}
for (const scope of ["future-scope", "", 42, {}, []]) {
  assert.equal(isModelOverrideScope(scope), false, `${JSON.stringify(scope)} is rejected at launch`);
}

assert.equal(isValidModelOverrideIntent({}), true, "ordinary sends have no model intent");
assert.equal(
  isValidModelOverrideIntent({ modelOverride: "anthropic/claude-opus-4-6", modelOverrideScope: "session" }),
  true,
  "session-scoped model ids form a complete intent",
);
assert.equal(
  isValidModelOverrideIntent({ modelOverride: "", modelOverrideScope: "next-message" }),
  true,
  "one-turn runtime-default clears form a complete intent",
);
assert.equal(
  isValidModelOverrideIntent({ modelOverrideScope: "runtime-default" }),
  true,
  "runtime-owned defaults may omit the model argument entirely",
);
for (const invalidIntent of [
  { modelOverride: "anthropic/claude-opus-4-6" },
  { modelOverride: "", modelOverrideScope: "session" },
  { modelOverrideScope: "session" },
  { modelOverrideScope: "next-message" },
  { modelOverride: "", modelOverrideScope: undefined },
]) {
  assert.equal(
    isValidModelOverrideIntent(invalidIntent),
    false,
    `partial model intent is rejected: ${JSON.stringify(invalidIntent)}`,
  );
}

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
assert.deepEqual(
  persistedTurnControls(
    { modelOverrideScope: "runtime-default" },
    undefined,
  ),
  { modelOverrideScope: "runtime-default" },
  "runtime-default intent remains retryable even though it deliberately has no model id",
);
assert.deepEqual(
  persistedTurnControls(
    { modelOverride: "", modelOverrideScope: "next-message" },
    undefined,
  ),
  { modelOverrideScope: "runtime-default" },
  "a one-turn Runtime-default retry keeps its semantic intent for another retry without persisting a model id",
);

const inheritedRuntimeDefault = {
  familiarId: "hermes",
  harness: "hermes",
  runtime: null,
  effectiveModel: "",
  source: "runtime-default",
  applicationState: "saved",
  reason: "Using the runtime's configured default model.",
};
assert.equal(
  modelIntentForSend(
    {
      familiarId: "hermes",
      modelOverride: "",
      modelOverrideScope: "next-message",
    },
    inheritedRuntimeDefault,
  ),
  undefined,
  "an inherited runtime-owned default is retryable for one turn without pinning a new chat's durable model intent",
);
assert.equal(
  modelIntentForSend(
    {
      familiarId: "nyx",
      modelOverride: "anthropic/claude-opus-4-6",
      modelOverrideScope: "next-message",
    },
    { ...sessionState, source: "next-message" },
  ),
  undefined,
  "an immediate first send may race a familiar-default PATCH without pinning that choice into the new chat",
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

conversation.modelIntent = {
  model: "",
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
    null,
  ),
  false,
  "an end-of-stream save cannot collapse a newer Runtime-default sentinel into an absent prior intent",
);
assert.equal(
  conversation.modelIntent.model,
  "",
  "the newer Runtime-default PATCH wins over the stale explicit-model completion",
);

const runtimeDefault = resolveSendModelMetadata({
  body: { familiarId: "nyx", modelOverrideScope: "runtime-default" },
  config: { defaults: { model: "openai/gpt-5.6-sol" }, familiars: { nyx: { model: "anthropic/claude-opus-4-6" } } },
  binding: { harness: "claude", model: "anthropic/claude-opus-4-6" },
  existingConversation: conversation,
  modelForwardingEnabled: true,
});
assert.equal(runtimeDefault.desiredModel, "", "an immediate clear send must not forward the old session or familiar model");

const oneTurnRuntimeDefault = resolveSendModelMetadata({
  body: {
    familiarId: "nyx",
    modelOverride: "",
    modelOverrideScope: "next-message",
  },
  config: { defaults: { model: "openai/gpt-5.6-sol" }, familiars: { nyx: { model: "anthropic/claude-opus-4-6" } } },
  binding: { harness: "claude", model: "anthropic/claude-opus-4-6" },
  existingConversation: {
    ...conversation,
    modelIntent: {
      model: "anthropic/claude-haiku-4-5",
      source: "session",
    },
  },
  modelForwardingEnabled: true,
});
assert.equal(oneTurnRuntimeDefault.desiredModel, "");
assert.equal(oneTurnRuntimeDefault.modelState.source, "runtime-default");
assert.equal(
  modelIntentForSend(
    { familiarId: "nyx", modelOverride: "", modelOverrideScope: "next-message" },
    oneTurnRuntimeDefault.modelState,
  ),
  undefined,
  "one-turn Runtime default does not mutate the durable session model intent",
);

console.log("chat-send-models.test.ts: ok");
