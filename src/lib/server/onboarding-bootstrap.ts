import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { saveConfig } from "@/lib/cave-config";
import { callDaemonTarget, localDaemonTarget } from "@/lib/coven-daemon";
import { caveHome, covenHome } from "@/lib/coven-paths";
import { startLocalDaemon } from "@/lib/daemon-start";
import { sanitizeAboutDiagnosticText } from "@/lib/about-diagnostics";
import {
  ONBOARDING_BOOTSTRAP_STAGES,
  createOnboardingBootstrapState,
  normalizeResumableBootstrapState,
  runOnboardingBootstrapStages,
  startSerializedOnboardingBootstrapRun,
  type OnboardingBootstrapRunners,
  type OnboardingBootstrapStageResult,
  type OnboardingBootstrapStageId,
  type OnboardingBootstrapState,
  type OnboardingSetupFailureCode,
} from "@/lib/onboarding-bootstrap";
import { writeJsonAtomic } from "@/lib/server/atomic-write";
import {
  ensureOnboardingCoreTools,
  inspectOnboardingCoreTools,
} from "@/lib/server/onboarding-core-tools";
import {
  createOnboardingSetupDiagnostics,
  isOnboardingSetupFailureCode,
  normalizePersistedOnboardingSetupDiagnostics,
  onboardingFailureCopy,
  probeOwnedDirectoryWrite,
} from "@/lib/server/onboarding-diagnostics";

type BootstrapGlobal = typeof globalThis & {
  __covenOnboardingBootstrap?: {
    state: OnboardingBootstrapState | null;
    run: Promise<OnboardingBootstrapState> | null;
  };
};

const bootstrapGlobal = globalThis as BootstrapGlobal;
const bootstrapRuntime = (bootstrapGlobal.__covenOnboardingBootstrap ??= {
  state: null,
  run: null,
});

function bootstrapStatePath(): string {
  return path.join(caveHome(), "onboarding-bootstrap.json");
}

async function pathIsDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function pathIsFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

function isBootstrapState(value: unknown): value is OnboardingBootstrapState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<OnboardingBootstrapState>;
  return (
    state.version === 1 &&
    typeof state.confirmed === "boolean" &&
    Array.isArray(state.stages)
  );
}

const STAGE_STATUS = new Set([
  "pending",
  "running",
  "complete",
  "skipped",
  "failed",
]);
const BOOTSTRAP_STATUS = new Set(["idle", "running", "failed", "complete"]);

export function safePersistedState(
  state: OnboardingBootstrapState,
): OnboardingBootstrapState {
  const stages = ONBOARDING_BOOTSTRAP_STAGES.map((definition) => {
    const source = state.stages.find((stage) => stage?.id === definition.id);
    const status =
      source && STAGE_STATUS.has(source.status) ? source.status : "pending";
    return {
      id: definition.id,
      label: definition.label,
      status,
      detail:
        source && typeof source.detail === "string"
          ? sanitizeAboutDiagnosticText(source.detail)
          : definition.pendingDetail,
    };
  });
  const normalizedDiagnostics = normalizePersistedOnboardingSetupDiagnostics(
    state.failure?.diagnostics,
  );
  const failureStage = state.failure?.stage;
  const definition = ONBOARDING_BOOTSTRAP_STAGES.find(
    (stage) => stage.id === failureStage,
  );
  const diagnostics =
    normalizedDiagnostics?.stage === failureStage
      ? normalizedDiagnostics
      : null;
  const persistedCode: OnboardingSetupFailureCode =
    isOnboardingSetupFailureCode(state.failure?.code)
      ? state.failure.code
      : diagnostics?.code ?? "unknown_failure";
  const code: OnboardingSetupFailureCode =
    persistedCode === "application_data_not_writable" &&
      !(
        diagnostics?.code === "application_data_not_writable" &&
        diagnostics.applicationData.writeProbe === "failed"
      )
      ? "filesystem_failed"
      : persistedCode;
  const matchedDiagnostics = diagnostics?.code === code ? diagnostics : null;
  const copy = onboardingFailureCopy(code);
  const failure = state.failure && definition
    ? {
        stage: definition.id,
        stageLabel: definition.label,
        message: `Setup stopped at ${definition.label}. ${copy.summary} ${copy.nextStep}`,
        recoveryLabel: "Retry setup" as const,
        code,
        nextStep: copy.nextStep,
        ...(matchedDiagnostics ? { diagnostics: matchedDiagnostics } : {}),
      }
    : null;
  const activeStage = ONBOARDING_BOOTSTRAP_STAGES.some(
    (stage) => stage.id === state.activeStage,
  )
    ? state.activeStage
    : null;
  return {
    version: 1,
    confirmed: state.confirmed === true,
    // A reconstructed failure must remain retryable even when a malformed
    // persisted state incorrectly combines it with completed-state flags.
    complete: failure ? false : state.complete === true,
    needsSetup: failure ? true : state.needsSetup !== false,
    status: failure
      ? "failed"
      : BOOTSTRAP_STATUS.has(state.status) ? state.status : "idle",
    stages: stages.map((stage) =>
      failure && stage.id === failure.stage
        ? { ...stage, status: "failed", detail: failure.message }
        : stage
    ),
    activeStage,
    failure,
    updatedAt:
      typeof state.updatedAt === "string" &&
      Number.isFinite(Date.parse(state.updatedAt))
        ? new Date(state.updatedAt).toISOString()
        : new Date().toISOString(),
  };
}

