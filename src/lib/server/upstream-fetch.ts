/**
 * One fetch for every upstream API the server calls (#6359).
 *
 * `upstreamFetch(id, url, init)` is a drop-in for `fetch` that classifies
 * every answer the moment it arrives and acts on it in the same call:
 *
 *  - every request carries a deadline, so a stalled socket ends as a
 *    TimeoutError instead of hanging the route;
 *  - a transient fault on an idempotent read — a 5xx, a timeout, a dead
 *    socket, or a rate limit whose Retry-After is short — is retried once
 *    after a small jittered wait, so a single bad answer heals before the
 *    caller ever sees it; writes are never retried, because a retry after an
 *    ambiguous outcome is how a comment gets posted twice;
 *  - a rate limit with a longer Retry-After puts the host in a cooldown:
 *    until it ends, calls are answered at once with a synthesised 429 (marked
 *    by UPSTREAM_COOLDOWN_HEADER and carrying the remaining Retry-After), so
 *    each caller's own rate-limit branch still applies and no request is sent
 *    to a host that asked to be left alone;
 *  - three timeouts or dead sockets in a row put the host in a short
 *    cooldown in which calls throw an UpstreamCooldownError (a TypeError, so
 *    every existing "unreachable" branch handles it);
 *  - both cooldowns are half-open: the first call after one ends goes
 *    through, and a success closes it instantly.
 *
 * The per-host ledger behind this is in-process, holds no payloads or
 * credentials, and is published as `upstreamHealthSnapshot()` so the
 * diagnostics bundle shows what the server is seeing live.
 */

import { upstreamApiById, type UpstreamApiId } from "./upstream-api-registry.ts";

export type UpstreamAnomalyClass =
  | "none"
  | "rate-limited"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "client-error"
  | "server-error"
  | "timeout"
  | "network"
  | "aborted";

export type UpstreamAnomalyRecord = {
  class: UpstreamAnomalyClass;
  status: number | null;
  at: number;
};

export type UpstreamHostHealth = {
  id: UpstreamApiId;
  state: "healthy" | "degraded" | "cooling";
  consecutiveFailures: number;
  /** Timeouts and dead sockets in a row; three open a short cooldown. A host
   *  that answers 5xx is reachable, so it degrades but is not cut off. */
  transportStreak: number;
  lastAnomaly: UpstreamAnomalyRecord | null;
  lastSuccessAt: number | null;
  /** Epoch ms until which calls fail fast; null when not cooling. */
  coolingUntil: number | null;
  /** Why the host is cooling: it asked us to wait, or it stopped answering. */
  coolingReason: "rate-limited" | "unreachable" | null;
  calls: number;
  retries: number;
  failedFast: number;
};

export type UpstreamFetchOptions = {
  /** Per-attempt deadline. */
  timeoutMs?: number;
  /** Extra attempts after the first for idempotent methods (default 1). Writes always get 0. */
  retries?: number;
  /** A Retry-After at or under this is waited out inside the call; a longer one opens a cooldown. */
  retryAfterCapMs?: number;
  /** Set false to bypass an open cooldown (a deliberate probe). */
  honorCooldown?: boolean;
  fetchImpl?: typeof fetch;
};

export class UpstreamCooldownError extends TypeError {
  readonly id: UpstreamApiId;
  readonly retryAfterMs: number;
  constructor(id: UpstreamApiId, retryAfterMs: number) {
    super(`upstream ${id} is cooling down for ${Math.ceil(retryAfterMs / 1000)}s after a rate limit or repeated failures`);
    this.name = "UpstreamCooldownError";
    this.id = id;
    this.retryAfterMs = retryAfterMs;
  }
}

export const UPSTREAM_DEFAULT_TIMEOUT_MS = 10_000;
/** Marks a 429 the primitive answered itself during a cooldown; no request was sent. */
export const UPSTREAM_COOLDOWN_HEADER = "x-coven-upstream-cooldown";
export const UPSTREAM_RETRY_AFTER_CAP_MS = 2_000;
export const UPSTREAM_COOLDOWN_MAX_MS = 60_000;
export const UPSTREAM_FAILURE_COOLDOWN_MS = 5_000;
export const UPSTREAM_FAILURES_BEFORE_COOLDOWN = 3;
const BACKOFF_BASE_MS = 150;

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS"]);

let clock: () => number = Date.now;

/** Test seam: replace the ledger's clock (null restores Date.now). */
export function setUpstreamClockForTests(now: (() => number) | null): void {
  clock = now ?? Date.now;
}

const ledger = new Map<UpstreamApiId, UpstreamHostHealth>();

