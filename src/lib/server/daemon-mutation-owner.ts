/**
 * The one admission point for daemon mutations (#6298 slice 2). Start,
 * automatic recovery and restart all pass through here before anything
 * spawns, kicks launchd or stops a daemon.
 *
 * Rules:
 * - One mutation runs at a time. A start or recovery that arrives while any
 *   mutation runs joins it: every one of them wants a running daemon, and
 *   the in-flight mutation ends with one or with a named failure. A restart
 *   joins only another restart; joining a start would report "restarted"
 *   for a daemon nobody restarted, so it is refused by name instead.
 * - A mutation that timed out is not replayed. Inside the window after a
 *   `readiness_timeout`, the same kind first asks health whether the earlier
 *   attempt finished late (reconcile) and is otherwise refused with the time
 *   left, so a slow service start is never stopped and kicked again.
 *
 * Process-global like the lifecycle owner: Next can evaluate this module in
 * more than one bundle, and a second copy that forgot the in-flight mutation
 * would admit the duplicate it exists to refuse.
 */
export type DaemonMutationKind = "start" | "restart" | "recovery";

export type DaemonMutationRefusal =
  | { code: "mutation_in_flight"; inFlight: DaemonMutationKind }
  | { code: "duplicate_after_timeout"; retryAfterMs: number; previous: DaemonMutationKind };

export type DaemonMutationOutcome = { kind: DaemonMutationKind; code: string; settledAt: number };

type DaemonMutationOwner = {
  inFlight: { kind: DaemonMutationKind; startedAt: number; promise: Promise<unknown> } | null;
  lastOutcome: DaemonMutationOutcome | null;
  reconciliation?: { outcome: DaemonMutationOutcome; promise: Promise<unknown> } | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __caveDaemonMutationOwner: DaemonMutationOwner | undefined;
}

export const DAEMON_MUTATION_TIMEOUT_WINDOW_MS = 30_000;
const TIMEOUT_CODE = "readiness_timeout";

function owner(): DaemonMutationOwner {
  return globalThis.__caveDaemonMutationOwner ??= { inFlight: null, lastOutcome: null };
}

function canJoin(requested: DaemonMutationKind, inFlight: DaemonMutationKind): boolean {
  return requested !== "restart" || inFlight === "restart";
}

export type RunDaemonMutationInput<T> = {
  kind: DaemonMutationKind;
  run: () => Promise<T>;
  /** `"ok"` for success, otherwise the result's failure code. */
  outcome: (result: T) => string;
  /** Health proof that a timed-out mutation finished after its deadline. */
  probeReady: () => Promise<boolean>;
  /** The result for a mutation settled by that proof instead of a replay. */
  reconciled: () => T;
  refused: (refusal: DaemonMutationRefusal) => T;
  timeoutWindowMs?: number;
  now?: () => number;
};

export async function runDaemonMutation<T>(input: RunDaemonMutationInput<T>): Promise<T> {
  const state = owner();
  const now = input.now ?? Date.now;
  const windowMs = input.timeoutWindowMs ?? DAEMON_MUTATION_TIMEOUT_WINDOW_MS;

  if (state.inFlight) {
    if (canJoin(input.kind, state.inFlight.kind)) return state.inFlight.promise as Promise<T>;
    return input.refused({ code: "mutation_in_flight", inFlight: state.inFlight.kind });
  }

  const last = state.lastOutcome;
  if (last && last.code === TIMEOUT_CODE && last.kind === input.kind) {
    // A wall clock corrected backwards (sleep/wake) must not stretch the
    // refusal: a timestamp from the future is re-stamped to now, so one
    // window after the jump is the ceiling.
    const current = now();
    if (current < last.settledAt) last.settledAt = current;
    const elapsed = current - last.settledAt;
    if (elapsed < windowMs) {
      if (state.reconciliation?.outcome === last) {
        return state.reconciliation.promise as Promise<T>;
      }
      const reconciliation = { outcome: last, promise: Promise.resolve() as Promise<unknown> };
      const promise = Promise.resolve().then(async () => {
        const ready = await input.probeReady();
        // Both positive and negative health results belong to the timeout we
        // probed. Re-enter admission if another mutation ran while we waited;
        // never settle or refuse using evidence from its predecessor.
        if (state.inFlight || state.lastOutcome !== last) {
          return runDaemonMutation(input);
        }
        if (ready) {
          state.lastOutcome = { kind: input.kind, code: "ok", settledAt: now() };
          return input.reconciled();
        }
        return input.refused({
          code: "duplicate_after_timeout",
          retryAfterMs: Math.max(1, windowMs - elapsed),
          previous: last.kind,
        });
      }).finally(() => {
        if (state.reconciliation === reconciliation) state.reconciliation = null;
      });
      reconciliation.promise = promise;
      state.reconciliation = reconciliation;
      return promise;
    }
  }

  const entry: NonNullable<DaemonMutationOwner["inFlight"]> = {
    kind: input.kind,
    startedAt: now(),
    promise: Promise.resolve(),
  };
  // Publish the lane before invoking user code, including synchronous throws.
  const promise = Promise.resolve().then(async () => {
    try {
      const result = await input.run();
      state.lastOutcome = { kind: input.kind, code: input.outcome(result), settledAt: now() };
      return result;
    } catch (error) {
      state.lastOutcome = { kind: input.kind, code: "unexpected-error", settledAt: now() };
      throw error;
    } finally {
      if (state.inFlight === entry) state.inFlight = null;
    }
  });
  entry.promise = promise;
  state.inFlight = entry;
  return promise;
}

export function daemonMutationOwnerSnapshot(): {
  inFlight: { kind: DaemonMutationKind; startedAt: number } | null;
  lastOutcome: DaemonMutationOutcome | null;
} {
  const state = owner();
  return {
    inFlight: state.inFlight ? { kind: state.inFlight.kind, startedAt: state.inFlight.startedAt } : null,
    lastOutcome: state.lastOutcome ? { ...state.lastOutcome } : null,
  };
}

export function resetDaemonMutationOwnerForTests(): void {
  globalThis.__caveDaemonMutationOwner = undefined;
}
