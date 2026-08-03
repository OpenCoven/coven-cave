import type { CaveConfig, FamiliarBinding } from "@/lib/cave-config";
import type {
  ConversationFile,
  ConversationModelIntent,
} from "@/lib/cave-conversations";
import {
  cleanModelId,
  resolveChatModelState,
  type ChatModelState,
} from "@/lib/chat-model-state";
import { isModelAllowedByRuntime } from "@/lib/runtime-models";
import { buildNextPathsDirective } from "@/lib/next-paths";
import { buildCovenMarkersDirective } from "@/lib/coven-marker-directive";
import { buildCitationsDirective } from "@/lib/citations-directive";
import type { ModelControlValues } from "@/lib/model-control-capabilities";

type ModelRequest = {
  familiarId: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session" | "runtime-default";
};

const MODEL_OVERRIDE_SCOPES = new Set([
  "next-message",
  "session",
  "runtime-default",
]);

/** JSON callers are untyped at the launch boundary; reject future/unknown
 * scopes instead of silently treating them as an inherited model. */
export function isModelOverrideScope(value: unknown): value is ModelRequest["modelOverrideScope"] {
  return value === undefined || (typeof value === "string" && MODEL_OVERRIDE_SCOPES.has(value));
}

/** A model id and its scope are one wire-level intent. Keep malformed or
 * legacy partial pairs from silently falling back to the conversation's old
 * model after the boundary has accepted the request. The id's safety is
 * checked separately by the send route. */
export function isValidModelOverrideIntent(value: {
  modelOverride?: unknown;
  modelOverrideScope?: unknown;
}): boolean {
  const hasModelOverride = Object.prototype.hasOwnProperty.call(value, "modelOverride");
  const modelOverride = value.modelOverride;
  switch (value.modelOverrideScope) {
    case undefined:
      return !hasModelOverride || modelOverride === undefined;
    case "runtime-default":
      return !hasModelOverride || modelOverride === undefined || modelOverride === "";
    case "next-message":
      return hasModelOverride && typeof modelOverride === "string";
    case "session":
      return hasModelOverride && typeof modelOverride === "string" && modelOverride.trim().length > 0;
    default:
      return false;
  }
}

type ResponseControlRequest = {
  modelControls?: ModelControlValues;
  modelOverride?: string;
  modelOverrideScope?: ModelRequest["modelOverrideScope"];
};


export function resolveSendModelMetadata(args: {
  body: ModelRequest;
  config: CaveConfig;
  binding: FamiliarBinding;
  existingConversation: ConversationFile | null;
  modelForwardingEnabled: boolean;
}): {
  desiredModel: string;
  modelState: ChatModelState;
  invalidSavedModel: boolean;
  suppressedSavedModel: boolean;
} {
  const requestedModel = cleanModelId(args.body.modelOverride);
  const nextMessageRuntimeDefault =
    args.body.modelOverrideScope === "next-message" &&
    args.body.modelOverride === "";
  const sessionModel =
    args.body.modelOverrideScope === "runtime-default"
      ? ""
      : args.body.modelOverrideScope === "session"
      ? requestedModel
      : args.existingConversation?.modelIntent?.model ?? null;
  const modelState = resolveChatModelState({
    familiarId: args.body.familiarId,
    harness: args.binding.harness,
    runtime: null,
    globalDefaultModel: args.config.defaults.model,
    familiarModel: args.config.familiars[args.body.familiarId]?.model ?? null,
    sessionModel,
    nextMessageModel: args.body.modelOverrideScope === "next-message"
      ? nextMessageRuntimeDefault ? "" : requestedModel
      : null,
    application: { supported: args.modelForwardingEnabled },
  });
  const desiredModel = modelState.effectiveModel === "unknown" ? args.binding.model : modelState.effectiveModel;
  const rawSavedModel = args.body.modelOverrideScope === "next-message" || args.body.modelOverrideScope === "runtime-default"
    ? undefined
    : args.body.modelOverrideScope === "session"
      ? args.body.modelOverride
      : args.existingConversation?.modelIntent?.model ?? args.config.familiars[args.body.familiarId]?.model;
  const invalidSavedModel = rawSavedModel !== undefined && rawSavedModel !== null && rawSavedModel !== ""
    && cleanModelId(rawSavedModel) === null;
  const savedModel = cleanModelId(rawSavedModel);
  const suppressedSavedModel = Boolean(
    savedModel &&
    modelState.source !== "session" &&
    modelState.source !== "familiar-default",
  );
  return { desiredModel, modelState, invalidSavedModel, suppressedSavedModel };
}

