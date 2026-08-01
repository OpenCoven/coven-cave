import { classifyDaemonStatusPoll } from "./daemon-status-classification.ts";

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export type DaemonConnectionPoll = {
  responseStatus: number;
  responseOk: boolean;
  payload: unknown;
  error?: string;
};

export type DaemonConnectionSupervisor = {
  start(): void;
  stop(): void;
  refresh(options?: { fresh?: boolean }): Promise<void>;
  setVisible(visible: boolean): void;
};

type DaemonConnectionSupervisorDependencies<Handle> = {
  request(input: { signal: AbortSignal; fresh: boolean }): Promise<DaemonConnectionPoll>;
  publish(poll: DaemonConnectionPoll, context: { fresh: boolean }): void;
  schedule?: (callback: () => void, delayMs: number) => Handle;
  cancelSchedule?: (handle: Handle) => void;
  random?: () => number;
  isVisible?: () => boolean;
};

type ActiveRequest = {
  generation: number;
  controller: AbortController;
  promise: Promise<void>;
};

const DEFAULT_SCHEDULE = (callback: () => void, delayMs: number) =>
  globalThis.setTimeout(callback, delayMs);
const DEFAULT_CANCEL_SCHEDULE = (handle: TimerHandle) => globalThis.clearTimeout(handle);
const DEFAULT_RANDOM = () => Math.random();
const DEFAULT_VISIBLE = () => true;

function normalizedRandomSample(random: () => number): number {
  const sample = random();
  if (!Number.isFinite(sample)) return 0.5;
  if (sample < 0) return 0;
  if (sample > 1) return 1;
  return sample;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError";
}

function fallbackUnavailablePoll(): DaemonConnectionPoll {
  return {
    responseStatus: 0,
    responseOk: false,
    payload: null,
    error: "status request failed",
  };
}

export function daemonConnectionPollDelay(
  failures: number,
  random: () => number,
): number {
  const count = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0;
  const baseDelayMs = count <= 1
    ? 5_000
    : count <= 3
    ? 10_000
    : count <= 7
    ? 20_000
    : 30_000;
  const jitterFactor = 0.8 + normalizedRandomSample(random) * 0.4;
  return Math.max(0, Math.round(baseDelayMs * jitterFactor));
}

export function createDaemonConnectionSupervisor<Handle = TimerHandle>(
  dependencies: DaemonConnectionSupervisorDependencies<Handle>,
): DaemonConnectionSupervisor {
  const schedule = dependencies.schedule ??
    (DEFAULT_SCHEDULE as unknown as (callback: () => void, delayMs: number) => Handle);
  const cancelSchedule = dependencies.cancelSchedule ??
    (DEFAULT_CANCEL_SCHEDULE as unknown as (handle: Handle) => void);
  const random = dependencies.random ?? DEFAULT_RANDOM;

  let started = false;
  let visible = Boolean((dependencies.isVisible ?? DEFAULT_VISIBLE)());
  let failures = 0;
  let generation = 0;
  let timerHandle: Handle | null = null;
  let activeRequest: ActiveRequest | null = null;

  function canRun(): boolean {
    return started && visible;
  }

  function clearTimer(): void {
    if (timerHandle === null) return;
    const handle = timerHandle;
    timerHandle = null;
    cancelSchedule(handle);
  }

  function invalidateActiveRequest(): void {
    generation += 1;
    if (!activeRequest) return;
    const pending = activeRequest;
    activeRequest = null;
    pending.controller.abort();
  }

  function isAuthoritativeRequest(request: ActiveRequest): boolean {
    return canRun() &&
      activeRequest === request &&
      generation === request.generation &&
      !request.controller.signal.aborted;
  }

  function armNextTimer(authoritativeGeneration: number): void {
    const delayMs = daemonConnectionPollDelay(failures, random);
    let handle: Handle | null = null;
    handle = schedule(() => {
      if (timerHandle !== handle) return;
      timerHandle = null;
      if (!canRun() || activeRequest !== null || generation !== authoritativeGeneration) return;
      const pending = refresh();
      pending.catch(() => {});
    }, delayMs);
    timerHandle = handle;
  }

  function beginRequest(fresh: boolean): Promise<void> {
    const request: ActiveRequest = {
      generation: generation + 1,
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    generation = request.generation;
    activeRequest = request;

    const pending = (async () => {
      let poll: DaemonConnectionPoll;
      try {
        poll = await dependencies.request({
          signal: request.controller.signal,
          fresh,
        });
      } catch (error) {
        if (request.controller.signal.aborted || isAbortError(error)) return;
        poll = fallbackUnavailablePoll();
      }

      if (!isAuthoritativeRequest(request)) return;

      dependencies.publish(poll, { fresh });
      const status = classifyDaemonStatusPoll(poll);
      failures = status.kind === "running" ? 0 : failures + 1;

      if (!isAuthoritativeRequest(request)) return;
      armNextTimer(request.generation);
    })();

    request.promise = pending.finally(() => {
      if (activeRequest === request) activeRequest = null;
    });
    request.promise.catch(() => {});
    return request.promise;
  }

  function refresh(options: { fresh?: boolean } = {}): Promise<void> {
    clearTimer();
    if (!canRun()) return Promise.resolve();

    const fresh = options.fresh === true;
    if (activeRequest) {
      if (!fresh) return activeRequest.promise;
      const pending = activeRequest;
      activeRequest = null;
      generation += 1;
      pending.controller.abort();
    }

    return beginRequest(fresh);
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      if (!visible) return;
      const pending = refresh();
      pending.catch(() => {});
    },

    stop(): void {
      if (!started) return;
      started = false;
      clearTimer();
      invalidateActiveRequest();
    },

    refresh,

    setVisible(nextVisible: boolean): void {
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (!visible) {
        clearTimer();
        invalidateActiveRequest();
        return;
      }
      if (!started) return;
      const pending = refresh();
      pending.catch(() => {});
    },
  };
}
