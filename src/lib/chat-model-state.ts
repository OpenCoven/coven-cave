export type ModelScope = "global-default" | "familiar-default" | "session" | "next-message";

export type ModelApplicationState =
  | "unknown"
  | "saved"
  | "pending"
  | "applied"
  | "unsupported"
  | "failed";

export type ChatModelState = {
  familiarId: string;
  harness: string;
  runtime: string | null;
  effectiveModel: string;
  source: ModelScope;
  applicationState: ModelApplicationState;
  reason?: string;
};

export type ModelApplicationInput = {
  supported?: boolean;
  confirmed?: boolean;
  failed?: boolean;
};

export type ModelApplicationResult = {
  state: ModelApplicationState;
  reason: string;
};

export type ResolveChatModelStateInput = {
  familiarId: string;
  harness: string;
  runtime?: string | null;
  globalDefaultModel: string;
  familiarModel?: string | null;
  sessionModel?: string | null;
  nextMessageModel?: string | null;
  lastResponseModel?: string | null;
  application?: ModelApplicationInput;
};

const UNSUPPORTED_REASON =
  "Saved in Cave. Runtime model application is not confirmed by this harness path yet.";

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

export function cleanModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes(" ") || trimmed.includes("..")) return null;
  if (!MODEL_ID_RE.test(trimmed)) return null;

  return trimmed;
}

export function modelApplicationForHarness(input?: ModelApplicationInput): ModelApplicationResult {
  if (input?.failed) {
    return {
      state: "failed",
      reason: "Runtime rejected the selected model.",
    };
  }

  if (input?.supported && input.confirmed) {
    return {
      state: "applied",
      reason: "Runtime confirmed the selected model.",
    };
  }

  if (input?.supported) {
    return {
      state: "pending",
      reason: "Cave saved the model intent and is waiting for runtime confirmation.",
    };
  }

  return {
    state: "unsupported",
    reason: UNSUPPORTED_REASON,
  };
}

export function resolveChatModelState(input: ResolveChatModelStateInput): ChatModelState {
  const nextMessageModel = cleanModelId(input.nextMessageModel);
  if (nextMessageModel) {
    return chatModelState(input, {
      effectiveModel: nextMessageModel,
      source: "next-message",
      applicationState: "saved",
      reason: "Selected for the next message only.",
    });
  }

  const sessionModel = cleanModelId(input.sessionModel);
  if (sessionModel) {
    const application = input.application ? modelApplicationForHarness(input.application) : null;
    return chatModelState(input, {
      effectiveModel: sessionModel,
      source: "session",
      applicationState: application?.state ?? "saved",
      reason: application?.reason ?? UNSUPPORTED_REASON,
    });
  }

  const familiarModel = cleanModelId(input.familiarModel);
  if (familiarModel) {
    const application = input.application ? modelApplicationForHarness(input.application) : null;
    return chatModelState(input, {
      effectiveModel: familiarModel,
      source: "familiar-default",
      applicationState: application?.state ?? "saved",
      reason: application?.reason ?? UNSUPPORTED_REASON,
    });
  }

  return chatModelState(input, {
    effectiveModel: cleanModelId(input.globalDefaultModel) ?? "unknown",
    source: "global-default",
    applicationState: "saved",
    reason: "Inherited from Cave defaults.",
  });
}

function chatModelState(
  input: ResolveChatModelStateInput,
  state: Omit<ChatModelState, "familiarId" | "harness" | "runtime">,
): ChatModelState {
  return {
    familiarId: input.familiarId,
    harness: input.harness,
    runtime: input.runtime ?? null,
    ...state,
  };
}
