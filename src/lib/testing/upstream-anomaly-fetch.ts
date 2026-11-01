/**
 * Fetch-level anomaly harness for the upstream API suite (#6359).
 *
 * Replaces `globalThis.fetch` with a router keyed by the upstream registry
 * (`src/lib/server/upstream-api-registry.ts`). A test registers one healthy
 * handler per upstream, then switches that upstream into a fault mode live,
 * between calls, with `inject` — an outage, a revoked credential, a rate
 * limit, a stalled socket, a torn JSON body, a drifted schema — and back with
 * `heal`. Every request is recorded, so a test can prove the caller reached
 * the upstream again the moment it healed instead of sitting on a stale
 * failure.
 *
 * Relevance is enforced at runtime too: a request to a host the registry does
 * not declare is refused with a network-shaped TypeError and recorded, so a
 * route that quietly grows a dependency fails its own matrix test through
 * `assertAllDeclared`.
 *
 * Nothing here touches the network. The harness never resolves a hostname.
 */

import {
  UPSTREAM_APIS,
  upstreamApiForHost,
  type UpstreamApiEntry,
  type UpstreamApiId,
} from "../server/upstream-api-registry.ts";

export type UpstreamAnomaly =
  /** Any HTTP status with an optional body and headers. */
  | { kind: "http"; status: number; body?: unknown; headers?: Record<string, string>; statusText?: string }
  /** 401 with a `Bad credentials` body: the stored token was revoked. */
  | { kind: "auth-revoked" }
  /** 429 (or `status`) with Retry-After and x-ratelimit-* headers. */
  | { kind: "rate-limit"; status?: number; retryAfterSeconds?: number; resetEpochSeconds?: number }
  /** Never answers: rejects with the caller's own abort reason when its signal
   *  fires, or with a TimeoutError after the harness ceiling (`hangMs`). */
  | { kind: "timeout" }
  /** The socket never opens: rejects with undici's `TypeError: fetch failed`. */
  | { kind: "network"; message?: string }
  /** 200 with a JSON content-type and a truncated body. */
  | { kind: "malformed-json" }
  /** 200 with a JSON content-type and an empty body. */
  | { kind: "empty-body" }
  /** 200 with well-formed JSON of the wrong shape. */
  | { kind: "schema-drift"; body?: unknown }
  /** Delay, then either `then` or the healthy answer. */
  | { kind: "slow"; delayMs: number; then?: UpstreamAnomaly };

export type StandardAnomalyName =
  | "http-500"
  | "http-502"
  | "auth-revoked"
  | "rate-limit"
  | "timeout"
  | "network"
  | "malformed-json"
  | "empty-body"
  | "schema-drift";

export type NamedAnomaly = { name: StandardAnomalyName; anomaly: UpstreamAnomaly };

/** The matrix every upstream caller is driven through. Order is the order
 *  the matrix runs; names are the keys of a case's `degraded` expectations. */
export const STANDARD_UPSTREAM_ANOMALIES: readonly NamedAnomaly[] = [
  { name: "http-500", anomaly: { kind: "http", status: 500, body: { message: "Internal Server Error" } } },
  { name: "http-502", anomaly: { kind: "http", status: 502, body: "<html>Bad Gateway</html>", headers: { "content-type": "text/html" } } },
  { name: "auth-revoked", anomaly: { kind: "auth-revoked" } },
  { name: "rate-limit", anomaly: { kind: "rate-limit", retryAfterSeconds: 7 } },
  { name: "timeout", anomaly: { kind: "timeout" } },
  { name: "network", anomaly: { kind: "network" } },
  { name: "malformed-json", anomaly: { kind: "malformed-json" } },
  { name: "empty-body", anomaly: { kind: "empty-body" } },
  { name: "schema-drift", anomaly: { kind: "schema-drift" } },
];

export const SCHEMA_DRIFT_BODY = Object.freeze({
  unexpected: true,
  data: "not the documented shape",
  items: 42,
  login: { nested: "object where a string was promised" },
  tag_name: 7,
});

export type UpstreamCall = {
  /** The registry entry the host resolved to, or null when undeclared. */
  id: UpstreamApiId | null;
  url: string;
  host: string | null;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  /** The caller bounded the request with an AbortSignal. */
  hasDeadline: boolean;
  /** The anomaly in force when the call arrived (null = healthy). */
  anomaly: UpstreamAnomaly | null;
  /** A healthy handler existed for the resolved upstream. */
  handled: boolean;
  at: number;
};

export type UpstreamHandler = (request: Request, call: UpstreamCall) => Response | Promise<Response>;