export function savedModelSelectionRejection(args: {
  desiredModel: string;
  modelState: ChatModelState;
  harness: string;
  modelForwardingEnabled: boolean;
  invalidSavedModel?: boolean;
  suppressedSavedModel?: boolean;
}): "invalid" | "unsupported" | "forwarding" | null {
  if (args.invalidSavedModel) return "invalid";
  if (args.suppressedSavedModel) return "unsupported";
  if (args.modelState.source !== "session" && args.modelState.source !== "familiar-default") return null;
  const desiredModel = cleanModelId(args.desiredModel);
  if (!desiredModel) return null;
  if (!isModelAllowedByRuntime(args.harness, desiredModel)) return "unsupported";
  return args.modelForwardingEnabled ? null : "forwarding";
}

/** A saved Cave model is an explicit launch intent, not a hint that can be
 * silently ignored when the selected runtime cannot forward model ids. */
export function savedModelSelectionRequiresForwarding(args: {
  desiredModel: string;
  modelState: ChatModelState;
  harness?: string;
  modelForwardingEnabled: boolean;
  invalidSavedModel?: boolean;
}): boolean {
  return savedModelSelectionRejection({
    ...args,
    harness: args.harness ?? args.modelState.harness,
  }) === "forwarding";
}

export function modelIntentForSend(
  body: ModelRequest,
  modelState: ChatModelState,
): ConversationModelIntent | undefined {
  if (body.modelOverrideScope === "runtime-default") {
    return {
      model: "",
      source: "session",
      applicationState: "saved",
      reason: "Using the runtime's configured default model.",
    };
  }
  if (body.modelOverrideScope !== "session" || modelState.source !== "session") return undefined;
  return {
    model: modelState.effectiveModel,
    source: "session",
    applicationState: modelState.applicationState,
    reason: modelState.reason ?? "Saved for this chat.",
  };
}

export function persistSendModelIntent(
  conversation: ConversationFile,
  body: ModelRequest,
  modelState: ChatModelState,
  expectedPreviousModel: string | null = conversation.modelIntent?.model ?? null,
): boolean {
  const intent = modelIntentForSend(body, modelState);
  if (!intent) return false;
  // Empty string is the durable Runtime-default sentinel. Preserve it in the
  // compare-and-set key instead of normalizing it together with an absent
  // intent, or a stale send completion can undo a newer Runtime-default PATCH.
  const comparableIntentModel = (value: string | null | undefined) =>
    value === "" ? "" : cleanModelId(value);
  const expected = comparableIntentModel(expectedPreviousModel);
  const current = comparableIntentModel(conversation.modelIntent?.model);
  // The run captured `expected` before it started. A different current model
  // is a newer mid-stream PATCH and must win over this stale completion.
  if (current !== expected && current !== intent.model) return false;
  conversation.modelIntent = intent;
  return true;
}

/** Stable user-turn metadata consumed by retry-capable clients after refresh. */
export function persistedTurnControls(
  body: ResponseControlRequest,
  retryModel?: string | null,
): {
  modelControls?: ModelControlValues;
  modelOverride?: string;
  modelOverrideScope?: "runtime-default";
} {
  return {
    ...(body.modelControls && Object.keys(body.modelControls).length > 0
      ? { modelControls: body.modelControls }
      : {}),
    ...(cleanModelId(retryModel) ? { modelOverride: cleanModelId(retryModel)! } : {}),
    ...(
      body.modelOverrideScope === "runtime-default" ||
      (body.modelOverrideScope === "next-message" && body.modelOverride === "")
      ? { modelOverrideScope: "runtime-default" as const }
      : {}),
  };
}

/** Prefer runtime confirmation, then explicit user intent, then the model that
 * was actually routed. All three are absent for authenticated dynamic defaults. */
export function turnRetryModel(input: {
  requestedModel?: unknown;
  confirmedModel?: unknown;
  routedModel?: unknown;
}): string | undefined {
  return cleanModelId(input.confirmedModel)
    ?? cleanModelId(input.requestedModel)
    ?? cleanModelId(input.routedModel)
    ?? undefined;
}

/** Add only explicitly selected prompt-only guidance. Native controls must
 * never be duplicated as prose, and unsupported controls never reach here. */
export function buildPromptWithResponseControls(prompt: string, body: ResponseControlRequest): string {
  const controls = Object.entries(body.modelControls ?? {});
  const guidance = controls.length > 0
    ? [
        "<response_controls>",
        ...controls.map(([family, value]) => `${family}: ${value}`),
        "These are user-selected prompt guidance, not provider settings. Do not mention them unless asked.",
        "</response_controls>",
        "",
      ]
    : [];
  return [
    ...guidance,
    buildNextPathsDirective(),
    "",
    buildCovenMarkersDirective(),
    "",
    buildCitationsDirective(),
    "",
    prompt,
  ].join("\n");
}
