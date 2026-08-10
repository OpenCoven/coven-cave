import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { saveConfig } from "@/lib/cave-config";
import { callDaemonTarget, localDaemonTarget } from "@/lib/coven-daemon";
import { caveHome, covenHome } from "@/lib/coven-paths";
import { startLocalDaemon } from "@/lib/daemon-start";
import {
  createOnboardingBootstrapState,
  normalizeResumableBootstrapState,
  runOnboardingBootstrapStages,
  startSerializedOnboardingBootstrapRun,
  type OnboardingBootstrapRunners,
  type OnboardingBootstrapStageResult,
  type OnboardingBootstrapState,
} from "@/lib/onboarding-bootstrap";
import { writeJsonAtomic } from "@/lib/server/atomic-write";
import {
  ensureOnboardingCoreTools,
  inspectOnboardingCoreTools,
} from "@/lib/server/onboarding-core-tools";

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

async function loadPersistedState(): Promise<OnboardingBootstrapState | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(bootstrapStatePath(), "utf8"),
    );
    return isBootstrapState(parsed)
      ? normalizeResumableBootstrapState(parsed)
      : null;
  } catch {
    return null;
  }
}

async function persistState(state: OnboardingBootstrapState): Promise<void> {
  await mkdir(caveHome(), { recursive: true });
  await writeJsonAtomic(bootstrapStatePath(), state);
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
  try {
    await onProgress("Creating user-scoped Cave folders…");
    await Promise.all([
      mkdir(path.join(covenHome(), "defaults"), { recursive: true }),
      mkdir(path.join(covenHome(), "memory"), { recursive: true }),
      mkdir(path.join(caveHome(), "conversations"), { recursive: true }),
    ]);
    await onProgress("Writing Cave defaults…");
    await saveConfig({});
    return {
      ok: true,
      skipped: false,
      detail: "Cave defaults are ready.",
    };
  } catch {
    return {
      ok: false,
      message:
        "Setup stopped at Create Cave defaults. Check that ~/.coven is writable, then retry setup.",
    };
  }
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
    return {
      ok: false,
      message:
        "Setup stopped at Start local services. Restart Cave, then retry setup.",
    };
  }
  return {
    ok: true,
    skipped: false,
    detail: "Cave’s local service is running.",
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
      }).catch(async () => {
        const current = bootstrapRuntime.state ?? state;
        const activeStage = current.activeStage ?? "core-tools";
        const active = current.stages.find((stage) => stage.id === activeStage);
        const failed: OnboardingBootstrapState = {
          ...current,
          status: "failed",
          activeStage,
          failure: {
            stage: activeStage,
            stageLabel: active?.label ?? "Prepare local components",
            message: `Setup stopped at ${active?.label ?? "Prepare local components"}. Restart Cave, then retry setup.`,
            recoveryLabel: "Retry setup",
          },
          stages: current.stages.map((stage) =>
            stage.id === activeStage
              ? {
                  ...stage,
                  status: "failed",
                  detail: `Setup stopped at ${stage.label}. Restart Cave, then retry setup.`,
                }
              : stage,
          ),
          updatedAt: new Date().toISOString(),
        };
        bootstrapRuntime.state = failed;
        await persistState(failed).catch(() => undefined);
        return failed;
      }),
  );
  void coordinated.run.catch(() => undefined);
  return state;
}