export type UpstreamAnomalyHarness = {
  /** The routing fetch; also installed on `globalThis` unless `install: false`. */
  fetch: typeof fetch;
  /** Register (or replace) the healthy answer for an upstream. */
  healthy(id: UpstreamApiId, handler: UpstreamHandler): void;
  /** Switch an upstream into a fault mode live; `null` heals it. */
  inject(id: UpstreamApiId, anomaly: UpstreamAnomaly | null): void;
  /** Heal one upstream, or every upstream when `id` is omitted. */
  heal(id?: UpstreamApiId): void;
  anomalyFor(id: UpstreamApiId): UpstreamAnomaly | null;
  /** Recorded calls, newest last; filtered to one upstream when `id` is given. */
  calls(id?: UpstreamApiId): UpstreamCall[];
  /** Forget recorded calls (handlers and anomalies stay). */
  reset(): void;
  /** Calls whose host no registry entry declares (relative URLs included). */
  undeclared(): UpstreamCall[];
  /** Calls to a declared upstream that had no healthy handler registered. */
  unhandled(): UpstreamCall[];
  /** Fail loudly when any call was undeclared or unhandled. */
  assertAllDeclared(): void;
  /** Put the previous `globalThis.fetch` back. */
  restore(): void;
};

export type InstallOptions = {
  /** Defaults to the production registry. */
  registry?: readonly UpstreamApiEntry[];
  /** Ceiling for `timeout` and unbounded callers, in ms. Small by design so
   *  a route without a deadline still fails fast under test. */
  hangMs?: number;
  /** Set `false` to get the routing fetch without touching `globalThis`. */
  install?: boolean;
};

const DEFAULT_HANG_MS = 25;

