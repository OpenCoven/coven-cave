export const ONBOARDING_BOOTSTRAP_STAGES = [
  {
    id: "core-tools",
    label: "Prepare local components",
    pendingDetail:
      "Cave will check its private Node.js and npm runtime, then verify the Coven CLI.",
  },
  {
    id: "workspace",
    label: "Create Cave defaults",
    pendingDetail:
      "Waiting for local components. Cave will then create user-scoped folders and defaults.",
  },
  {
    id: "daemon",
    label: "Start local services",
    pendingDetail:
      "Waiting for setup. Cave will check the local service and start it only when needed.",
  },
] as const;

export type OnboardingBootstrapStageId =
  (typeof ONBOARDING_BOOTSTRAP_STAGES)[number]["id"];

export type OnboardingBootstrapStageStatus =
  | "pending"
  | "running"
  | "complete"
  | "skipped"
  | "failed";

export type OnboardingBootstrapStage = {
  id: OnboardingBootstrapStageId;
  label: string;
  status: OnboardingBootstrapStageStatus;
  detail: string;
};

export type OnboardingBootstrapFailure = {
  stage: OnboardingBootstrapStageId;
  stageLabel: string;
  message: string;
  recoveryLabel: "Retry setup";
};

export type OnboardingBootstrapState = {
  version: 1;
  confirmed: boolean;
  complete: boolean;
  needsSetup: boolean;
  status: "idle" | "running" | "failed" | "complete";
  activeStage: OnboardingBootstrapStageId | null;
  stages: OnboardingBootstrapStage[];
  failure: OnboardingBootstrapFailure | null;
  updatedAt: string;
};

export type OnboardingBootstrapStageResult =
  | { ok: true; skipped: boolean; detail: string }
  | { ok: false; message: string };

export type OnboardingBootstrapStageRunner = (
  onProgress: (detail: string) => Promise<void>,
) => Promise<OnboardingBootstrapStageResult>;

export type OnboardingBootstrapRunners = Record<
  OnboardingBootstrapStageId,
  OnboardingBootstrapStageRunner
>;

export type OnboardingBootstrapRunSlot = {
  run: Promise<OnboardingBootstrapState> | null;
};

export function startSerializedOnboardingBootstrapRun(
  slot: OnboardingBootstrapRunSlot,
  runFactory: () => Promise<OnboardingBootstrapState>,
): {
  started: boolean;
  run: Promise<OnboardingBootstrapState>;
} {
  if (slot.run) return { started: false, run: slot.run };
  const run = runFactory();
  slot.run = run;
  void run
    .finally(() => {
      if (slot.run === run) slot.run = null;
    })
    .catch(() => undefined);
  return { started: true, run };
}

export const ONBOARDING_BOOTSTRAP_BOUNDARIES = {
  credentials:
    "Provider sign-in is deferred until you first use a familiar that needs it.",
  elevation:
    "Setup writes only to your user account and never asks for an administrator password.",
  git: "Git is optional. Install it later only when you want project and Queue features.",
} as const;

export type OnboardingBootstrapPlatformPolicy = {
  supported: boolean;
  requiresElevation: false;
  gitRequired: false;
  providerAuthentication: "deferred";
};

export function onboardingBootstrapPlatformPolicy(
  platform: NodeJS.Platform,
): OnboardingBootstrapPlatformPolicy {
  return {
    supported:
      platform === "win32" || platform === "darwin" || platform === "linux",
    requiresElevation: false,
    gitRequired: false,
    providerAuthentication: "deferred",
  };
}

export function createOnboardingBootstrapState(
  confirmed = false,
): OnboardingBootstrapState {
  return {
    version: 1,
    confirmed,
    complete: false,
    needsSetup: true,
    status: "idle",
    activeStage: null,
    stages: ONBOARDING_BOOTSTRAP_STAGES.map((stage) => ({
      id: stage.id,
      label: stage.label,
      status: "pending",
      detail: stage.pendingDetail,
    })),
    failure: null,
    updatedAt: new Date().toISOString(),
  };
}

function updateStage(
  state: OnboardingBootstrapState,
  id: OnboardingBootstrapStageId,
  patch: Partial<OnboardingBootstrapStage>,
): OnboardingBootstrapState {
  return {
    ...state,
    stages: state.stages.map((stage) =>
      stage.id === id ? { ...stage, ...patch } : stage,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeResumableBootstrapState(
  state: OnboardingBootstrapState,
): OnboardingBootstrapState {
  if (state.status !== "running") return state;
  return {
    ...state,
    status: "idle",
    activeStage: null,
    stages: state.stages.map((stage) =>
      stage.status === "running"
        ? {
            ...stage,
            status: "pending",
            detail:
              ONBOARDING_BOOTSTRAP_STAGES.find(
                (definition) => definition.id === stage.id,
              )?.pendingDetail ?? stage.detail,
          }
        : stage,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export async function runOnboardingBootstrapStages(
  initial: OnboardingBootstrapState,
  runners: OnboardingBootstrapRunners,
  onState: (state: OnboardingBootstrapState) => Promise<void>,
): Promise<OnboardingBootstrapState> {
  let state: OnboardingBootstrapState = {
    ...normalizeResumableBootstrapState(initial),
    confirmed: true,
    complete: false,
    needsSetup: true,
    status: "running",
    failure: null,
    updatedAt: new Date().toISOString(),
  };
  await onState(state);

  for (const definition of ONBOARDING_BOOTSTRAP_STAGES) {
    const existing = state.stages.find((stage) => stage.id === definition.id);
    if (existing?.status === "complete" || existing?.status === "skipped") {
      continue;
    }

    state = updateStage(
      { ...state, activeStage: definition.id },
      definition.id,
      { status: "running", detail: definition.pendingDetail },
    );
    await onState(state);

    const result = await runners[definition.id](async (detail) => {
      state = updateStage(state, definition.id, { detail });
      await onState(state);
    });

    if (!result.ok) {
      const failure: OnboardingBootstrapFailure = {
        stage: definition.id,
        stageLabel: definition.label,
        message: result.message,
        recoveryLabel: "Retry setup",
      };
      state = updateStage(
        {
          ...state,
          status: "failed",
          activeStage: definition.id,
          failure,
        },
        definition.id,
        { status: "failed", detail: result.message },
      );
      await onState(state);
      return state;
    }

    state = updateStage(state, definition.id, {
      status: result.skipped ? "skipped" : "complete",
      detail: result.detail,
    });
    await onState(state);
  }

  state = {
    ...state,
    complete: true,
    needsSetup: false,
    status: "complete",
    activeStage: null,
    failure: null,
    updatedAt: new Date().toISOString(),
  };
  await onState(state);
  return state;
}
