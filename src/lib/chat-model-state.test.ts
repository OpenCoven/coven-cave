// @ts-nocheck
import assert from "node:assert/strict";
import {
  cleanModelId,
  modelApplicationForHarness,
  modelApplicationFromRun,
  modelRejectionInError,
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
  resolveChatModelState({ ...base, sessionModel: "anthropic/claude-opus-4-7" }).applicationState,
  "saved",
  "session model intent is saved in Cave until a runtime application path confirms otherwise",
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

// modelRejectionInError: only model-specific failures count, not generic errors.
assert.equal(
  modelRejectionInError("error: model claude-bogus-9 not found"),
  true,
  "a 'model … not found' tail names the model",
);
assert.equal(
  modelRejectionInError("invalid value 'gpt-nope' for '--model <MODEL>'"),
  true,
  "an 'invalid … model' tail names the model (flag-rejection form)",
);
assert.equal(
  modelRejectionInError("unknown model: nous/hermes-99"),
  true,
  "an 'unknown model' tail names the model",
);
assert.equal(
  modelRejectionInError("401 Unauthorized: missing API key"),
  false,
  "an auth failure must NOT be mistaken for a model rejection",
);
assert.equal(
  modelRejectionInError("network error: connection refused"),
  false,
  "a transport failure must NOT be mistaken for a model rejection",
);
assert.equal(modelRejectionInError(""), false, "empty tail is not a rejection");
assert.equal(modelRejectionInError(undefined), false, "non-string tail is not a rejection");

// modelApplicationFromRun: coven echoes the requested model in system.init BEFORE
// the harness runs, so an echo confirms forwarding — not a successful run.
assert.equal(
  modelApplicationFromRun({ confirmedModel: null, isError: false, errorText: "" }),
  null,
  "no echo ⇒ leave the pre-run application state untouched (null)",
);
assert.deepEqual(
  modelApplicationFromRun({
    confirmedModel: "anthropic/claude-opus-4-7",
    isError: false,
    errorText: "",
  }),
  { supported: true, confirmed: true },
  "echo + successful run ⇒ applied",
);
assert.deepEqual(
  modelApplicationFromRun({
    confirmedModel: "anthropic/claude-bogus-9",
    isError: true,
    errorText: "error: model claude-bogus-9 not found",
  }),
  { failed: true },
  "echo + run errored ON the model ⇒ failed",
);
assert.deepEqual(
  modelApplicationFromRun({
    confirmedModel: "anthropic/claude-opus-4-7",
    isError: true,
    errorText: "401 Unauthorized: missing API key",
  }),
  { supported: true },
  "echo + run errored for a NON-model reason ⇒ pending (model was forwarded, not confirmed)",
);

// Round-trip guard: coven echoes the namespaced id verbatim, so the application
// pipeline confirms an exact match against the id Cave sent. If anyone later
// normalizes one side (strips provider/), this applied-state path breaks.
{
  const requested = "anthropic/claude-opus-4-7";
  const echoedByInit = cleanModelId(requested); // what route.ts derives confirmedModel from
  assert.equal(echoedByInit, requested, "namespaced id must survive cleanModelId unchanged");
  assert.deepEqual(
    modelApplicationForHarness(
      modelApplicationFromRun({ confirmedModel: echoedByInit, isError: false, errorText: "" }),
    ),
    { state: "applied", reason: "Runtime confirmed the selected model." },
    "a verbatim namespaced echo round-trips to applied",
  );
}

console.log("chat-model-state.test.ts: ok");
