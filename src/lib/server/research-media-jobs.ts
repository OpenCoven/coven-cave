import {
  isResearchGenerationMediaKind,
  type ResearchGeneration,
} from "../research-generations.ts";
import type {
  ResearchMediaCancelResult,
  ResearchMediaJobDefinition,
  ResearchMediaJobFactory,
  ResearchMediaQueueResult,
} from "./research-media-job-contract.ts";
import { createResearchMediaJobDefinition } from "./research-media-job-factory.ts";
import {
  listResearchGenerationFamiliarIds,
  listResearchGenerations,
  researchGenerationsPath,
  transitionResearchGeneration,
} from "./research-generations.ts";
import { removeResearchGenerationMedia } from "./research-media-store.ts";
import { acquireProcessIntentLock } from "./process-intent-lock.ts";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

type ActiveJob = {
  definition: ResearchMediaJobDefinition;
  controller: AbortController;
  cancelRequested: boolean;
  killCalled: boolean;
  stopMonitor?: () => void;
};

type ResearchMediaRunnerState = {
  activeByFamiliar: Map<string, ActiveJob>;
  deferredByGeneration: Map<string, Deferred>;
  drainsByFamiliar: Map<string, Promise<void>>;
  pendingDrainsByFamiliar: Set<string>;
  drainFailuresByFamiliar: Map<string, number>;
  retryTimersByFamiliar: Map<string, ReturnType<typeof setTimeout>>;
  factoryByFamiliar: Map<string, ResearchMediaJobFactory>;
  defaultFactory?: ResearchMediaJobFactory;
  startupPromise?: Promise<void>;
};

declare global {
  var __caveResearchMediaRunnerState: ResearchMediaRunnerState | undefined;
}

function runnerState(): ResearchMediaRunnerState {
  globalThis.__caveResearchMediaRunnerState ??= {
    activeByFamiliar: new Map(),
    deferredByGeneration: new Map(),
    drainsByFamiliar: new Map(),
    pendingDrainsByFamiliar: new Set(),
    drainFailuresByFamiliar: new Map(),
    retryTimersByFamiliar: new Map(),
    factoryByFamiliar: new Map(),
  };
  globalThis.__caveResearchMediaRunnerState.pendingDrainsByFamiliar ??=
    new Set();
  globalThis.__caveResearchMediaRunnerState.drainFailuresByFamiliar ??=
    new Map();
  globalThis.__caveResearchMediaRunnerState.retryTimersByFamiliar ??=
    new Map();
  return globalThis.__caveResearchMediaRunnerState;
}

function generationKey(familiarId: string, generationId: string): string {
  return `${familiarId}\u0000${generationId}`;
}

function deferredFor(familiarId: string, generationId: string): Deferred {
  const state = runnerState();
  const key = generationKey(familiarId, generationId);
  const existing = state.deferredByGeneration.get(key);
  if (existing) return existing;
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const deferred = { promise, resolve };
  state.deferredByGeneration.set(key, deferred);
  return deferred;
}

function settle(familiarId: string, generationId: string): void {
  const state = runnerState();
  const key = generationKey(familiarId, generationId);
  state.deferredByGeneration.get(key)?.resolve();
  state.deferredByGeneration.delete(key);
}

function publicError(error: unknown): string {
  const message = error instanceof Error && error.message
    ? error.message
    : "media generation failed";
  return message.slice(0, 500);
}

function logRunnerError(context: string, error: unknown): void {
  console.warn(
    `[research-media-jobs] ${context}: ${publicError(error)}`,
  );
}

async function removeJobMedia(
  familiarId: string,
  generationId: string,
): Promise<void> {
  try {
    await removeResearchGenerationMedia(familiarId, generationId);
  } catch (error) {
    logRunnerError(`failed to clean media for ${generationId}`, error);
  }
}

