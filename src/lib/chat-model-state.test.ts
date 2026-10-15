// @ts-nocheck
import assert from "node:assert/strict";
import {
  cleanModelId,
  isSyntheticLocalModel,
  modelApplicationForHarness,
  modelApplicationFromRun,
  modelRejectionInError,
  resolveChatModelState,
  USAGE_LIMIT_APPLICATION_REASON,
  usageLimitInError,
} from "./chat-model-state.ts";

const base = {
  familiarId: "salem",
  harness: "claude",
  runtime: "local:/tmp/coven-cave",
  // Same provider as the harness: a Claude familiar's fallback must be a model
  // Claude Code can run (#5954 — cross-provider defaults now fall through).
  globalDefaultModel: "anthropic/claude-opus-5",
  familiarModel: "anthropic/claude-sonnet-4-6",
};

assert.equal(cleanModelId("  anthropic/claude-opus-4-7  "), "anthropic/claude-opus-4-7");
assert.equal(cleanModelId("openai/gpt-5.5"), "openai/gpt-5.5");
assert.equal(
  cleanModelId("openrouter/~anthropic/claude-opus-latest"),
  "openrouter/~anthropic/claude-opus-latest",
  "OpenCode provider aliases with a tilde-prefixed path segment remain selectable",
);
assert.equal(cleanModelId(""), null);
assert.equal(cleanModelId("bad model with spaces"), null);
assert.equal(cleanModelId("../escape"), null);
assert.equal(cleanModelId(42), null);
assert.equal(isSyntheticLocalModel("openclaw-local", "openclaw"), true);
assert.equal(
  isSyntheticLocalModel("openclaw-local", "claude"),
  true,
  "stale local-runtime placeholders are synthetic even after the familiar changes harness",
);
assert.equal(isSyntheticLocalModel("openai/gpt-5.5", "openclaw"), false);

assert.deepEqual(resolveChatModelState({ ...base }), {
  familiarId: "salem",
  harness: "claude",
  runtime: "local:/tmp/coven-cave",
  effectiveModel: "anthropic/claude-sonnet-4-6",
  source: "familiar-default",
  familiarDefaultModel: "anthropic/claude-sonnet-4-6",
  applicationState: "saved",
  reason: "Saved in Cave. Runtime model application is not confirmed by this runtime path yet.",
});

