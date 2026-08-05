import { TRAVEL_HUB_UNREACHABLE_MS } from "./travel-client-state.ts";

export type DaemonTravelReconcileRequestResult = {
  retryAfterMs?: number | null;
};

export type DaemonTravelReconcileRequest = (
  input: { signal: AbortSignal },
) => Promise<void | DaemonTravelReconcileRequestResult>;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
export type DaemonTravelObservedHubState = "unreachable" | "reachable" | "inactive";

export type DaemonTravelReconcileRequester = {
  observeHubState(state: DaemonTravelObservedHubState): void;
  setActive(active: boolean): void;
  trigger(): void;
  stop(): void;
};

type CreateDaemonTravelReconcileRequesterDependencies<Handle> = {
  request: DaemonTravelReconcileRequest;
  schedule?: (callback: () => void, delayMs: number) => Handle;
  cancelSchedule?: (handle: Handle) => void;
  outageIntervalMs?: number;
};

const DEFAULT_SCHEDULE = (callback: () => void, delayMs: number) =>
  globalThis.setTimeout(callback, delayMs);
const DEFAULT_CANCEL_SCHEDULE = (handle: TimerHandle) => globalThis.clearTimeout(handle);
const REACHABLE_RETRY_BASE_MS = 1_000;
const REACHABLE_RETRY_MAX_MS = 15_000;

