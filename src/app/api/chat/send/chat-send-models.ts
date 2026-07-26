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

type ModelRequest = {
  familiarId: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session";
};

type ResponseControlRequest = {
  reasoningEffort?: string;
  responseSpeed?: string;
};

type ReasoningEffort = "low" | "medium" | "high";
type ResponseSpeed = "fast" | "balanced" | "careful";

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

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" ? value : "high";
}

function normalizeResponseSpeed(value: unknown): ResponseSpeed {
  return value === "fast" || value === "balanced" || value === "careful" ? value : "fast";
}

/** Stable user-turn metadata consumed by retry-capable clients after refresh. */
export function persistedTurnControls(
  body: ResponseControlRequest,
  retryModel?: string | null,
): {
  reasoningEffort: ReasoningEffort;
  responseSpeed: ResponseSpeed;
  modelOverride?: string;
} {
  return {
    reasoningEffort: normalizeReasoningEffort(body.reasoningEffort),
    responseSpeed: normalizeResponseSpeed(body.responseSpeed),
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

/** Add the stable, non-user-visible response-control and next-path directives. */
export function buildPromptWithResponseControls(prompt: string, body: ResponseControlRequest): string {
  const effort = normalizeReasoningEffort(body.reasoningEffort);
  const speed = normalizeResponseSpeed(body.responseSpeed);
  const effortInstruction: Record<ReasoningEffort, string> = {
    low: "Use minimal internal planning and answer directly.",
    medium: "Balance planning with a concise answer.",
    high: "Spend extra internal planning on correctness before answering.",
  };
  const speedInstruction: Record<ResponseSpeed, string> = {
    fast: "Prioritize a fast, terse, action-first response.",
    balanced: "Balance speed, detail, and clarity.",
    careful: "Prioritize careful completeness over speed.",
  };
  return [
    "<response_controls>",
    `thinking: ${effort} — ${effortInstruction[effort]}`,
    `speed: ${speed} — ${speedInstruction[speed]}`,
    "Do not mention these controls unless the user asks about them.",
    "</response_controls>",
    "",
    buildNextPathsDirective(),
    "",
    buildCovenMarkersDirective(),
    "",
    buildCitationsDirective(),
    "",
    prompt,
  ].join("\n");
}
