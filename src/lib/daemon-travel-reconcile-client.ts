import { TRAVEL_HUB_UNREACHABLE_MS } from "./travel-client-state.ts";

export type DaemonTravelReconcileRequest = (input: { signal: AbortSignal }) => Promise<void>;

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
  let outageTimer: Handle | null = null;
  let activeRequest: { controller: AbortController; promise: Promise<void> } | null = null;

  function clearOutageTimer(): void {
    if (outageTimer === null) return;
    const handle = outageTimer;
    outageTimer = null;
    cancelSchedule(handle);
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
      return reachableTriggerNeeded || reachableRetryNeeded;
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
    }
    const request = {
      controller,
      promise: Promise.resolve()
        .then(() => input.request({ signal: controller.signal }))
        .catch(() => {
          if (controller.signal.aborted) return;
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
    if (stopped || !requesterActive || !requestNeeded()) return;
    if (activeRequest) {
      trailing = true;
      return;
    }
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
        trailing = false;
        abortActiveRequest({ preserveReachableRetry: true });
        return;
      }
      if (observedHubState === "unreachable") {
        trigger();
        armHubOutageTimer();
        return;
      }
      if (observedHubState === "reachable" && reachableRetryNeeded) {
        trigger();
      }
    },

    trigger,

    stop(): void {
      stopped = true;
      requesterActive = false;
      observedHubState = "inactive";
      clearOutageTimer();
      trailing = false;
      reachableTriggerNeeded = false;
      reachableRetryNeeded = false;
      abortActiveRequest({ preserveReachableRetry: false });
    },
  };
}