async function persistFailedJob(
  familiarId: string,
  generationId: string,
  error: unknown,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await transitionResearchGeneration(
        familiarId,
        generationId,
        ["rendering"],
        {
          status: "failed",
          stage: null,
          progress: null,
          error: publicError(error),
        },
      );
      return;
    } catch (persistError) {
      if (attempt === 2) {
        logRunnerError(
          `failed to persist terminal state for ${generationId}`,
          persistError,
        );
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 25 * 2 ** attempt),
      );
    }
  }
}

function factoryFor(familiarId: string): ResearchMediaJobFactory {
  const state = runnerState();
  return (
    state.factoryByFamiliar.get(familiarId) ??
    state.defaultFactory ??
    createResearchMediaJobDefinition
  );
}

function isRenderableDraft(generation: ResearchGeneration): boolean {
  return (
    isResearchGenerationMediaKind(generation.kind) &&
    generation.status === "draft" &&
    generation.renderConfig !== undefined &&
    generation.content?.kind === generation.kind
  );
}

function stopActiveJob(active: ActiveJob): void {
  active.cancelRequested = true;
  active.controller.abort();
  if (!active.killCalled) {
    active.killCalled = true;
    try {
      active.definition.kill?.();
    } catch {
      // The child may have exited between durable cancellation and the kill.
    }
  }
}

