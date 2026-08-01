import { cleanModelId, type ChatModelState } from "./chat-model-state.ts";

export type ChatModelResolutionStatus = "loading" | "ready" | "error";

export type ChatLaunchRequirement = {
  id: "project" | "model";
  ready: boolean;
  label: string;
  detail: string;
};

export type ChatLaunchReadiness = {
  ready: boolean;
  requirements: ChatLaunchRequirement[];
  /** null is unresolved; an empty string is an explicit runtime default. */
  modelValue: string | null;
};

export function hasChatStarted(turns: readonly { role: string }[]): boolean {
  return turns.some((turn) => turn.role === "user" || turn.role === "assistant");
}

export function isModelReadyForChatSend(input: {
  hasStarted: boolean;
  modelValue: string | null;
  modelOverride?: string | null;
}): boolean {
  if (input.hasStarted) return true;
  if (input.modelOverride === "") return true;
  if (cleanModelId(input.modelOverride)) return true;
  return input.modelValue !== null;
}

export function deriveChatLaunchReadiness(input: {
  projectReady: boolean;
  projectDetail: string;
  modelStatus: ChatModelResolutionStatus;
  modelState: ChatModelState | null;
  modelOverride?: string | null;
}): ChatLaunchReadiness {
  const override = input.modelOverride === "" ? "" : cleanModelId(input.modelOverride);
  const stateModel =
    input.modelStatus === "ready" && input.modelState?.applicationState !== "failed"
      ? input.modelState?.source === "runtime-default"
        ? ""
        : cleanModelId(input.modelState?.effectiveModel)
      : null;
  const modelValue = override ?? stateModel;
  const modelReady = modelValue !== null;
  const modelDetail = modelReady
    ? modelValue || "Runtime default"
    : input.modelStatus === "loading"
      ? "Resolving final model…"
      : "Choose a model before sending.";
  const requirements: ChatLaunchRequirement[] = [
    {
      id: "project",
      ready: input.projectReady,
      label: "Project",
      detail: input.projectDetail,
    },
    {
      id: "model",
      ready: modelReady,
      label: "Model",
      detail: modelDetail,
    },
  ];

  return {
    ready: requirements.every((requirement) => requirement.ready),
    requirements,
    modelValue,
  };
}
