import {
  projectDaemonLifecycle,
  type DaemonLifecycle,
  type DaemonLifecycleEvidence,
  type DaemonLifecycleOperation,
  type DaemonRuntimeEvidence,
} from "../daemon-lifecycle.ts";

/**
 * The one process-wide record of daemon lifecycle evidence (#6298). Routes
 * project a state from a fresh probe plus what this owner remembers: the
 * start or recovery mutation in flight, whether a ready daemon was ever
 * observed, and the last answer about the local runtime.
 *
 * Process-global like the startup workers: Next can evaluate this module in
 * more than one bundle, and a second copy that forgot the in-flight operation
 * would report `stopped` while a start is still running.
 */
type DaemonLifecycleOwner = {
  generation: number;
  operation: (DaemonLifecycleOperation & { token: number }) | null;
  operationToken: number;
  lastReadyAt: number | null;
  runtime: { evidence: DaemonRuntimeEvidence; checkedAt: number } | null;
  runtimePending: Promise<DaemonRuntimeEvidence> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __caveDaemonLifecycleOwner: DaemonLifecycleOwner | undefined;
}

const RUNTIME_EVIDENCE_TTL_MS = 30_000;

function owner(): DaemonLifecycleOwner {
  return globalThis.__caveDaemonLifecycleOwner ??= {
    generation: 0,
    operation: null,
    operationToken: 0,
    lastReadyAt: null,
    runtime: null,
    runtimePending: null,
  };
}

export type DaemonLifecycleOperationHandle = {
  end(): void;
  /** Mark or clear the stopping phase; a stale handle touches nothing. */
  phase(phase: DaemonLifecycleOperation["phase"] | null): void;
};

/** Record the start, recovery or restart now in flight. Ending is idempotent. */
export function beginDaemonLifecycleOperation(
  kind: DaemonLifecycleOperation["kind"],
  now: () => number = Date.now,
): DaemonLifecycleOperationHandle {
  const state = owner();
  const token = ++state.operationToken;
  state.operation = { kind, startedAt: new Date(now()).toISOString(), token };
  return {
    end() {
      if (state.operation?.token === token) state.operation = null;
    },
    phase(phase) {
      const current = state.operation;
      if (current?.token !== token) return;
      if (phase) current.phase = phase;
      else delete current.phase;
    },
  };
}

export function daemonLifecycleOperation(): DaemonLifecycleOperation | null {
  const current = owner().operation;
  if (!current) return null;
  return {
    kind: current.kind,
    startedAt: current.startedAt,
    ...(current.phase ? { phase: current.phase } : {}),
  };
}

type RuntimeEvidenceOptions = {
  /** Resolves the installed runtime version, or null when it cannot run. */
  probe: () => Promise<string | null>;
  now?: () => number;
};

/**
 * Whether the local Coven runtime exists, probed at most once per window.
 * The answer is remembered so a connection snapshot, which never spawns
 * anything, can reuse what the status route last proved.
 */
export async function localRuntimeEvidence(options: RuntimeEvidenceOptions): Promise<DaemonRuntimeEvidence> {
  const state = owner();
  const now = options.now ?? Date.now;
  const current = now();
  if (state.runtime && isFreshRuntimeEvidence(state.runtime.checkedAt, current)) {
    return state.runtime.evidence;
  }
  if (state.runtimePending) return state.runtimePending;
  // Only one probe runs at a time: a fresh answer returns above and an
  // in-flight one is shared, so clearing unconditionally cannot drop a newer
  // probe.
  const pending = (async () => {
    try {
      const version = await options.probe();
      const evidence: DaemonRuntimeEvidence = version ? "present" : "missing";
      state.runtime = { evidence, checkedAt: now() };
      return evidence;
    } finally {
      state.runtimePending = null;
    }
  })();
  state.runtimePending = pending;
  return pending;
}

/** An answer stamped in the future (clock corrected backwards) is not fresh. */
function isFreshRuntimeEvidence(checkedAt: number, now: number): boolean {
  const age = now - checkedAt;
  return age >= 0 && age < RUNTIME_EVIDENCE_TTL_MS;
}

function rememberedRuntimeEvidence(state: DaemonLifecycleOwner, now: number): DaemonRuntimeEvidence {
  if (!state.runtime) return "unknown";
  return isFreshRuntimeEvidence(state.runtime.checkedAt, now) ? state.runtime.evidence : "unknown";
}

export type DaemonLifecycleProbeInput = Pick<
  DaemonLifecycleEvidence,
  "targetMode" | "availability" | "serviceConflict" | "reason"
>;

/**
 * Project the lifecycle for one probe result and record what it proves. The
 * generation is assigned here so every observation this process emits can be
 * ordered, and a ready daemon is remembered so a later start reads as recovery.
 */
export function observeDaemonLifecycle(
  input: DaemonLifecycleProbeInput,
  options: { now?: () => number } = {},
): DaemonLifecycle {
  const state = owner();
  const now = (options.now ?? Date.now)();
  const local = input.targetMode === "local";
  const evidence: DaemonLifecycleEvidence = {
    targetMode: input.targetMode,
    availability: input.availability,
    runtime: local ? rememberedRuntimeEvidence(state, now) : "unknown",
    serviceConflict: local ? input.serviceConflict : null,
    operation: local ? daemonLifecycleOperation() : null,
    previouslyReady: local && state.lastReadyAt !== null,
    reason: input.reason ?? null,
  };
  const projection = projectDaemonLifecycle(evidence);
  if (projection.state === "ready" && local) state.lastReadyAt = now;
  state.generation += 1;
  return {
    ...projection,
    generation: state.generation,
    observedAt: new Date(now).toISOString(),
  };
}

export function resetDaemonLifecycleOwnerForTests(): void {
  globalThis.__caveDaemonLifecycleOwner = undefined;
}