function entry(id: UpstreamApiId): UpstreamHostHealth {
  let health = ledger.get(id);
  if (!health) {
    upstreamApiById(id);
    health = { id, state: "healthy", consecutiveFailures: 0, transportStreak: 0, lastAnomaly: null, lastSuccessAt: null, coolingUntil: null, coolingReason: null, calls: 0, retries: 0, failedFast: 0 };
    ledger.set(id, health);
  }
  return health;
}

/** The live ledger, cloned. */
export function upstreamHealthSnapshot(): Record<string, UpstreamHostHealth> {
  const out: Record<string, UpstreamHostHealth> = {};
  for (const [id, health] of ledger) {
    const now = clock();
    const cooling = health.coolingUntil !== null && health.coolingUntil > now;
    out[id] = { ...health, lastAnomaly: health.lastAnomaly ? { ...health.lastAnomaly } : null, state: cooling ? "cooling" : health.state === "cooling" ? "degraded" : health.state };
  }
  return out;
}

export function upstreamHealth(id: UpstreamApiId): UpstreamHostHealth {
  return upstreamHealthSnapshot()[id] ?? { ...entry(id) };
}

/** Forget everything about one host, or every host. */
export function resetUpstreamHealth(id?: UpstreamApiId): void {
  if (id === undefined) ledger.clear();
  else ledger.delete(id);
}

export function parseRetryAfterMs(headers: Headers, now: number): number | null {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    if (/^\d+$/.test(retryAfter.trim())) return Number(retryAfter.trim()) * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const reset = headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset.trim())) return Math.max(0, Number(reset.trim()) * 1000 - now);
  return null;
}

/** Injected fetches sometimes return a bare `{ ok, status, json }`; treat missing headers as empty. */
function headersOf(response: Response): Headers {
  return response.headers instanceof Headers ? response.headers : new Headers();
}

export function classifyUpstreamResponse(response: Response): UpstreamAnomalyClass {
  const status = response.status;
  if (status === 429) return "rate-limited";
  if (status === 403 && headersOf(response).get("x-ratelimit-remaining") === "0") return "rate-limited";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 500) return "server-error";
  if (status >= 400) return "client-error";
  return "none";
}

export function classifyUpstreamError(error: unknown): UpstreamAnomalyClass {
  if (error instanceof UpstreamCooldownError) return "rate-limited";
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name);
    if (name === "TimeoutError") return "timeout";
    if (name === "AbortError") return "aborted";
  }
  return "network";
}

function recordSuccess(health: UpstreamHostHealth): void {
  health.consecutiveFailures = 0;
  health.transportStreak = 0;
  health.state = "healthy";
  health.coolingUntil = null;
  health.coolingReason = null;
  health.lastSuccessAt = clock();
}

function recordAnomaly(health: UpstreamHostHealth, anomaly: UpstreamAnomalyClass, status: number | null, coolForMs: number | null): void {
  const now = clock();
  health.lastAnomaly = { class: anomaly, status, at: now };
  if (anomaly === "server-error" || anomaly === "timeout" || anomaly === "network" || anomaly === "rate-limited") {
    health.consecutiveFailures += 1;
    health.state = "degraded";
  }
  if (anomaly === "timeout" || anomaly === "network") health.transportStreak += 1;
  else if (anomaly === "server-error") health.transportStreak = 0;
  let cooldown = coolForMs;
  if (cooldown === null && health.transportStreak >= UPSTREAM_FAILURES_BEFORE_COOLDOWN) cooldown = UPSTREAM_FAILURE_COOLDOWN_MS;
  if (cooldown !== null && cooldown > 0) {
    // Explicit provider waits are timestamps, not transport backoff. A time
    // beyond numeric precision remains effectively closed, never an early retry.
    health.coolingUntil = anomaly === "rate-limited"
      ? Math.min(now + cooldown, Number.MAX_SAFE_INTEGER)
      : now + Math.min(cooldown, UPSTREAM_COOLDOWN_MAX_MS);
    health.coolingReason = anomaly === "rate-limited" ? "rate-limited" : "unreachable";
    health.state = "cooling";
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The 429 a cooling host would give, synthesised without touching the network. */
function cooldownResponse(id: UpstreamApiId, remainingMs: number): Response {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return new Response(JSON.stringify({ message: `rate limited: ${id} asked Cave to wait ${seconds}s` }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(seconds),
      "x-ratelimit-remaining": "0",
      [UPSTREAM_COOLDOWN_HEADER]: "1",
    },
  });
}

function methodOf(input: string | URL | Request, init: RequestInit | undefined): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

const deadlineSignals = new WeakSet<AbortSignal>();

/**
 * Whether this signal came from `upstreamFetch` and so holds a timer. A bare
 * AbortSignal can't show that, so the anomaly harness asks here (#6370).
 */
export function carriesUpstreamDeadline(signal: AbortSignal | null | undefined): boolean {
  return signal != null && deadlineSignals.has(signal);
}

/** Observe transport failures as callers consume the body, without buffering or retrying it. */
function observeResponseBody(response: Response, health: UpstreamHostHealth, callerSignal: AbortSignal | null): Response {
  // Some injected transports intentionally return only the response fields they use.
  if (!(response instanceof Response) || !response.body) return response;
  const reader = response.body.getReader();
  let settled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          settled = true;
          controller.close();
        } else controller.enqueue(chunk.value);
      } catch (error) {
        if (!settled) {
          settled = true;
          const anomaly = classifyUpstreamError(error);
          if (!(anomaly === "aborted" && callerSignal?.aborted)) {
            recordAnomaly(health, anomaly, response.status, null);
          }
        }
        controller.error(error);
      }
    },
    cancel(reason) {
      settled = true;
      return reader.cancel(reason);
    },
  });
  return preserveResponseMetadata(new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }), response);
}

