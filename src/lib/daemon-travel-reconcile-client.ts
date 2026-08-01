import { TRAVEL_HUB_UNREACHABLE_MS } from "./travel-client-state.ts";

export type DaemonTravelReconcileRequest = (input: { signal: AbortSignal }) => Promise<void>;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export type DaemonTravelReconcileRequester = {
  trigger(): void;
  setHubOutageActive(active: boolean): void;
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
  let hubOutageActive = false;
  let outageTimer: Handle | null = null;
  let active: { controller: AbortController; promise: Promise<void> } | null = null;

  function clearOutageTimer(): void {
    if (outageTimer === null) return;
    const handle = outageTimer;
    outageTimer = null;
    cancelSchedule(handle);
  }

  function armHubOutageTimer(): void {
    if (stopped || !hubOutageActive || outageTimer !== null) return;
    let handle: Handle | null = null;
    handle = schedule(() => {
      if (outageTimer !== handle) return;
      outageTimer = null;
      if (stopped || !hubOutageActive) return;
      trigger();
      armHubOutageTimer();
    }, outageIntervalMs);
    outageTimer = handle;
  }

  function start(): void {
    if (stopped || active) return;
    const controller = new AbortController();
    const request = {
      controller,
      promise: Promise.resolve()
        .then(() => input.request({ signal: controller.signal }))
        .catch(() => {})
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
    if (stopped) return;
    if (active) {
      trailing = true;
      return;
    }
    start();
  }

  return {
    trigger,

    setHubOutageActive(nextActive: boolean): void {
      if (stopped || hubOutageActive === nextActive) return;
      hubOutageActive = nextActive;
      if (!hubOutageActive) {
        clearOutageTimer();
        return;
      }
      trigger();
      armHubOutageTimer();
    },

    stop(): void {
      stopped = true;
      hubOutageActive = false;
      clearOutageTimer();
      trailing = false;
      const current = active;
      active = null;
      current?.controller.abort();
    },
  };
}
