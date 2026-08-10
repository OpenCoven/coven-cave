export const ONBOARDING_BOOTSTRAP_STAGES = [
  {
    id: "core-tools",
    label: "Prepare local components",
    pendingDetail: "Cave will verify the local components it needs.",
  },
  {
    id: "workspace",
    label: "Create Cave defaults",
    pendingDetail: "Cave will create user-scoped folders and defaults.",
  },
  {
    id: "daemon",
    label: "Start local services",
    pendingDetail: "Cave will start its local background service.",
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

export type OnboardingSetupFailureCode =
  | "application_data_not_writable"
  | "filesystem_failed"
  | "download_failed"
  | "integrity_check_failed"
  | "archive_failed"
  | "install_busy"
  | "install_timeout"
  | "verification_failed"
  | "unsupported_platform"
  | "installer_start_failed"
  | "local_service_failed"
  | "unknown_failure";

export type OnboardingComponentReadiness =
  | "ready"
  | "missing"
  | "incompatible"
  | "unusable"
  | "not_ready"
  | "not_checked"
  | "unknown";

export type OnboardingSetupDiagnostics = {
  version: 1;
  capturedAt: string;
  stage: OnboardingBootstrapStageId;
  code: OnboardingSetupFailureCode;
  summary: string;
  nextStep: string;
  environment: {
    appVersion: string;
    platform: "win32" | "darwin" | "linux" | "unsupported";
    architecture: "x64" | "arm64" | "other";
  };
  applicationData: {
    displayLocation: "Cave application data";
    exists: boolean | null;
    writeProbe: "passed" | "failed" | "not_run";
  };
  components: {
    managedNode: OnboardingComponentReadiness;
    covenCli: OnboardingComponentReadiness;
    localService: OnboardingComponentReadiness;
  };
  installer?: {
    target: "managed-node" | "coven-cli";
    status: "idle" | "running" | "done" | "busy" | "unavailable";
    elapsedMs: number | null;
    exitCode: number | null;
    outputTail: string[];
  };
};

export type OnboardingBootstrapFailure = {
  stage: OnboardingBootstrapStageId;
  stageLabel: string;
  message: string;
  recoveryLabel: "Retry setup";
  code?: OnboardingSetupFailureCode;
  nextStep?: string;
  diagnostics?: OnboardingSetupDiagnostics;
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
  | {
      ok: false;
      message: string;
      code?: OnboardingSetupFailureCode;
      nextStep?: string;
      diagnostics?: OnboardingSetupDiagnostics;
    };

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
        ...(result.code ? { code: result.code } : {}),
        ...(result.nextStep ? { nextStep: result.nextStep } : {}),
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
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
