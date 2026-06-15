// @ts-nocheck
import assert from "node:assert/strict";
import {
  cleanModelId,
  modelApplicationForHarness,
  resolveChatModelState,
} from "./chat-model-state.ts";

const base = {
  familiarId: "salem",
  harness: "claude",
  runtime: "local:/tmp/coven-cave",
  globalDefaultModel: "openai/gpt-5.5",
  familiarModel: "anthropic/claude-sonnet-4-6",
};

assert.equal(cleanModelId("  anthropic/claude-opus-4-7  "), "anthropic/claude-opus-4-7");
assert.equal(cleanModelId("openai/gpt-5.5"), "openai/gpt-5.5");
assert.equal(cleanModelId(""), null);
assert.equal(cleanModelId("bad model with spaces"), null);
assert.equal(cleanModelId("../escape"), null);
assert.equal(cleanModelId(42), null);

assert.deepEqual(resolveChatModelState({ ...base }), {
  familiarId: "salem",
  harness: "claude",
  runtime: "local:/tmp/coven-cave",
  effectiveModel: "anthropic/claude-sonnet-4-6",
  source: "familiar-default",
  applicationState: "saved",
  reason: "Saved in Cave. Runtime model application is not confirmed by this harness path yet.",
});

assert.equal(
  resolveChatModelState({ ...base, sessionModel: "anthropic/claude-opus-4-7" }).source,
  "session",
);
assert.equal(
  resolveChatModelState({
    ...base,
    sessionModel: "anthropic/claude-opus-4-7",
    nextMessageModel: "openai/gpt-5.5",
  }).source,
  "next-message",
);
assert.equal(resolveChatModelState({ ...base, familiarModel: null }).source, "global-default");
assert.equal(
  resolveChatModelState({ ...base, lastResponseModel: "anthropic/claude-haiku-4-5" })
    .effectiveModel,
  "anthropic/claude-sonnet-4-6",
  "last response metadata is historical evidence and never overrides current desired state",
);

assert.deepEqual(modelApplicationForHarness({ supported: true, confirmed: true }), {
  state: "applied",
  reason: "Runtime confirmed the selected model.",
});
assert.deepEqual(modelApplicationForHarness({ supported: false, confirmed: false }), {
  state: "unsupported",
  reason: "Saved in Cave. Runtime model application is not confirmed by this harness path yet.",
});

console.log("chat-model-state.test.ts: ok");