const clearedFamiliarDefault = resolveChatModelState({ ...base, familiarModel: "" });
assert.equal(clearedFamiliarDefault.effectiveModel, "");
assert.equal(clearedFamiliarDefault.source, "runtime-default");
assert.equal(clearedFamiliarDefault.familiarDefaultModel, null);
assert.equal(
  clearedFamiliarDefault.reason,
  "Using the runtime's configured default model.",
  "an explicitly cleared familiar model remains durable runtime-default intent",
);

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
    nextMessageModel: "anthropic/claude-haiku-4-5",
  }).source,
  "next-message",
);
assert.deepEqual(
  resolveChatModelState({
    ...base,
    sessionModel: "anthropic/claude-opus-4-7",
    nextMessageModel: "",
  }),
  {
    familiarId: "salem",
    harness: "claude",
    runtime: "local:/tmp/coven-cave",
    effectiveModel: "",
    source: "runtime-default",
    familiarDefaultModel: "anthropic/claude-sonnet-4-6",
    applicationState: "saved",
    reason: "Using the runtime's configured default model for this message.",
  },
  "a one-turn Runtime-default sentinel overrides the saved session model without deleting it",
);
assert.equal(resolveChatModelState({ ...base, familiarModel: null }).source, "global-default");
assert.deepEqual(
  resolveChatModelState({
    familiarId: "hermes",
    harness: "hermes",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "openai/gpt-5.6-sol",
    familiarModel: null,
  }),
  {
    familiarId: "hermes",
    harness: "hermes",
    runtime: "local:/tmp/coven-cave",
    effectiveModel: "",
    source: "runtime-default",
    familiarDefaultModel: null,
    applicationState: "saved",
    reason: "Using the runtime's configured default model.",
  },
  "a fallback Hermes inventory must not become an implicit launch override",
);
assert.deepEqual(
  resolveChatModelState({
    familiarId: "local-openclaw",
    harness: "openclaw",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "openai/gpt-5.5",
    familiarModel: "openclaw-local",
  }),
  {
    familiarId: "local-openclaw",
    harness: "openclaw",
    runtime: "local:/tmp/coven-cave",
    effectiveModel: "",
    source: "runtime-default",
    familiarDefaultModel: null,
    applicationState: "saved",
    reason: "Using the runtime's configured default model.",
  },
  "legacy synthetic runtime-local placeholders should defer to the runtime default",
);
assert.deepEqual(
  resolveChatModelState({
    familiarId: "nova",
    harness: "claude",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "openclaw-local",
    familiarModel: "openclaw-local",
  }),
  {
    familiarId: "nova",
    harness: "claude",
    runtime: "local:/tmp/coven-cave",
    effectiveModel: "",
    source: "runtime-default",
    familiarDefaultModel: null,
    applicationState: "saved",
    reason: "Using the runtime's configured default model.",
  },
  "stale synthetic defaults must not fabricate a model selection",
);
assert.deepEqual(
  resolveChatModelState({
    familiarId: "grok-nova",
    harness: "grok",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "openai/gpt-5.6-sol",
    familiarModel: null,
  }),
  {
    familiarId: "grok-nova",
    harness: "grok",
    runtime: "local:/tmp/coven-cave",
    effectiveModel: "",
    source: "runtime-default",
    familiarDefaultModel: null,
    applicationState: "saved",
    reason: "Using the runtime's configured default model.",
  },
  "an unconfigured Grok familiar must defer to Grok Build's configured default",
);
assert.equal(
  resolveChatModelState({
    familiarId: "grok-nova",
    harness: "grok",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "xai/grok-code-fast-1",
    familiarModel: null,
  }).effectiveModel,
  "",
  "a Cave-wide fallback does not become an implicit Grok launch override",
);
assert.deepEqual(
  resolveChatModelState({
    familiarId: "grok-nova",
    harness: "grok",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "openai/gpt-5.6-sol",
    familiarModel: "anthropic/claude-opus-4-8",
    sessionModel: "github/gpt-5.6-sol",
    nextMessageModel: "openai/gpt-5.5",
  }),
  {
    familiarId: "grok-nova",
    harness: "grok",
    runtime: "local:/tmp/coven-cave",
    effectiveModel: "",
    source: "runtime-default",
    familiarDefaultModel: null,
    applicationState: "saved",
    reason: "Using the runtime's configured default model.",
  },
  "stale models from a prior runtime must not be forwarded after switching a familiar to Grok",
);
assert.equal(
  resolveChatModelState({
    familiarId: "grok-nova",
    harness: "grok",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "openai/gpt-5.6-sol",
    familiarModel: "xai/grok-code-fast-1",
  }).effectiveModel,
  "xai/grok-code-fast-1",
  "an explicitly configured familiar Grok model remains selectable",
);
assert.equal(
  resolveChatModelState({
    familiarId: "grok-nova",
    harness: "grok",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "openai/gpt-5.6-sol",
    familiarModel: "my-model",
  }).effectiveModel,
  "my-model",
  "unqualified custom Grok model ids must not be mistaken for stale Cave provider models",
);
assert.deepEqual(
  resolveChatModelState({
    familiarId: "nova",
    harness: "opencode",
    runtime: "local:/tmp/coven-cave",
    globalDefaultModel: "openai/gpt-5.6-sol",
    familiarModel: null,
  }),
  {
    familiarId: "nova",
    harness: "opencode",
    runtime: "local:/tmp/coven-cave",
    effectiveModel: "",
    source: "runtime-default",
    familiarDefaultModel: null,
    applicationState: "saved",
    reason: "Using the runtime's configured default model.",
  },
  "OpenCode must defer an unconfigured familiar to its authenticated CLI default",
);
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
  reason: "Saved in Cave. Runtime model application is not confirmed by this runtime path yet.",
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