function preserveResponseMetadata(target: Response, source: Response): Response {
  // Constructing a streaming Response otherwise drops native fetch redirect metadata.
  Object.defineProperties(target, {
    url: { value: source.url },
    redirected: { value: source.redirected },
    type: { value: source.type },
  });
  const clone = target.clone.bind(target);
  Object.defineProperty(target, "clone", { value: () => preserveResponseMetadata(clone(), source) });
  return target;
}

export async function upstreamFetch(
  id: UpstreamApiId,
  input: string | URL | Request,
  init: RequestInit = {},
  options: UpstreamFetchOptions = {},
): Promise<Response> {
  const health = entry(id);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_DEFAULT_TIMEOUT_MS;
  const retryAfterCap = options.retryAfterCapMs ?? UPSTREAM_RETRY_AFTER_CAP_MS;
  const idempotent = IDEMPOTENT.has(methodOf(input, init));
  const retries = idempotent ? options.retries ?? 1 : 0;
  const callerSignal = init.signal ?? (input instanceof Request ? input.signal : null);

  const now = clock();
  if (options.honorCooldown !== false && health.coolingUntil !== null && health.coolingUntil > now) {
    health.failedFast += 1;
    const remainingMs = health.coolingUntil - now;
    // A host that asked us to wait is answered with its own verdict, so every
    // caller's existing rate-limit branch (message, retryable flag, retry-at)
    // still applies. A host that stopped answering stays a network failure.
    if (health.coolingReason === "rate-limited") return cooldownResponse(id, remainingMs);
    throw new UpstreamCooldownError(id, remainingMs);
  }

  for (let attempt = 0; ; attempt += 1) {
    health.calls += 1;
    if (attempt > 0) health.retries += 1;
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    deadlineSignals.add(signal);
    let response: Response;
    try {
      response = await fetchImpl(input, { ...init, signal });
    } catch (error) {
      const anomaly = classifyUpstreamError(error);
      if (anomaly === "aborted" && callerSignal?.aborted) throw error;
      recordAnomaly(health, anomaly, null, null);
      if (attempt < retries && !callerSignal?.aborted) {
        await wait(BACKOFF_BASE_MS * 2 ** attempt + Math.random() * 50, callerSignal ?? new AbortController().signal);
        continue;
      }
      throw error;
    }

    const anomaly = classifyUpstreamResponse(response);
    if (anomaly === "none" || anomaly === "not-found" || anomaly === "client-error" || anomaly === "unauthorized" || anomaly === "forbidden") {
      // A definite answer, good or bad, from a host that is up: the fault, if
      // any, is the caller's credential or request, not the upstream.
      if (anomaly === "none") recordSuccess(health);
      else health.lastAnomaly = { class: anomaly, status: response.status, at: clock() };
      return observeResponseBody(response, health, callerSignal);
    }

    if (anomaly === "rate-limited") {
      const retryAfterMs = parseRetryAfterMs(headersOf(response), clock());
      const shortWait = retryAfterMs !== null && retryAfterMs <= retryAfterCap;
      if (attempt < retries && shortWait) {
        recordAnomaly(health, anomaly, response.status, null);
        await wait(retryAfterMs, callerSignal ?? new AbortController().signal);
        continue;
      }
      recordAnomaly(health, anomaly, response.status, retryAfterMs ?? UPSTREAM_FAILURE_COOLDOWN_MS);
      return observeResponseBody(response, health, callerSignal);
    }

    // server-error
    recordAnomaly(health, anomaly, response.status, null);
    if (attempt < retries) {
      await response.body?.cancel?.().catch(() => {});
      await wait(BACKOFF_BASE_MS * 2 ** attempt + Math.random() * 50, callerSignal ?? new AbortController().signal);
      continue;
    }
    return observeResponseBody(response, health, callerSignal);
  }
}