function monitorDurableCancellation(
  familiarId: string,
  generationId: string,
  active: ActiveJob,
): () => void {
  let checking = false;
  const timer = setInterval(() => {
    if (checking || active.cancelRequested) return;
    checking = true;
    void listResearchGenerations(familiarId)
      .then((generations) => {
        const current = generations.find(
          (generation) => generation.id === generationId,
        );
        if (!current || current.status !== "rendering") {
          stopActiveJob(active);
        }
      })
      .catch((error) => {
        logRunnerError(
          `cancellation monitor failed for ${generationId}`,
          error,
        );
      })
      .finally(() => {
        checking = false;
      });
  }, 250);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function runActiveJob(
  familiarId: string,
  generationId: string,
  active: ActiveJob,
): Promise<void> {
  try {
    const result = await active.definition.run({
      reportStage: async (stage, progress) => {
        if (active.cancelRequested) {
          throw new DOMException("media generation cancelled", "AbortError");
        }
        const updated = await transitionResearchGeneration(
          familiarId,
          generationId,
          ["rendering"],
          {
            stage,
            ...(progress ? { progress } : {}),
          },
        );
        if (!updated.ok) {
          throw new DOMException(
            "media generation is no longer rendering",
            "AbortError",
          );
        }
      },
      signal: active.controller.signal,
      isCancellationRequested: () => active.cancelRequested,
    });
    if (active.cancelRequested) {
      await removeJobMedia(familiarId, generationId);
    } else {
      const ready = await transitionResearchGeneration(
        familiarId,
        generationId,
        ["rendering"],
        {
          status: "ready",
          stage: null,
          progress: null,
          content: result.content,
          error: null,
        },
      );
      if (!ready.ok) {
        // Cancellation (including another process winning the CAS) can land
        // after the pipeline publishes but before this terminal transition.
        await removeJobMedia(familiarId, generationId);
      }
    }
  } catch (error) {
    await removeJobMedia(familiarId, generationId);
    if (!active.cancelRequested) {
      await persistFailedJob(familiarId, generationId, error);
    }
  } finally {
    active.stopMonitor?.();
    const state = runnerState();
    if (state.activeByFamiliar.get(familiarId) === active) {
      state.activeByFamiliar.delete(familiarId);
    }
    settle(familiarId, generationId);
  }
}

async function drainFamiliar(familiarId: string): Promise<void> {
  const state = runnerState();
  const releaseLease = await acquireProcessIntentLock({
    intentsDirectory: `${researchGenerationsPath(familiarId)}.runner-locks`,
    label: `research media runner for ${familiarId}`,
  });
  try {
    while (!state.activeByFamiliar.has(familiarId)) {
      const generations = await listResearchGenerations(familiarId);
      const orphaned = generations.find(
        (generation) =>
          isResearchGenerationMediaKind(generation.kind) &&
          generation.status === "rendering",
      );
      if (orphaned) {
        const reconciled = await transitionResearchGeneration(
          familiarId,
          orphaned.id,
          ["rendering"],
          {
            status: "failed",
            stage: null,
            progress: null,
            error: "interrupted by runner ownership loss",
          },
        );
        if (reconciled.ok || reconciled.code === "invalid-state") {
          settle(familiarId, orphaned.id);
        }
        continue;
      }

      const queued = generations
        .filter((generation) => generation.status === "queued")
        .sort(
          (left, right) =>
            left.updatedAt.localeCompare(right.updatedAt) ||
            left.id.localeCompare(right.id),
        )[0];
      if (!queued) return;

      const claimed = await transitionResearchGeneration(
        familiarId,
        queued.id,
        ["queued"],
        {
          status: "rendering",
          stage: "scripting",
          progress: null,
          error: null,
        },
      );
      if (!claimed.ok) continue;

      let definition: ResearchMediaJobDefinition;
      try {
        definition = factoryFor(familiarId)(claimed.generation);
        if (
          definition.familiarId !== familiarId ||
          definition.generationId !== claimed.generation.id
        ) {
          throw new Error(
            "media job factory returned a mismatched generation",
          );
        }
      } catch (error) {
        await persistFailedJob(
          familiarId,
          claimed.generation.id,
          error,
        );
        settle(familiarId, claimed.generation.id);
        continue;
      }

      const active: ActiveJob = {
        definition,
        controller: new AbortController(),
        cancelRequested: false,
        killCalled: false,
      };
      state.activeByFamiliar.set(familiarId, active);
      const stillRendering = await transitionResearchGeneration(
        familiarId,
        claimed.generation.id,
        ["rendering"],
        {},
      );
      if (!stillRendering.ok || active.cancelRequested) {
        if (state.activeByFamiliar.get(familiarId) === active) {
          state.activeByFamiliar.delete(familiarId);
        }
        settle(familiarId, claimed.generation.id);
        continue;
      }
      active.stopMonitor = monitorDurableCancellation(
        familiarId,
        claimed.generation.id,
        active,
      );
      await runActiveJob(familiarId, claimed.generation.id, active);
    }
  } finally {
    await releaseLease();
  }
}

function scheduleDrainRetry(familiarId: string): void {
  const state = runnerState();
  if (state.retryTimersByFamiliar.has(familiarId)) return;
  const failures = (state.drainFailuresByFamiliar.get(familiarId) ?? 0) + 1;
  state.drainFailuresByFamiliar.set(familiarId, failures);
  const delayMs = Math.min(30_000, 250 * 2 ** Math.min(failures - 1, 7));
  const timer = setTimeout(() => {
    if (state.retryTimersByFamiliar.get(familiarId) === timer) {
      state.retryTimersByFamiliar.delete(familiarId);
    }
    scheduleDrain(familiarId);
  }, delayMs);
  timer.unref?.();
  state.retryTimersByFamiliar.set(familiarId, timer);
}

function scheduleDrain(familiarId: string): void {
  const state = runnerState();
  if (
    state.activeByFamiliar.has(familiarId)
  ) {
    return;
  }
  if (state.drainsByFamiliar.has(familiarId)) {
    state.pendingDrainsByFamiliar.add(familiarId);
    return;
  }
  let drain!: Promise<void>;
  drain = (async () => {
    let failed = false;
    try {
      await drainFamiliar(familiarId);
      state.drainFailuresByFamiliar.delete(familiarId);
    } catch (error) {
      failed = true;
      logRunnerError(`queue drain failed for ${familiarId}`, error);
    } finally {
      if (state.drainsByFamiliar.get(familiarId) === drain) {
        state.drainsByFamiliar.delete(familiarId);
      }
      if (state.pendingDrainsByFamiliar.delete(familiarId)) {
        scheduleDrain(familiarId);
      } else if (failed) {
        scheduleDrainRetry(familiarId);
      }
    }
  })();
  state.drainsByFamiliar.set(familiarId, drain);
  void drain;
}

export async function queueResearchMediaGeneration(
  familiarId: string,
  generationId: string,
  factory?: ResearchMediaJobFactory,
): Promise<ResearchMediaQueueResult> {
  const generation = (await listResearchGenerations(familiarId)).find(
    (candidate) => candidate.id === generationId,
  );
  if (!generation) {
    return {
      ok: false,
      code: "not-found",
      error: "generation not found",
    };
  }
  if (!isResearchGenerationMediaKind(generation.kind)) {
    return {
      ok: false,
      code: "not-media",
      error: "generation is not a media kind",
      generation,
    };
  }
  if (generation.status !== "draft") {
    return {
      ok: false,
      code: "invalid-state",
      error: "generation is not a reviewable media draft",
      generation,
    };
  }
  if (!isRenderableDraft(generation)) {
    return {
      ok: false,
      code: "invalid-draft",
      error: "media draft is missing validated content or render configuration",
      generation,
    };
  }
  if (factory) runnerState().factoryByFamiliar.set(familiarId, factory);
  const transitioned = await transitionResearchGeneration(
    familiarId,
    generationId,
    ["draft"],
    {
      status: "queued",
      stage: null,
      progress: null,
      error: null,
    },
  );
  if (!transitioned.ok) {
    return {
      ok: false,
      code: transitioned.code,
      error:
        transitioned.code === "not-found"
          ? "generation not found"
          : "generation is no longer a reviewable media draft",
      generation: transitioned.generation,
    };
  }

  const deferred = deferredFor(familiarId, generationId);
  scheduleDrain(familiarId);
  return {
    ok: true,
    generation: transitioned.generation,
    done: deferred.promise,
  };
}

export async function cancelResearchMediaJob(
  familiarId: string,
  generationId: string,
): Promise<ResearchMediaCancelResult> {
  const cancelled = await transitionResearchGeneration(
    familiarId,
    generationId,
    ["queued", "rendering"],
    {
      status: "cancelled",
      stage: null,
      progress: null,
      error: null,
    },
  );
  if (!cancelled.ok) {
    return {
      ok: false,
      code: cancelled.code,
      error:
        cancelled.code === "not-found"
          ? "generation not found"
          : "only queued or rendering generations can be cancelled",
      generation: cancelled.generation,
    };
  }

  const state = runnerState();
  const active = state.activeByFamiliar.get(familiarId);
  if (active?.definition.generationId === generationId) {
    stopActiveJob(active);
  }
  settle(familiarId, generationId);
  scheduleDrain(familiarId);
  return { ok: true, generation: cancelled.generation };
}

async function recoverAndDrain(factory?: ResearchMediaJobFactory): Promise<void> {
  const state = runnerState();
  if (factory) state.defaultFactory = factory;
  const familiarIds = await listResearchGenerationFamiliarIds();
  await Promise.all(
    familiarIds.map(async (familiarId) => {
      if (factory) state.factoryByFamiliar.set(familiarId, factory);
      scheduleDrain(familiarId);
    }),
  );
}

export function startResearchMediaJobs(
  factory?: ResearchMediaJobFactory,
): Promise<void> {
  const state = runnerState();
  if (factory) state.defaultFactory = factory;
  if (!state.startupPromise) {
    const startup = recoverAndDrain(factory);
    let guarded!: Promise<void>;
    guarded = startup.catch((error) => {
      if (state.startupPromise === guarded) state.startupPromise = undefined;
      throw error;
    });
    state.startupPromise = guarded;
  }
  return state.startupPromise;
}