async function loadPersistedState(): Promise<OnboardingBootstrapState | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(bootstrapStatePath(), "utf8"),
    );
    return isBootstrapState(parsed)
      ? normalizeResumableBootstrapState(safePersistedState(parsed))
      : null;
  } catch {
    return null;
  }
}

class BootstrapPersistenceError extends Error {
  constructor() {
    super("onboarding bootstrap state could not be persisted");
    this.name = "BootstrapPersistenceError";
  }
}

async function persistState(state: OnboardingBootstrapState): Promise<void> {
  try {
    await persistOnboardingBootstrapState(state);
  } catch {
    throw new BootstrapPersistenceError();
  }
}

export async function persistOnboardingBootstrapState(
  state: OnboardingBootstrapState,
  options: {
    directory?: string;
    mkdir?: typeof mkdir;
    writeJson?: typeof writeJsonAtomic;
  } = {},
): Promise<void> {
  const directory = options.directory ?? caveHome();
  await (options.mkdir ?? mkdir)(directory, { recursive: true });
  await (options.writeJson ?? writeJsonAtomic)(
    path.join(directory, "onboarding-bootstrap.json"),
    safePersistedState(state),
  );
}

async function inspectWorkspaceReady(): Promise<boolean> {
  const home = covenHome();
  const cave = caveHome();
  const checks = await Promise.all([
    pathIsDirectory(home),
    pathIsDirectory(path.join(home, "defaults")),
    pathIsFile(path.join(cave, "config.json")),
  ]);
  return checks.every(Boolean);
}

async function ensureWorkspace(
  onProgress: (detail: string) => Promise<void>,
): Promise<OnboardingBootstrapStageResult> {
  if (await inspectWorkspaceReady()) {
    return {
      ok: true,
      skipped: true,
      detail: "Existing Cave defaults were kept.",
    };
  }
  await onProgress("Creating user-scoped Cave folders…");
  for (const directory of [
    path.join(covenHome(), "defaults"),
    path.join(covenHome(), "memory"),
    path.join(caveHome(), "conversations"),
  ]) {
    try {
      await mkdir(directory, { recursive: true });
    } catch {
      return workspaceWriteFailure(directory);
    }
  }
  await onProgress("Writing Cave defaults…");
  try {
    await saveConfig({});
    return {
      ok: true,
      skipped: false,
      detail: "Cave defaults are ready.",
    };
  } catch {
    return workspaceWriteFailure(caveHome());
  }
}

async function workspaceWriteFailure(
  directory: string,
): Promise<OnboardingBootstrapStageResult> {
  const applicationData = await probeOwnedDirectoryWrite(directory);
  const code: OnboardingSetupFailureCode =
    applicationData.writeProbe === "failed"
      ? "application_data_not_writable"
      : "filesystem_failed";
  return setupStageFailure("workspace", code, { applicationData });
}

async function inspectDaemonReady(): Promise<boolean> {
  const result = await callDaemonTarget<{ ok?: boolean }>(localDaemonTarget(), {
    path: "/api/v1/health",
    timeoutMs: 800,
  });
  return result.ok && result.data?.ok !== false;
}

async function ensureDaemon(
  onProgress: (detail: string) => Promise<void>,
): Promise<OnboardingBootstrapStageResult> {
  if (await inspectDaemonReady()) {
    return {
      ok: true,
      skipped: true,
      detail: "The local service was already running.",
    };
  }
  await onProgress("Starting Cave’s local service…");
  const result = await startLocalDaemon({ automatic: true });
  if (!result.ok) {
    return setupStageFailure("daemon", "local_service_failed", {
      localService: "not_ready",
    });
  }
  return {
    ok: true,
    skipped: false,
    detail: "Cave’s local service is running.",
  };
}

function setupStageFailure(
  stage: OnboardingBootstrapStageId,
  code: OnboardingSetupFailureCode,
  options: {
    applicationData?: {
      exists: boolean | null;
      writeProbe: "passed" | "failed" | "not_run";
    };
    localService?: "not_ready";
  } = {},
): Extract<OnboardingBootstrapStageResult, { ok: false }> {
  const definition = ONBOARDING_BOOTSTRAP_STAGES.find(
    (candidate) => candidate.id === stage,
  )!;
  const copy = onboardingFailureCopy(code);
  const diagnostics = createOnboardingSetupDiagnostics({
    stage,
    code,
    ...(options.applicationData
      ? { applicationData: options.applicationData }
      : {}),
    components: {
      managedNode: "unknown",
      covenCli: "unknown",
      localService: options.localService ?? "not_checked",
    },
  });
  return {
    ok: false,
    code,
    nextStep: copy.nextStep,
    diagnostics,
    message: `Setup stopped at ${definition.label}. ${copy.summary} ${copy.nextStep}`,
  };
}

