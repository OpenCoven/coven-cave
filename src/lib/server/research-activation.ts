// The process-local activation owner for the optional Research runtime
// (#6332). Installation is fixed at build time and the environment setting is
// read per request; this owner is the third gate, the one that can change
// while the server runs. Disabling it closes admission first: every Research
// route and the optional GitHub snapshot refuse with the existing 503
// `research-disabled` before any implementation loads. Only then does the
// owner ask the loaded package to stop, when it can.
//
// The outcome of a stop is retained and never retried or replayed. Admitted
// media jobs are the package's durable records; Cave neither cancels nor
// re-queues them here. A package without `stopResearchRuntime` (host contract
// 2 as shipped in @opencoven/research 0.2.0) reports `unsupported`: its
// workers end with the process, and the shutdown coordinator reports that
// honestly as a failed drain rather than a completed one.
import { researchCapability, type ResearchCapability } from '../research-capability.ts';
import {
  loadCompatibleResearchRuntime,
  loadResearchRuntime,
  type ResearchRuntime,
  type ResearchRuntimeLoader,
} from './research-runtime-loader.ts';
import { isStartupWorkerShutdownRequested } from './startup-worker-shutdown.ts';

export type ResearchActivationState = 'inactive' | 'starting' | 'active' | 'stopping' | 'disabled';
export type ResearchTeardownOutcome =
  | { status: 'inactive' }
  | { status: 'drained' }
  | { status: 'unsupported'; error: string }
  | { status: 'failed'; error: string };
export type ResearchActivation = {
  state: ResearchActivationState;
  lastTeardown: ResearchTeardownOutcome | null;
};

export const RESEARCH_STOP_UNSUPPORTED =
  'This Research package cannot stop its workers while Cave runs. Admitted media jobs continue until Cave restarts; their records stay durable and are not replayed.';

type Owner = {
  state: ResearchActivationState;
  /** Bumped by every start and stop; a step whose revision is stale does nothing. */
  revision: number;
  /** The loaded module once a start has been issued to it, cleared by the stop that owns it. */
  runtime?: ResearchRuntime;
  starting?: Promise<void>;
  stopping?: Promise<ResearchTeardownOutcome>;
  lastTeardown: ResearchTeardownOutcome | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __caveResearchActivation: Owner | undefined;
}

function owner(): Owner {
  return globalThis.__caveResearchActivation ??= { state: 'inactive', revision: 0, lastTeardown: null };
}

export function researchActivation(): ResearchActivation {
  const current = owner();
  return { state: current.state, lastTeardown: current.lastTeardown };
}

/** The capability a request sees: the build and environment gates, then this owner. */
export function withResearchActivation(capability: ResearchCapability): ResearchCapability {
  const { state } = owner();
  if (!capability.enabled || (state !== 'stopping' && state !== 'disabled')) return capability;
  return { ...capability, enabled: false, reason: 'disabled' };
}

/**
 * Activate Research once. Concurrent callers join the one start in flight;
 * an active owner is left alone; a disabled owner is reactivated. A failed
 * start leaves the owner inactive so a later deliberate start may try again.
 * The error is the fixed load/compatibility message or the package's own
 * startup failure, passed through unchanged.
 */
export function startOptionalResearch(
  capability = researchCapability(),
  load: ResearchRuntimeLoader = loadResearchRuntime,
): Promise<void> {
  if (!capability.enabled || isStartupWorkerShutdownRequested()) return Promise.resolve();
  const current = owner();
  if (current.state === 'active') return Promise.resolve();
  if (current.state === 'starting' && current.starting) return current.starting;
  const revision = ++current.revision;
  current.state = 'starting';
  const previous = current.stopping ?? Promise.resolve();
  const starting = previous.then(async () => {
    if (current.revision !== revision) return;
    const result = await loadCompatibleResearchRuntime(load);
    if (current.revision !== revision) return;
    if (!result.ok) {
      current.state = 'inactive';
      throw new Error(result.error);
    }
    // Record the module before the package starts: a stop fenced behind this
    // start must find it, so workers started here are the workers it stops.
    current.runtime = result.runtime;
    try {
      await result.runtime.startResearchRuntime();
    } catch (error) {
      if (current.revision === revision) {
        current.runtime = undefined;
        current.state = 'inactive';
      }
      throw error;
    }
    if (current.revision === revision) current.state = 'active';
  });
  current.starting = starting;
  const settled = () => {
    if (current.starting === starting) current.starting = undefined;
  };
  void starting.then(settled, settled);
  return starting;
}

/**
 * Disable Research now. Admission closes synchronously; the retained outcome
 * says what became of the package's workers. A stop that arrives during a
 * start waits for that start, then stops what it started. A second stop while
 * one is in flight joins it; a stop after one has settled returns the retained
 * outcome without asking the package again.
 */
export function stopOptionalResearch(): Promise<ResearchTeardownOutcome> {
  const current = owner();
  if (current.stopping) return current.stopping;
  if (current.state === 'disabled' && current.lastTeardown && !current.runtime) {
    return Promise.resolve(current.lastTeardown);
  }
  const revision = ++current.revision;
  current.state = 'stopping';
  const started = current.starting ?? Promise.resolve();
  const stopping = started.then(() => undefined, () => undefined).then(async (): Promise<ResearchTeardownOutcome> => {
    const runtime = current.runtime;
    current.runtime = undefined;
    let outcome: ResearchTeardownOutcome;
    if (!runtime) {
      outcome = { status: 'inactive' };
    } else if (typeof runtime.stopResearchRuntime !== 'function') {
      outcome = { status: 'unsupported', error: RESEARCH_STOP_UNSUPPORTED };
    } else {
      try {
        await runtime.stopResearchRuntime();
        outcome = { status: 'drained' };
      } catch (error) {
        outcome = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    current.lastTeardown = outcome;
    if (current.revision === revision) current.state = 'disabled';
    return outcome;
  });
  current.stopping = stopping;
  const settled = () => {
    if (current.stopping === stopping) current.stopping = undefined;
  };
  void stopping.then(settled, settled);
  return stopping;
}

/**
 * The stop the shutdown coordinator registers. `drained` there means the
 * registered callback completed: admission closed and the package's stop,
 * when it has one, finished. A package without a stop leaves the process to
 * end its workers; that is logged once so the gap is visible in the server
 * log, and it is not turned into a failed quit. A rejecting package stop is
 * a failure and is reported as one.
 */
export async function stopOptionalResearchForShutdown(): Promise<void> {
  const outcome = await stopOptionalResearch();
  if (outcome.status === 'failed') throw new Error(outcome.error);
  if (outcome.status === 'unsupported') {
    console.warn('[research] Admission closed for shutdown; the installed package has no stop, so its media jobs were not drained:', outcome.error);
  }
}