function timeoutError(): Error {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

function abortError(): Error {
  return new DOMException("This operation was aborted", "AbortError");
}

function networkError(message = "fetch failed"): Error {
  const error = new TypeError(message);
  (error as TypeError & { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  return error;
}

function hang(signal: AbortSignal | null, hangMs: number): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      reject(timeoutError());
    }, hangMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function delay(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "content-type": "application/json; charset=utf-8", ...(extra ?? {}) };
}

function serializeBody(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

async function describeRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<{ url: string; method: string; headers: Record<string, string>; body: string | null; signal: AbortSignal | null; hasDeadline: boolean }> {
  const url = input instanceof Request ? input.url : String(input);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers: Record<string, string> = {};
  const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  if (source) {
    for (const [key, value] of new Headers(source)) headers[key.toLowerCase()] = value;
  }
  let body: string | null = null;
  if (typeof init?.body === "string") body = init.body;
  else if (init?.body instanceof URLSearchParams) body = init.body.toString();
  else if (init?.body === undefined && input instanceof Request && method !== "GET" && method !== "HEAD") {
    body = await input.clone().text().catch(() => null);
  }
  const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
  // A Request always carries a signal, so only an explicit init signal proves
  // the caller bounded the call with a deadline of its own.
  return { url, method, headers, body, signal: signal ?? null, hasDeadline: Boolean(init?.signal) };
}

function buildRequest(url: string, method: string, headers: Record<string, string>, body: string | null, signal: AbortSignal | null): Request {
  try {
    return new Request(url, {
      method,
      headers,
      ...(body !== null && method !== "GET" && method !== "HEAD" ? { body } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return new Request("http://undeclared.invalid/", { method: method === "GET" || method === "HEAD" ? method : "POST" });
  }
}

export function installUpstreamAnomalyFetch(options: InstallOptions = {}): UpstreamAnomalyHarness {
  const registry = options.registry ?? UPSTREAM_APIS;
  const hangMs = options.hangMs ?? DEFAULT_HANG_MS;
  const handlers = new Map<UpstreamApiId, UpstreamHandler>();
  const anomalies = new Map<UpstreamApiId, UpstreamAnomaly>();
  const recorded: UpstreamCall[] = [];
  const previousFetch = globalThis.fetch;

  const resolveEntry = (host: string): UpstreamApiEntry | null => {
    if (registry === UPSTREAM_APIS) return upstreamApiForHost(host);
    const needle = host.toLowerCase();
    return registry.find((entry) => entry.hosts.some((candidate) => candidate.toLowerCase() === needle)) ?? null;
  };

  async function answer(
    entry: UpstreamApiEntry,
    anomaly: UpstreamAnomaly | null,
    request: Request,
    call: UpstreamCall,
    signal: AbortSignal | null,
  ): Promise<Response> {
    if (anomaly === null) {
      const handler = handlers.get(entry.id);
      if (!handler) throw networkError(`upstream anomaly harness: no healthy handler registered for "${entry.id}" (${call.url})`);
      return handler(request, call);
    }
    switch (anomaly.kind) {
      case "http": {
        const body = serializeBody(anomaly.body);
        const headers = typeof anomaly.body === "string" ? { ...(anomaly.headers ?? {}) } : jsonHeaders(anomaly.headers);
        return new Response(body, { status: anomaly.status, statusText: anomaly.statusText, headers });
      }
      case "auth-revoked":
        return new Response(JSON.stringify({ message: "Bad credentials", error: "unauthorized" }), {
          status: 401,
          statusText: "Unauthorized",
          headers: jsonHeaders({ "www-authenticate": "Bearer" }),
        });
      case "rate-limit": {
        const retryAfter = anomaly.retryAfterSeconds ?? 7;
        const reset = anomaly.resetEpochSeconds ?? Math.floor(Date.now() / 1000) + retryAfter;
        return new Response(JSON.stringify({ message: "API rate limit exceeded", error: "rate_limited" }), {
          status: anomaly.status ?? 429,
          statusText: "Too Many Requests",
          headers: jsonHeaders({
            "retry-after": String(retryAfter),
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(reset),
          }),
        });
      }
      case "timeout":
        return hang(signal, hangMs);
      case "network":
        throw networkError(anomaly.message);
      case "malformed-json":
        return new Response('{"data":[{"id":1,"name":"trunc', { status: 200, headers: jsonHeaders() });
      case "empty-body":
        return new Response("", { status: 200, headers: jsonHeaders({ "content-length": "0" }) });
      case "schema-drift":
        return new Response(JSON.stringify(anomaly.body ?? SCHEMA_DRIFT_BODY), { status: 200, headers: jsonHeaders() });
      case "slow":
        await delay(anomaly.delayMs, signal);
        return answer(entry, anomaly.then ?? null, request, call, signal);
      default: {
        const never: never = anomaly;
        throw new Error(`unknown anomaly ${JSON.stringify(never)}`);
      }
    }
  }

  const routingFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const described = await describeRequest(input, init);
    let host: string | null = null;
    try {
      host = new URL(described.url).host.toLowerCase();
    } catch {
      host = null;
    }
    const entry = host ? resolveEntry(host) : null;
    const anomaly = entry ? anomalies.get(entry.id) ?? null : null;
    const call: UpstreamCall = {
      id: entry?.id ?? null,
      url: described.url,
      host,
      method: described.method,
      headers: described.headers,
      body: described.body,
      hasDeadline: described.hasDeadline,
      anomaly,
      handled: entry ? anomaly !== null || handlers.has(entry.id) : false,
      at: Date.now(),
    };
    recorded.push(call);
    if (!entry) {
      throw networkError(`upstream anomaly harness: undeclared upstream ${host ?? described.url} (declare it in src/lib/server/upstream-api-registry.ts)`);
    }
    const request = buildRequest(described.url, described.method, described.headers, described.body, described.signal);
    return answer(entry, anomaly, request, call, described.signal);
  }) as typeof fetch;

  if (options.install !== false) globalThis.fetch = routingFetch;

  return {
    fetch: routingFetch,
    healthy(id, handler) {
      handlers.set(id, handler);
    },
    inject(id, anomaly) {
      if (anomaly === null) anomalies.delete(id);
      else anomalies.set(id, anomaly);
    },
    heal(id) {
      if (id === undefined) anomalies.clear();
      else anomalies.delete(id);
    },
    anomalyFor(id) {
      return anomalies.get(id) ?? null;
    },
    calls(id) {
      return id === undefined ? [...recorded] : recorded.filter((call) => call.id === id);
    },
    reset() {
      recorded.length = 0;
    },
    undeclared() {
      return recorded.filter((call) => call.id === null);
    },
    unhandled() {
      return recorded.filter((call) => call.id !== null && !call.handled);
    },
    assertAllDeclared() {
      const problems = [
        ...recorded.filter((call) => call.id === null).map((call) => `undeclared upstream: ${call.method} ${call.url}`),
        ...recorded.filter((call) => call.id !== null && !call.handled).map((call) => `no healthy handler for "${call.id}": ${call.method} ${call.url}`),
      ];
      if (problems.length) throw new Error(`upstream anomaly harness:\n  ${problems.join("\n  ")}`);
    },
    restore() {
      globalThis.fetch = previousFetch;
    },
  };
}

/** Fail when `text` carries any of `secrets` — a response body or an error
 *  message that echoes a credential is a leak however the call ended. */
export function assertNoSecretLeak(text: string, secrets: readonly string[] | undefined, context: string): void {
  for (const secret of secrets ?? []) {
    if (secret && text.includes(secret)) {
      throw new Error(`${context}: the response leaked a credential (${secret.slice(0, 4)}…)`);
    }
  }
}