// #5938: a spent plan allowance is NOT a model rejection. Claude Code's quota
// notice names no model-rejection word, and a provider line that says "model
// unavailable: usage limit reached" names the model only incidentally — the id
// was accepted; the plan is spent. The usage-limit check runs first.
{
  const CLAUDE_NOTICE =
    "You've reached your Fable limit. Switch to another model, or manage usage credits at " +
    "claude.ai/settings/usage?from=cc_cli_limit_message, to continue.";
  assert.equal(modelRejectionInError(CLAUDE_NOTICE), false, "the Claude quota notice is not a model rejection");
  assert.equal(usageLimitInError(CLAUDE_NOTICE)?.kind, "quota", "the Claude quota notice is a usage limit");
  assert.equal(usageLimitInError("401 Unauthorized: missing API key"), null, "an auth failure is not a usage limit");

  const ambiguous = "model unavailable: usage limit reached";
  assert.equal(modelRejectionInError(ambiguous), true, "fixture: the rejection matcher alone would call this failed");
  const limited = modelApplicationFromRun({
    confirmedModel: "anthropic/claude-fable-5-1",
    isError: true,
    errorText: ambiguous,
  });
  assert.deepEqual(
    limited,
    { supported: true, reason: USAGE_LIMIT_APPLICATION_REASON },
    "the usage-limit check precedes the rejection check: pending with the limit reason, not failed",
  );
  assert.equal(modelApplicationForHarness(limited).state, "pending", "a quota keeps the model pending");
  assert.equal(USAGE_LIMIT_APPLICATION_REASON, "Usage limit reached for the selected model.");
  assert.deepEqual(
    modelApplicationFromRun({ confirmedModel: "openai/gpt-5.6-sol", isError: true, errorText: "429 Too Many Requests: rate limit" }),
    { supported: true },
    "throttling keeps the model pending with the generic reason",
  );
}

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

// #5954: a familiar rebound to another runtime (cody: codex → claude) keeps
// its chats saved on the old runtime. A model from another provider never
// reaches a single-provider runtime — send rejects it as
// model_runtime_mismatch — so it falls through to the next source instead of
// leaking into the composer ("Codex · anthropic/claude-opus-5-5") and failing
// the next send.
{
  const codexChat = {
    familiarId: "cody",
    harness: "codex",
    runtime: "local:/tmp/river-oaks",
    familiarModel: "anthropic/claude-opus-5-5",
  };
  const leaked = resolveChatModelState({ ...codexChat, globalDefaultModel: "openai/gpt-6-astra" });
  assert.equal(leaked.effectiveModel, "openai/gpt-6-astra", "the Claude default skips to a Codex-compatible fallback");
  assert.equal(leaked.source, "global-default");
  assert.equal(leaked.familiarDefaultModel, null, "a cross-provider familiar default is not offered as this runtime's default");

  const noCompatible = resolveChatModelState({ ...codexChat, globalDefaultModel: "anthropic/claude-opus-5" });
  assert.equal(noCompatible.effectiveModel, "", "with no compatible fallback, the runtime's own default applies");
  assert.equal(noCompatible.source, "runtime-default");

  assert.equal(
    resolveChatModelState({ ...codexChat, globalDefaultModel: "openai/gpt-6-astra", sessionModel: "anthropic/claude-opus-5-5" }).source,
    "global-default",
    "a cross-provider session intent is skipped the same way",
  );
  assert.equal(
    resolveChatModelState({ ...codexChat, familiarModel: "gpt-6-astra" }).effectiveModel,
    "gpt-6-astra",
    "a bare id carries no provider claim and still applies",
  );
}

console.log("chat-model-state.test.ts: ok");

// cave-pkapw: `source` reports which scope WON, not that the scopes differ.
// A session intent that merely restates the familiar default still resolves to
// source "session", so "is this promotable to the familiar default?" cannot be
// answered from `source` alone — hence `familiarDefaultModel` on the state.
{
  const sameAsDefault = resolveChatModelState({
    ...base,
    sessionModel: "anthropic/claude-sonnet-4-6",
  });
  assert.equal(
    sameAsDefault.source,
    "session",
    "a session intent equal to the familiar default STILL reports source 'session'",
  );
  assert.equal(
    sameAsDefault.effectiveModel,
    sameAsDefault.familiarDefaultModel,
    "…so the two compare equal, which is the only signal that promotion is a no-op",
  );

  const differs = resolveChatModelState({
    ...base,
    sessionModel: "anthropic/claude-opus-4-7",
  });
  assert.equal(differs.source, "session");
  assert.notEqual(
    differs.effectiveModel,
    differs.familiarDefaultModel,
    "a genuinely diverged session model is the only case worth offering to promote",
  );

  // After promotion the familiar default becomes the session's model while the
  // session intent survives — the exact state that left the row stuck on screen.
  const afterPromotion = resolveChatModelState({
    ...base,
    familiarModel: "anthropic/claude-opus-4-7",
    sessionModel: "anthropic/claude-opus-4-7",
  });
  assert.equal(
    afterPromotion.effectiveModel,
    afterPromotion.familiarDefaultModel,
    "promotion collapses the difference, so the promote row hides on refresh",
  );
}