export function createDaemonTravelReconcileRequester<Handle = TimerHandle>(
  input: CreateDaemonTravelReconcileRequesterDependencies<Handle>,
): DaemonTravelReconcileRequester {
  const schedule = input.schedule ??
    (DEFAULT_SCHEDULE as unknown as (callback: () => void, delayMs: number) => Handle);
  const cancelSchedule = input.cancelSchedule ??
    (DEFAULT_CANCEL_SCHEDULE as unknown as (handle: Handle) => void);
  const outageIntervalMs = Number.isFinite(input.outageIntervalMs) && (input.outageIntervalMs ?? 0) > 0
    ? Math.floor(input.outageIntervalMs!)
    : TRAVEL_HUB_UNREACHABLE_MS;

  let stopped = false;
  let requesterActive = true;
  let trailing = false;
  let observedHubState: DaemonTravelObservedHubState = "inactive";
  let reachableTriggerNeeded = false;
  let reachableRetryNeeded = false;
  let reachablePollNeeded = false;
  let reachablePollTimer: Handle | null = null;
  let reachablePollBackoffMs = REACHABLE_RETRY_BASE_MS;
  let outageTimer: Handle | null = null;
  let activeRequest: { controller: AbortController; promise: Promise<void> } | null = null;

  function clearOutageTimer(): void {
    if (outageTimer === null) return;
    const handle = outageTimer;
    outageTimer = null;
    cancelSchedule(handle);
  }

  function clearReachablePollTimer(options: {
    resetBackoff: boolean;
    preservePending?: boolean;
  }): void {
    const pending = reachablePollNeeded || reachablePollTimer !== null;
    if (reachablePollTimer !== null) {
      const handle = reachablePollTimer;
      reachablePollTimer = null;
      cancelSchedule(handle);
    }
    reachablePollNeeded = options.preservePending ? pending : false;
    if (options.resetBackoff) reachablePollBackoffMs = REACHABLE_RETRY_BASE_MS;
  }

  function armReachablePollTimer(result?: void | DaemonTravelReconcileRequestResult): void {
    const requestedDelay = Number.isFinite(result?.retryAfterMs) && (result?.retryAfterMs ?? 0) >= 0
      ? Math.floor(result!.retryAfterMs!)
      : REACHABLE_RETRY_BASE_MS;
    const delayMs = Math.min(
      REACHABLE_RETRY_MAX_MS,
      Math.max(requestedDelay, reachablePollBackoffMs),
    );
    clearReachablePollTimer({ resetBackoff: false });
    if (stopped || !requesterActive || observedHubState !== "reachable") return;
    let handle: Handle | null = null;
    handle = schedule(() => {
      if (reachablePollTimer !== handle) return;
      reachablePollTimer = null;
      if (stopped || !requesterActive || observedHubState !== "reachable") return;
      reachablePollNeeded = true;
      trigger();
    }, delayMs);
    reachablePollTimer = handle;
    reachablePollBackoffMs = Math.min(REACHABLE_RETRY_MAX_MS, Math.max(delayMs * 2, REACHABLE_RETRY_BASE_MS));
  }

  function armHubOutageTimer(): void {
    if (stopped || !requesterActive || observedHubState !== "unreachable" || outageTimer !== null) return;
    let handle: Handle | null = null;
    handle = schedule(() => {
      if (outageTimer !== handle) return;
      outageTimer = null;
      if (stopped || !requesterActive || observedHubState !== "unreachable") return;
      trigger();
      armHubOutageTimer();
    }, outageIntervalMs);
    outageTimer = handle;
  }

  function requestNeeded(): boolean {
    if (observedHubState === "unreachable") return true;
    if (observedHubState === "reachable") {
      return reachableTriggerNeeded || reachableRetryNeeded || reachablePollNeeded;
    }
    return false;
  }

  function start(): void {
    if (stopped || !requesterActive || activeRequest || !requestNeeded()) return;
    const controller = new AbortController();
    const startedForReachableObservation = observedHubState === "reachable";
    if (startedForReachableObservation) {
      reachableTriggerNeeded = false;
      reachableRetryNeeded = false;
      reachablePollNeeded = false;
    }
    const request = {
      controller,
      promise: Promise.resolve()
        .then(() => input.request({ signal: controller.signal }))
        .then((result) => {
          if (controller.signal.aborted || observedHubState !== "reachable") return;
          if (result && Number.isFinite(result.retryAfterMs) && (result.retryAfterMs ?? 0) >= 0) {
            armReachablePollTimer(result);
            return;
          }
          clearReachablePollTimer({ resetBackoff: true });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          clearReachablePollTimer({ resetBackoff: true });
          if (observedHubState === "reachable") {
            reachableRetryNeeded = true;
          }
        })
        .finally(() => {
          if (activeRequest?.controller === controller) activeRequest = null;
          if (stopped || !requesterActive || !trailing) {
            trailing = false;
            return;
          }
          trailing = false;
          start();
        }),
    };
    activeRequest = request;
    request.promise.catch(() => {});
  }

  function trigger(): void {
    if (stopped || !requesterActive) return;
    if (activeRequest) {
      if (observedHubState === "reachable") reachableTriggerNeeded = true;
      trailing = true;
      return;
    }
    if (!requestNeeded()) return;
    start();
  }

  function abortActiveRequest(options: { preserveReachableRetry: boolean }): void {
    const current = activeRequest;
    activeRequest = null;
    if (!current) return;
    if (options.preserveReachableRetry && observedHubState === "reachable") {
      reachableRetryNeeded = true;
      reachableTriggerNeeded = false;
    }
    current.controller.abort();
  }

  return {
    observeHubState(nextState: DaemonTravelObservedHubState): void {
      if (stopped) return;
      if (observedHubState === nextState) {
        if (!requesterActive) return;
        if (nextState === "unreachable") {
          armHubOutageTimer();
          return;
        }
        if (nextState === "reachable" && (reachableTriggerNeeded || reachableRetryNeeded)) {
          trigger();
        }
        return;
      }

      observedHubState = nextState;
      if (nextState === "inactive") {
        clearOutageTimer();
        clearReachablePollTimer({ resetBackoff: true });
        trailing = false;
        reachableTriggerNeeded = false;
        reachableRetryNeeded = false;
        return;
      }

      if (nextState === "reachable") {
        clearOutageTimer();
        reachableTriggerNeeded = true;
        if (!requesterActive) return;
        trigger();
        return;
      }

      clearReachablePollTimer({ resetBackoff: true });
      reachableTriggerNeeded = false;
      reachableRetryNeeded = false;
      if (!requesterActive) return;
      trigger();
      armHubOutageTimer();
    },

    setActive(nextActive: boolean): void {
      if (stopped || requesterActive === nextActive) return;
      requesterActive = nextActive;
      if (!requesterActive) {
        clearOutageTimer();
        clearReachablePollTimer({ resetBackoff: true, preservePending: true });
        trailing = false;
        abortActiveRequest({ preserveReachableRetry: true });
        return;
      }
      if (observedHubState === "unreachable") {
        trigger();
        armHubOutageTimer();
        return;
      }
      if (
        observedHubState === "reachable" &&
        (reachableRetryNeeded || reachablePollNeeded)
      ) {
        trigger();
      }
    },

    trigger,

    stop(): void {
      stopped = true;
      requesterActive = false;
      observedHubState = "inactive";
      clearOutageTimer();
      clearReachablePollTimer({ resetBackoff: true });
      trailing = false;
      reachableTriggerNeeded = false;
      reachableRetryNeeded = false;
      abortActiveRequest({ preserveReachableRetry: false });
    },
  };
}
