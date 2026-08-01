import { TRAVEL_HUB_UNREACHABLE_MS } from "./travel-client-state.ts";

export type DaemonTravelReconcileRequest = (input: { signal: AbortSignal }) => Promise<void>;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
export type DaemonTravelObservedHubState = "unreachable" | "reachable" | "inactive";

export type DaemonTravelReconcileRequester = {
  observeHubState(state: DaemonTravelObservedHubState): void;
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
  let trailing = false;
  let observedHubState: DaemonTravelObservedHubState = "inactive";
  let reachableTriggerNeeded = false;
  let reachableRetryNeeded = false;
  let outageTimer: Handle | null = null;
  let active: { controller: AbortController; promise: Promise<void> } | null = null;

  function clearOutageTimer(): void {
    if (outageTimer === null) return;
    const handle = outageTimer;
    outageTimer = null;
    cancelSchedule(handle);
  }

  function armHubOutageTimer(): void {
    if (stopped || observedHubState !== "unreachable" || outageTimer !== null) return;
    let handle: Handle | null = null;
    handle = schedule(() => {
      if (outageTimer !== handle) return;
      outageTimer = null;
      if (stopped || observedHubState !== "unreachable") return;
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
    if (stopped || active || !requestNeeded()) return;
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
          if (active?.controller === controller) active = null;
          if (stopped || !trailing) {
            trailing = false;
            return;
          }
          trailing = false;
          start();
        }),
    };
    active = request;
    request.promise.catch(() => {});
  }

  function trigger(): void {
    if (stopped || !requestNeeded()) return;
    if (active) {
      trailing = true;
      return;
    }
    start();
  }

  return {
    observeHubState(nextState: DaemonTravelObservedHubState): void {
      if (stopped) return;
      if (observedHubState === nextState) {
        if (nextState === "unreachable") {
          armHubOutageTimer();
          return;
        }
        if (nextState === "reachable" && reachableRetryNeeded) {
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
        trigger();
        return;
      }

      reachableTriggerNeeded = false;
      reachableRetryNeeded = false;
      trigger();
      armHubOutageTimer();
    },

    trigger,

    stop(): void {
      stopped = true;
      observedHubState = "inactive";
      clearOutageTimer();
      trailing = false;
      reachableTriggerNeeded = false;
      reachableRetryNeeded = false;
      const current = active;
      active = null;
      current?.controller.abort();
    },
  };
}
