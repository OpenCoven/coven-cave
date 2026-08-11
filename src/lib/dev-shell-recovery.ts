/**
 * Dev-shell recovery: keeping the desktop window honest about a dead dev server.
 *
 * When the Next/Turbopack dev server dies or restarts under a running Tauri
 * window, the WebView keeps the last-rendered document. Any navigation or lazy
 * import then fails — a raw `ChunkLoadError` if the server is gone, or a stale
 * chunk id if it came back with a fresh build. Neither of the app's error
 * boundaries can help: `reset()` cannot refetch, and a reload lands on
 * `ERR_CONNECTION_REFUSED`.
 *
 * This module owns the decision-making only; the DOM lives in the component so
 * every transition here stays testable without a browser.
 */

export type DevShellRecoveryState =
  /** Nothing has failed, or a probe proved the origin is fine. */
  | "healthy"
  /** A recoverable failure was seen; probing the origin right now. */
  | "checking"
  /** The origin refused the probe; polling until it comes back. */
  | "unreachable"
  /** The origin answered; a hard reload is in flight. */
  | "reloading";

const RECOVERABLE_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk \S+ failed/i,
  /Loading CSS chunk \S+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Failed to load (?:script|resource|chunk)/i,
];

function messageOf(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (reason && typeof reason === "object") {
    const record = reason as { name?: unknown; message?: unknown };
    const name = typeof record.name === "string" ? record.name : "";
    const message = typeof record.message === "string" ? record.message : "";
    if (name || message) return `${name}: ${message}`;
  }
  return "";
}

/**
 * Only failures that a reload can actually cure. Ordinary app exceptions must
 * fall through to the real error boundaries, which give a far better report.
 */
export function isRecoverableShellFailure(reason: unknown): boolean {
  const message = messageOf(reason);
  if (!message) return false;
  return RECOVERABLE_PATTERNS.some((pattern) => pattern.test(message));
}

const PROBE_BACKOFF_MS = [500, 1000, 2000, 3000, 5000];

/** Poll quickly at first — most dev restarts finish in a second or two. */
export function nextProbeDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), PROBE_BACKOFF_MS.length - 1);
  return PROBE_BACKOFF_MS[index];
}

/**
 * A reload that immediately fails the same way would spin forever, so a reload
 * is only automatic when the previous one is old enough to have been a genuine
 * recovery rather than part of a loop.
 */
export const RELOAD_LOOP_WINDOW_MS = 10_000;

export interface DevShellRecoveryOptions {
  /** Resolves true when the dev origin serves a request again. */
  probe: () => Promise<boolean>;
  /** Hard-reloads the document, dropping stale Turbopack chunk ids. */
  reload: () => void;
  onStateChange?: (state: DevShellRecoveryState) => void;
  /** Epoch ms of the last recovery reload, or null when there was none. */
  readLastReloadAt?: () => number | null;
  writeLastReloadAt?: (at: number) => void;
  now?: () => number;
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DevShellRecoveryController {
  readonly state: DevShellRecoveryState;
  /** True when a reload was suppressed to avoid a reload loop. */
  readonly reloadBlocked: boolean;
  /** Feed a caught error or rejection reason; non-recoverable ones are ignored. */
  report: (reason: unknown) => void;
  /** Enter recovery with no error to classify, e.g. from the origin heartbeat. */
  observeOriginLost: () => void;
  /** Probe now, bypassing both the backoff timer and the loop guard. */
  retry: () => void;
  stop: () => void;
}

export function createDevShellRecovery(
  options: DevShellRecoveryOptions,
): DevShellRecoveryController {
  const {
    probe,
    reload,
    onStateChange,
    readLastReloadAt = () => null,
    writeLastReloadAt = () => {},
    now = () => Date.now(),
    setTimer = (handler, delayMs) => setTimeout(handler, delayMs),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  let state: DevShellRecoveryState = "healthy";
  let reloadBlocked = false;
  let attempt = 0;
  let timer: unknown = null;
  let probing = false;
  let stopped = false;

  const setState = (next: DevShellRecoveryState) => {
    if (state === next) return;
    state = next;
    onStateChange?.(state);
  };

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const performReload = (force: boolean) => {
    const lastReloadAt = readLastReloadAt();
    if (!force && lastReloadAt !== null && now() - lastReloadAt < RELOAD_LOOP_WINDOW_MS) {
      // Reloading again would just replay the same failure. Hold the recovery
      // surface up and let the developer decide when to retry.
      reloadBlocked = true;
      setState("unreachable");
      return;
    }
    reloadBlocked = false;
    writeLastReloadAt(now());
    setState("reloading");
    reload();
  };

  const runProbe = (force: boolean) => {
    if (stopped || probing || state === "reloading") return;
    probing = true;
    setState("checking");
    void probe()
      .then((reachable) => {
        probing = false;
        if (stopped) return;
        if (reachable) {
          performReload(force);
          return;
        }
        setState("unreachable");
        scheduleProbe();
      })
      .catch(() => {
        probing = false;
        if (stopped) return;
        setState("unreachable");
        scheduleProbe();
      });
  };

  const scheduleProbe = () => {
    if (stopped) return;
    cancelTimer();
    const delay = nextProbeDelayMs(attempt);
    attempt += 1;
    timer = setTimer(() => {
      timer = null;
      runProbe(false);
    }, delay);
  };

  const beginRecovery = () => {
    if (stopped || state !== "healthy") return;
    attempt = 0;
    runProbe(false);
  };

  return {
    get state() {
      return state;
    },
    get reloadBlocked() {
      return reloadBlocked;
    },
    report(reason: unknown) {
      if (!isRecoverableShellFailure(reason)) return;
      beginRecovery();
    },
    observeOriginLost: beginRecovery,
    retry() {
      if (stopped) return;
      cancelTimer();
      attempt = 0;
      // An explicit retry is a deliberate act, so the loop guard steps aside.
      runProbe(true);
    },
    stop() {
      stopped = true;
      cancelTimer();
    },
  };
}
