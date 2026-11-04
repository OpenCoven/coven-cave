import { classifyDaemonStatusPoll } from "./daemon-status-classification.ts";
import {
  classifyDaemonConnectionFailure,
  type DaemonReliabilityMeasurementInput,
} from "./daemon-reliability.ts";

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
  observe?: (measurement: DaemonReliabilityMeasurementInput) => void;
  schedule?: (callback: () => void, delayMs: number) => Handle;
  cancelSchedule?: (handle: Handle) => void;
  random?: () => number;
  isVisible?: () => boolean;
  now?: () => number;
};

type ActiveRequest = {
  generation: number;
  episodeId: number;
  controller: AbortController;
  promise: Promise<void>;
};

const DEFAULT_SCHEDULE = (callback: () => void, delayMs: number) =>
  globalThis.setTimeout(callback, delayMs);
const DEFAULT_CANCEL_SCHEDULE = (handle: TimerHandle) => globalThis.clearTimeout(handle);
const DEFAULT_RANDOM = () => Math.random();
const DEFAULT_VISIBLE = () => true;
const DEFAULT_NOW = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();
const FRONTEND_RECONNECT_TIMEOUT_MS = 30_000;
// The server health probe is bounded to 1.5s (3s hard transport deadline).
// Leave room for server work while bounding the entire HTTP read, including JSON.
const STATUS_READ_TIMEOUT_MS = 10_000;

function normalizedRandomSample(random: () => number): number {
  const sample = random();
  if (!Number.isFinite(sample)) return 0.5;
  if (sample < 0) return 0;
  if (sample > 1) return 1;
  return sample;
}

