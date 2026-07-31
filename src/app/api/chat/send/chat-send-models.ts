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
import { buildNextPathsDirective } from "@/lib/next-paths";
import { buildCovenMarkersDirective } from "@/lib/coven-marker-directive";
import { buildCitationsDirective } from "@/lib/citations-directive";
import type { ModelControlValues } from "@/lib/model-control-capabilities";

type ModelRequest = {
  familiarId: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session";
};

type ResponseControlRequest = {
  modelControls?: ModelControlValues;
};


export function resolveSendModelMetadata(args: {
  body: ModelRequest;
  config: CaveConfig;
  binding: FamiliarBinding;
  existingConversation: ConversationFile | null;
  modelForwardingEnabled: boolean;
}): { desiredModel: string; modelState: ChatModelState } {
  const requestedModel = cleanModelId(args.body.modelOverride);
  const sessionModel =
    args.body.modelOverrideScope === "session"
      ? requestedModel
      : args.existingConversation?.modelIntent?.model ?? null;
  const modelState = resolveChatModelState({
    familiarId: args.body.familiarId,
    harness: args.binding.harness,
    runtime: null,
    globalDefaultModel: args.config.defaults.model,
    familiarModel: args.config.familiars[args.body.familiarId]?.model ?? null,
    sessionModel,
    nextMessageModel: args.body.modelOverrideScope === "next-message" ? requestedModel : null,
    application: { supported: args.modelForwardingEnabled },
  });
  const desiredModel = modelState.effectiveModel === "unknown" ? args.binding.model : modelState.effectiveModel;
  return { desiredModel, modelState };
}

export function modelIntentForSend(
  body: ModelRequest,
  modelState: ChatModelState,
): ConversationModelIntent | undefined {
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
  const expected = cleanModelId(expectedPreviousModel);
  const current = cleanModelId(conversation.modelIntent?.model);
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
} {
  return {
    ...(body.modelControls && Object.keys(body.modelControls).length > 0
      ? { modelControls: body.modelControls }
      : {}),
    ...(cleanModelId(retryModel) ? { modelOverride: cleanModelId(retryModel)! } : {}),
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