const runners: OnboardingBootstrapRunners = {
  "core-tools": ensureOnboardingCoreTools,
  workspace: ensureWorkspace,
  daemon: ensureDaemon,
};

async function preflightState(): Promise<OnboardingBootstrapState> {
  const state = createOnboardingBootstrapState(false);
  const [tools, workspaceReady, daemonReady] = await Promise.all([
    inspectOnboardingCoreTools(),
    inspectWorkspaceReady(),
    inspectDaemonReady(),
  ]);
  const existingSetupReady =
    tools.runtimeReady && tools.coreToolsReady && workspaceReady;
  const ready = {
    "core-tools": tools.runtimeReady && tools.coreToolsReady,
    workspace: workspaceReady,
    daemon: daemonReady || existingSetupReady,
  } as const;
  state.stages = state.stages.map((stage) =>
    ready[stage.id]
      ? {
          ...stage,
          status: "skipped",
          detail:
            stage.id === "core-tools"
              ? "Existing local components were verified."
              : stage.id === "workspace"
                ? "Existing Cave defaults were kept."
                : daemonReady
                  ? "The local service was already running."
                  : "Local services will recover when Cave opens.",
        }
      : stage,
  );
  if (Object.values(ready).every(Boolean)) {
    state.complete = true;
    state.needsSetup = false;
    state.status = "complete";
  }
  return state;
}

async function currentState(): Promise<OnboardingBootstrapState> {
  if (bootstrapRuntime.state) return bootstrapRuntime.state;
  bootstrapRuntime.state = (await loadPersistedState()) ?? (await preflightState());
  return bootstrapRuntime.state;
}

export async function onboardingBootstrapStatus(): Promise<OnboardingBootstrapState> {
  return currentState();
}

export async function startOrResumeOnboardingBootstrap(
  confirm: boolean,
): Promise<OnboardingBootstrapState> {
  let state = await currentState();
  if (!state.confirmed && !confirm) return state;
  if (state.complete) return state;
  if (bootstrapRuntime.run) return state;

  state = {
    ...normalizeResumableBootstrapState(state),
    confirmed: true,
    status: "running",
    failure: null,
    updatedAt: new Date().toISOString(),
  };
  bootstrapRuntime.state = state;

  const coordinated = startSerializedOnboardingBootstrapRun(
    bootstrapRuntime,
    () =>
      runOnboardingBootstrapStages(state, runners, async (next) => {
        bootstrapRuntime.state = next;
        await persistState(next);
      }).catch(async (error) => {
        const current = bootstrapRuntime.state ?? state;
        const failed = await bootstrapRunFailureState(current, {
          persistenceFailed: error instanceof BootstrapPersistenceError,
        });
        bootstrapRuntime.state = failed;
        await persistState(failed).catch(() => undefined);
        return failed;
      }),
  );
  void coordinated.run.catch(() => undefined);
  return state;
}

export async function bootstrapRunFailureState(
  current: OnboardingBootstrapState,
  options: {
    persistenceFailed?: boolean;
    probePersistenceDirectory?: () => Promise<{
      exists: boolean | null;
      writeProbe: "passed" | "failed";
    }>;
  } = {},
): Promise<OnboardingBootstrapState> {
  // A persistence error can happen while publishing a runner's already-safe
  // failure. Never replace the actual download/checksum/archive/etc. outcome
  // with a secondary state-file error.
  if (current.failure) return current;

  const activeStage = current.activeStage ?? "core-tools";
  const active = current.stages.find((stage) => stage.id === activeStage);
  const applicationData = options.persistenceFailed
    ? await (options.probePersistenceDirectory ?? (() =>
        probeOwnedDirectoryWrite(caveHome())))()
    : undefined;
  const code: OnboardingSetupFailureCode = options.persistenceFailed
    ? applicationData?.writeProbe === "failed"
      ? "application_data_not_writable"
      : "filesystem_failed"
    : "unknown_failure";
  const result = setupStageFailure(activeStage, code, {
    ...(applicationData ? { applicationData } : {}),
  });
  return {
    ...current,
    complete: false,
    needsSetup: true,
    status: "failed",
    activeStage,
    failure: {
      stage: activeStage,
      stageLabel: active?.label ?? "Prepare local components",
      message: result.message,
      recoveryLabel: "Retry setup",
      ...(result.code ? { code: result.code } : {}),
      ...(result.nextStep ? { nextStep: result.nextStep } : {}),
      ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
    },
    stages: current.stages.map((stage) =>
      stage.id === activeStage
        ? {
            ...stage,
            status: "failed",
            detail: result.message,
          }
        : stage,
    ),
    updatedAt: new Date().toISOString(),
  };
}
