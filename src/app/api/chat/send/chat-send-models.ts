import type { CaveConfig, FamiliarBinding } from "@/lib/cave-config";
import type { ConversationFile } from "@/lib/cave-conversations";
import {
  cleanModelId,
  resolveChatModelState,
  type ChatModelState,
} from "@/lib/chat-model-state";
import { buildNextPathsDirective } from "@/lib/next-paths";

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

export function persistSendModelIntent(
  conversation: ConversationFile,
  body: ModelRequest,
  modelState: ChatModelState,
) {
  if (body.modelOverrideScope !== "session" || modelState.source !== "session") return;
  conversation.modelIntent = {
    model: modelState.effectiveModel,
    source: "session",
    applicationState: modelState.applicationState,
    reason: modelState.reason ?? "Saved for this chat.",
  };
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" ? value : "high";
}

function normalizeResponseSpeed(value: unknown): ResponseSpeed {
  return value === "fast" || value === "balanced" || value === "careful" ? value : "fast";
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
    prompt,
  ].join("\n");
}