function fallbackUnavailablePoll(error = "status request failed"): DaemonConnectionPoll {
  return {
    responseStatus: 0,
    responseOk: false,
    payload: null,
    error,
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
  const now = dependencies.now ?? DEFAULT_NOW;

  let started = false;
  let visible = Boolean((dependencies.isVisible ?? DEFAULT_VISIBLE)());
  let failures = 0;
  let generation = 0;
  let timerHandle: Handle | null = null;
  let episodeTimerHandle: Handle | null = null;
  let activeRequest: ActiveRequest | null = null;
  let nextEpisodeId = 1;
  let episodeId: number | null = null;
  let episodeStartedAt: number | null = null;
  let episodeAttempts = 0;
  let episodeFresh = false;
  let episodeHadFailure = false;
  let episodeBackoffMs = 0;
  let hasObservedRunning = false;

  function canRun(): boolean {
    return started && visible;
  }

  function clearTimer(): void {
    if (timerHandle === null) return;
    const handle = timerHandle;
    timerHandle = null;
    cancelSchedule(handle);
  }

  function clearEpisodeTimer(): void {
    if (episodeTimerHandle === null) return;
    const handle = episodeTimerHandle;
    episodeTimerHandle = null;
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
      generation === request.generation;
  }

  function armNextTimer(authoritativeGeneration: number, delayMs: number): boolean {
    let handle: Handle | null = null;
    handle = schedule(() => {
      if (timerHandle !== handle) return;
      timerHandle = null;
      if (!canRun() || activeRequest !== null || generation !== authoritativeGeneration) return;
      const pending = refresh();
      pending.catch(() => {});
    }, delayMs);
    timerHandle = handle;
    return true;
  }

  function resetEpisode(): void {
    clearEpisodeTimer();
    episodeId = null;
    episodeStartedAt = null;
    episodeAttempts = 0;
    episodeFresh = false;
    episodeHadFailure = false;
    episodeBackoffMs = 0;
  }

  function observe(measurement: DaemonReliabilityMeasurementInput): void {
    try {
      dependencies.observe?.(measurement);
    } catch {
      // Measurement hooks cannot change connection supervision.
    }
  }

  function finishEpisode(
    outcome: "success" | "failure" | "blocked" | "cancelled",
    failureClass?: DaemonReliabilityMeasurementInput["failureClass"],
  ): void {
    if (episodeStartedAt === null || episodeAttempts === 0) {
      resetEpisode();
      return;
    }
    observe({
      operation: "frontend_reconnect",
      outcome,
      ...(failureClass ? { failureClass } : {}),
      readiness: outcome === "success" ? "authenticated" : "none",
      durationMs: Math.max(0, now() - episodeStartedAt),
      attempts: episodeAttempts,
      backoffMs: episodeBackoffMs,
      timeoutMs: FRONTEND_RECONNECT_TIMEOUT_MS,
      crashCount: 0,
      restartCount: 0,
    });
    if (outcome === "success") hasObservedRunning = true;
    resetEpisode();
  }

  function beginEpisode(startedAt: number, fresh: boolean): number {
    episodeId = nextEpisodeId;
    nextEpisodeId += 1;
    episodeStartedAt = startedAt;
    episodeAttempts = 0;
    episodeFresh = fresh;
    episodeHadFailure = false;
    episodeBackoffMs = 0;

    const currentEpisodeId = episodeId;
    let handle: Handle | null = null;
    handle = schedule(() => {
      if (episodeTimerHandle !== handle || episodeId !== currentEpisodeId) return;
      episodeTimerHandle = null;
      finishEpisode("failure", "timeout");
    }, FRONTEND_RECONNECT_TIMEOUT_MS);
    episodeTimerHandle = handle;
    return currentEpisodeId;
  }

  function cancelEpisode(): void {
    if (
      episodeStartedAt === null ||
      episodeAttempts === 0 ||
      (hasObservedRunning && !episodeFresh && !episodeHadFailure)
    ) {
      resetEpisode();
      return;
    }
    finishEpisode("cancelled", "cancellation");
  }

  function readStatus(request: ActiveRequest, fresh: boolean): Promise<DaemonConnectionPoll | null> {
    return new Promise((resolve) => {
      let settled = false;
      let deadline: Handle | null = null;
      const signal = request.controller.signal;
      const cancel = () => finish(null);
      const finish = (poll: DaemonConnectionPoll | null) => {
        if (settled) return;
        settled = true;
        if (deadline !== null) cancelSchedule(deadline);
        signal.removeEventListener("abort", cancel);
        resolve(poll);
      };
      signal.addEventListener("abort", cancel, { once: true });
      deadline = schedule(() => {
        if (settled) return;
        // Settle before aborting so a transport's AbortError cannot hide the
        // timeout. Authority is fenced by activeRequest/generation, not signal.
        finish(fallbackUnavailablePoll("status request timed out"));
        request.controller.abort();
      }, STATUS_READ_TIMEOUT_MS);
      const failed = () => finish(signal.aborted ? null : fallbackUnavailablePoll());
      try {
        dependencies.request({ signal, fresh }).then(finish, failed);
      } catch {
        failed();
      }
    });
  }

  function beginRequest(fresh: boolean): Promise<void> {
    const requestStartedAt = now();
    const currentEpisodeId = episodeId ?? beginEpisode(requestStartedAt, fresh);
    episodeFresh ||= fresh;
    episodeAttempts += 1;
    const request: ActiveRequest = {
      generation: generation + 1,
      episodeId: currentEpisodeId,
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    generation = request.generation;
    activeRequest = request;

    const pending = (async () => {
      const poll = await readStatus(request, fresh);
      if (poll === null || !isAuthoritativeRequest(request)) return;

      dependencies.publish(poll, { fresh });
      const status = classifyDaemonStatusPoll(poll);
      // A mutation in flight is polled at the healthy cadence so readiness is
      // noticed promptly; it is not a connection failure to back off from.
      failures = status.kind === "running" || status.kind === "transitioning" ? 0 : failures + 1;
      const delayMs = daemonConnectionPollDelay(failures, random);
      const ownsEpisode = episodeId === request.episodeId;
      if (status.kind !== "running" && ownsEpisode) {
        episodeHadFailure = true;
      }
      if (ownsEpisode && status.kind === "running") {
        if (!hasObservedRunning || episodeFresh || episodeHadFailure) {
          finishEpisode("success");
        } else {
          resetEpisode();
        }
      } else if (status.kind === "running") {
        // The request may outlive its 30-second measurement episode. Its
        // authenticated result still establishes healthy cadence, but the
        // timed-out episode is already terminal and must not emit a success.
        hasObservedRunning = true;
      } else if (ownsEpisode) {
        const failureClass = classifyDaemonConnectionFailure({ poll, status });
        if (failureClass === "contention") finishEpisode("blocked", failureClass);
      }

      if (!isAuthoritativeRequest(request)) return;
      const timerArmed = armNextTimer(request.generation, delayMs);
      if (
        timerArmed &&
        status.kind !== "running" &&
        episodeId === request.episodeId
      ) {
        episodeBackoffMs += delayMs;
      }
    })();

    request.promise = pending.finally(() => {
      if (activeRequest === request) activeRequest = null;
    });
    request.promise.catch(() => {});
    return request.promise;
  }

  function refresh(options: { fresh?: boolean } = {}): Promise<void> {
    if (!canRun()) return Promise.resolve();

    const fresh = options.fresh === true;
    if (activeRequest) {
      if (!fresh) return activeRequest.promise;
      clearTimer();
      const pending = activeRequest;
      activeRequest = null;
      generation += 1;
      pending.controller.abort();
      return beginRequest(fresh);
    }

    clearTimer();
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
      cancelEpisode();
    },

    refresh,

    setVisible(nextVisible: boolean): void {
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (!visible) {
        clearTimer();
        invalidateActiveRequest();
        cancelEpisode();
        return;
      }
      if (!started) return;
      const pending = refresh({ fresh: true });
      pending.catch(() => {});
    },
  };
}
