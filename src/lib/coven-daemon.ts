import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import path from "node:path";
import type { CaveConfig } from "./cave-config.ts";
import { storedHubAccessToken } from "./hub-access-token.ts";
import {
  isSecureHubCredentialTransport,
  normalizeHubUrl,
} from "./hub-url.ts";

export {
  isSecureHubCredentialTransport,
  normalizeHubUrl,
} from "./hub-url.ts";
import {
  createDaemonDiagnosticContext,
  DAEMON_DIAGNOSTIC_CORRELATION_HEADER,
  diagnosticError,
  recordDaemonDiagnosticEvent,
  type DaemonDiagnosticContext,
} from "./server/daemon-diagnostics.ts";
import { isRemoteWindowsPath } from "./windows-local-path.ts";

// Re-exported so the socket resolver's own callers and tests keep importing the
// boundary from the module that applies it.
export { isRemoteWindowsPath } from "./windows-local-path.ts";

type SocketPathResolverOptions = {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  readFileSync?: ReadTextFile;
};

type ReadTextFile = (filePath: string, encoding: BufferEncoding) => string;

const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\";
export type DaemonTarget =
  | { mode: "local"; label: "Local daemon"; socketPath: string }
  | { mode: "hub"; label: "Server hub"; url: string; accessToken?: string }
  | { mode: "unconfigured-hub"; label: "Server hub"; error: string };

export function normalizeWindowsDaemonSocket(socket: string): string {
  const trimmed = socket.trim();
  if (!trimmed) return trimmed;

  const normalizedSlashes = trimmed.replaceAll("/", "\\");
  if (normalizedSlashes.toLowerCase().startsWith(WINDOWS_PIPE_PREFIX)) {
    return normalizedSlashes;
  }

  if (
    path.win32.isAbsolute(trimmed) ||
    path.posix.isAbsolute(trimmed) ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  ) {
    return trimmed;
  }

  return `${WINDOWS_PIPE_PREFIX}${trimmed}`;
}

type RefusedSocketSource = "coven-socket-env" | "coven-home-env" | "daemon-status-file";

/**
 * Values already reported, so one refusal is one event.
 *
 * The resolver runs on every daemon request (`socketPath()` via
 * `localDaemonTarget()`), so recording unconditionally would flush the
 * 256-event ring within seconds of a persistently forged value and bury the
 * diagnostics this event is meant to sit beside.
 *
 * Bounded and FIFO-evicting rather than unbounded, because the keys come from
 * the same attacker the events describe: `daemon.json` is re-read on every
 * request, so someone rewriting it with a fresh hostname each time would
 * otherwise grow this set for the life of the process. Eviction only costs a
 * re-report of a value that has not been seen for the last
 * REPORTED_REFUSAL_LIMIT distinct refusals, which is the same trade the event
 * ring itself already makes.
 *
 * The entries are bounded in length as well as in count, because a count bound
 * alone does not bound memory here: nothing limits how long the refused value
 * is. `daemon.json` is attacker-writable and `daemonStatusSocket` returns
 * whatever string its `socket` field holds, so 32 entries of a megabyte each
 * is a retention the count bound would happily allow. No real Windows target
 * approaches the cap (the OS path limit is 32767 characters and a pipe name is
 * far shorter), so truncation only ever affects a value that was never a
 * socket. Two absurd values sharing a prefix then dedupe to one event, which
 * is the same cost eviction already carries. Enforcing that bound takes a
 * copy, not just a truncation — see {@link detachedRefusalKey}.
 *
 * What neither bound stops, and what this deliberately does not try to: that
 * same attacker can still put one event in the ring per distinct value, and so
 * can still flush it. Refusing to record past a total cap would be worse —
 * whoever floods first would hide every later refusal, including a real one —
 * so the ring's own eviction stays the only backstop.
 */
const REPORTED_REFUSAL_LIMIT = 32;
/**
 * Bounds the refused *value* carried into a key, not the finished key.
 *
 * The source name and its separator are prepended after the truncation — that
 * order is what keeps every intermediate bounded, see {@link
 * detachedRefusalKey} — so a key runs to this limit plus `source.length + 1`,
 * i.e. 1043 characters at the longest source. The extra 19 characters are not
 * worth complicating the truncation for, but the name says `KEY` and the
 * arithmetic does not, so it is written down rather than left to be
 * rediscovered.
 */
const REPORTED_REFUSAL_KEY_LIMIT = 1024;
const reportedRefusals = new Set<string>();

/**
 * A dedupe key bounded in storage, not merely in length.
 *
 * Two things about `String.prototype.slice` make the obvious spelling of this
 * — `` `${source} ${value}`.slice(0, REPORTED_REFUSAL_KEY_LIMIT) `` — enforce
 * none of what the limit promises, and the refused value is as long as
 * whoever wrote `daemon.json` chose.
 *
 * It does not copy. V8 backs a sliced string with a pointer to its parent, so
 * a 1024-character key taken out of a megabyte-scale value keeps that whole
 * megabyte reachable for as long as the key sits in the set — precisely the
 * retention the limit exists to bound, reintroduced by the expression written
 * to enforce it. Measured on Node 24, 32 keys over equal-sized values: 1 MiB
 * values retained 32 MiB, 4 MiB retained 128 MiB, 8 MiB retained 256 MiB,
 * scaling with the value and not with the limit, against 0 MiB once copied.
 * Concatenating and re-slicing forces the flatten that copies. `.repeat(1)`
 * and `.slice(0)` look equivalent and are not: both fast-path back to the
 * receiver with the parent pointer intact, measured still retaining 28 of 32
 * MiB offered. `.normalize()` does happen to copy on Node 24 — measured 0 MiB
 * — but it is not the thing to reach for either, because that copy is
 * incidental. ECMA-262 specifies it in terms of the *content* of the result
 * and says nothing about its storage; string identity is not observable, so
 * an engine is free to hand back the receiver whenever the input is already
 * in the requested form, and a later quick-check fast path doing exactly that
 * would silently restore the retention this helper exists to prevent. Depend
 * on the flatten, which is the operation actually being asked for.
 *
 * And it happens too late. Truncating *after* the concatenation still builds
 * the joined string first, which flattens a full copy of the value on every
 * refused request — and raises `RangeError: Invalid string length` outright
 * once the join crosses V8's maximum string length (measured: a value of
 * MAX_STRING_LENGTH characters). That RangeError would escape
 * `resolveDaemonSocketPath` past the containment below, breaking every daemon
 * request and the module-load `COVEN_SOCKET_PATH` with it. Truncating the
 * value first keeps every intermediate bounded, so this cannot throw at all.
 */
function detachedRefusalKey(source: RefusedSocketSource, value: string): string {
  const truncated = `${source} ${value.slice(0, REPORTED_REFUSAL_KEY_LIMIT)}`;
  return ` ${truncated}`.slice(1);
}

/**
 * Record that a configured target was refused for naming another machine.
 *
 * Without this the refusal is indistinguishable from "no daemon configured",
 * which cuts both ways. An operator whose `COVEN_HOME` really is a share gets
 * a permanent "daemon offline" and no cause to act on — that misconfiguration
 * is one this guard newly creates, so it owes them the reason. And an attacker
 * probing which spellings the guard accepts leaves no trace at all.
 *
 * The refused value is deliberately not carried into the event. It embeds a
 * hostname, and this pipeline's contract is that diagnostics retain no paths
 * or addresses. Naming the source is enough: the operator knows what they set,
 * and the source is what they have to change.
 *
 * Nothing this function does may throw. It is reached from
 * `resolveDaemonSocketPath`, which `socketPath()` calls on every daemon
 * request, so an exception escaping here would not degrade diagnostics — it
 * would take out every request Cave makes, on the one code path that only runs
 * when something is already wrong. Losing an event is the strictly smaller
 * failure, so the recording is contained.
 */
function reportRefusedRemoteTarget(source: RefusedSocketSource, value: string): void {
  const key = detachedRefusalKey(source, value);
  if (reportedRefusals.has(key)) return;
  reportedRefusals.add(key);
  // A Set iterates in insertion order, so the first entry is the oldest.
  while (reportedRefusals.size > REPORTED_REFUSAL_LIMIT) {
    const oldest = reportedRefusals.values().next();
    if (oldest.done) break;
    reportedRefusals.delete(oldest.value);
  }
  try {
    recordRefusedRemoteTarget(source);
  } catch {
    // Deliberately swallowed; see above. The key stays recorded, so a
    // recorder that is failing does not get retried on every request.
  }
}

function recordRefusedRemoteTarget(source: RefusedSocketSource): void {
  recordDaemonDiagnosticEvent(createDaemonDiagnosticContext(), {
    component: "daemon",
    operation: "daemon-socket-resolution",
    phase: "target-resolution",
    outcome: "failed",
    process: { pid: process.pid },
    endpoint: { kind: "none", classification: source },
    error: diagnosticError(
      "configured daemon target names a path this machine does not own; it was not dialed",
      "off-machine-target",
    ),
  });
}

/**
 * Resolve the Coven home, refusing a `COVEN_HOME` that points off-machine.
 *
 * This guard is what stops the socket checks below from being decorative: a
 * remote `COVEN_HOME` puts both `daemon.json` and the fallback socket on
 * another machine, so refusing a forged socket only to build the "safe"
 * default underneath the attacker's host would reintroduce the same
 * redirection. Reading `daemon.json` from such a home is itself an SMB request
 * to the host that planted it, so the refusal has to happen here rather than
 * on the value that comes back.
 *
 * `homeDir` is deliberately NOT guarded, and not because it is trustworthy:
 * `os.homedir()` honours `USERPROFILE` on Windows, so it is the same class of
 * launch-environment input as `COVEN_HOME` (verified — setting `USERPROFILE`
 * to a UNC path changes what `homedir()` returns). It is left alone because
 * refusing it has no safe answer. A UNC profile is a legitimate roaming setup,
 * reading your own `daemon.json` over SMB is normal there, and there is no
 * further fallback to refuse *to* — so a guard would break real users rather
 * than close the hole. `COVEN_HOME` is different on exactly that point: it is
 * an explicit override with a safe local fallback available.
 *
 * Be precise about what that leaves standing, because the asymmetry above is
 * easy to read as broader than it is. Against an attacker who can already set
 * Cave's launch environment, this guard buys nothing: `COVEN_HOME` and
 * `USERPROFILE` are the same capability, so refusing the first only moves them
 * to the second. What it buys is against the strictly weaker attacker who can
 * plant a file but not set an environment — the likelier one, since
 * `daemon.json` is a plain file any process running as this user can rewrite —
 * and against an operator who points `COVEN_HOME` at a share by accident.
 *
 * Closing the environment-control class needs a different check entirely: the
 * owner of the pipe actually connected to, which is the other half of #4780's
 * acceptance criterion and is not reachable from a synchronous path resolver.
 * So this is a deliberate stopping point, not an oversight. Read the paragraph
 * above before "fixing" it.
 */
function covenHomePath(
  env: Record<string, string | undefined>,
  homeDir: string,
  platform: NodeJS.Platform,
): string {
  const configured = env.COVEN_HOME;
  if (configured) {
    if (!(platform === "win32" && isRemoteWindowsPath(configured))) return configured;
    reportRefusedRemoteTarget("coven-home-env", configured);
  }
  return path.join(homeDir, ".coven");
}

function daemonStatusSocket(covenHome: string, readFile: ReadTextFile): string | null {
  try {
    const raw = readFile(path.join(covenHome, "daemon.json"), "utf8");
    const parsed = JSON.parse(raw) as { socket?: unknown };
    return typeof parsed.socket === "string" && parsed.socket.trim() ? parsed.socket : null;
  } catch {
    return null;
  }
}

/**
 * Accept a Windows socket candidate only if it stays on this machine.
 *
 * Both inputs are attacker-reachable in the threat model the local transport
 * assumes: `COVEN_SOCKET` comes from the launch environment, and `daemon.json`
 * is a plain file in `COVEN_HOME` that any process running as this user — or
 * anything syncing that directory — can rewrite. Neither is a signed
 * statement about where the daemon lives, so a remote target is refused rather
 * than dialed, and resolution falls through to the canonical local path.
 *
 * Refusals are reported here rather than by the caller, because this is the
 * only place that still knows whether the candidate was off-machine or named
 * nothing at all. The caller needs that distinction too — the two outcomes
 * resolve differently — so it is returned rather than collapsed into a null.
 */
type WindowsSocketDecision =
  | { kind: "accepted"; socket: string }
  | { kind: "refused" }
  | { kind: "unnamed" };

function localWindowsDaemonSocket(
  candidate: string,
  source: RefusedSocketSource,
): WindowsSocketDecision {
  if (isRemoteWindowsPath(candidate)) {
    reportRefusedRemoteTarget(source, candidate);
    return { kind: "refused" };
  }
  const normalized = normalizeWindowsDaemonSocket(candidate);
  // A whitespace-only value normalizes to the empty string, which is not a
  // socket and is not a redirection either.
  if (!normalized) return { kind: "unnamed" };
  // `normalizeWindowsDaemonSocket` rewrites separators and can prepend the
  // pipe prefix, so re-check the value that would actually be dialed.
  if (isRemoteWindowsPath(normalized)) {
    reportRefusedRemoteTarget(source, normalized);
    return { kind: "refused" };
  }
  return { kind: "accepted", socket: normalized };
}

export function resolveDaemonSocketPath(options: SocketPathResolverOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const readFile: ReadTextFile =
    options.readFileSync ?? ((filePath, encoding) => readFileSync(filePath, encoding));

  const covenHome = covenHomePath(env, homeDir, platform);

  if (env.COVEN_SOCKET) {
    if (platform !== "win32") return env.COVEN_SOCKET;
    const configured = localWindowsDaemonSocket(env.COVEN_SOCKET, "coven-socket-env");
    // An accepted COVEN_SOCKET is still the whole answer: it outranks
    // `daemon.json`, and that precedence is what the override is for.
    if (configured.kind === "accepted") return configured.socket;
    // A value that names nothing is not a redirection and not a request to go
    // look elsewhere either; it stays on the old "COVEN_SOCKET was set, so
    // daemon.json is not consulted" path.
    if (configured.kind === "unnamed") return path.join(covenHome, "coven.sock");
    // A *refused* one falls through to `daemon.json`, exactly as if
    // COVEN_SOCKET had been unset.
    //
    // Skipping straight to the default below would be a total daemon outage
    // rather than a fail-closed refusal: on Windows the running daemon
    // publishes a named pipe in `daemon.json`, and `COVEN_HOME\coven.sock` is
    // a path nothing listens on. So a forged — or merely mistyped —
    // COVEN_SOCKET would take out a healthy, discoverable local daemon for as
    // long as the value stayed set, which hands an attacker who can only
    // write one environment variable a permanent denial of service.
    //
    // It costs nothing to close: `daemon.json` is guarded on its own, on both
    // halves. `covenHomePath` above has already refused an off-machine
    // `COVEN_HOME`, so the file is read from this machine, and the value it
    // yields goes through the same `localWindowsDaemonSocket` check below. A
    // refused COVEN_SOCKET therefore cannot reach a remote listener by way of
    // this fallthrough; it can only reach the local daemon it was hiding.
  }

  if (platform === "win32") {
    const statusSocket = daemonStatusSocket(covenHome, readFile);
    const published = statusSocket
      ? localWindowsDaemonSocket(statusSocket, "daemon-status-file")
      : null;
    if (published?.kind === "accepted") return published.socket;
  }

  return path.join(covenHome, "coven.sock");
}

/**
 * Resolve the daemon socket path at call time so a mid-session
 * COVEN_SOCKET env change is honored without an app restart.
 */
export function socketPath(): string {
  return resolveDaemonSocketPath();
}

function hubTargetFromUrl(rawUrl: string): Extract<DaemonTarget, { mode: "hub" }> | null {
  const normalized = normalizeHubUrl(rawUrl);
  if (!normalized) return null;
  const url = new URL(normalized);
  // An embedded token (a freshly pasted invite URL, or an env-provided URL)
  // wins; otherwise fall back to the out-of-config custody the config
  // sanitizer maintains (cave-1v95): global env override, then encrypted
  // custody bound to this exact origin.
  const embedded = url.searchParams.get("coven_access_token")?.trim();
  const accessToken = embedded || storedHubAccessToken(url.toString()) || undefined;
  url.search = "";
  url.hash = "";
  return {
    mode: "hub",
    label: "Server hub",
    url: url.toString().replace(/\/+$/, ""),
    ...(accessToken ? { accessToken } : {}),
  };
}

export function daemonTargetForConfig(config: Pick<CaveConfig, "multiHost">): DaemonTarget {
  if (config.multiHost?.mode !== "hub") {
    return localDaemonTarget();
  }
  const target = hubTargetFromUrl(config.multiHost.hubUrl ?? "");
  if (!target) {
    return {
      mode: "unconfigured-hub",
      label: "Server hub",
      error: "server hub URL is not configured",
    };
  }
  return target;
}

export function localDaemonTarget(): Extract<DaemonTarget, { mode: "local" }> {
  return { mode: "local", label: "Local daemon", socketPath: socketPath() };
}

async function loadDaemonTarget(): Promise<DaemonTarget> {
  const { loadConfig } = await import("./cave-config.ts");
  return daemonTargetForConfig(await loadConfig());
}

/**
 * Map a Node socket / HTTP error to a short, user-facing string. Strips
 * absolute paths so we never leak `/Users/<name>/...` into the UI; collapses
 * the common offline conditions (ENOENT, ECONNREFUSED, timeout) to stable
 * phrases the UI can detect.
 */
export function normalizeDaemonError(err: Error & { code?: string }): string {
  const code = err.code;
  if (code === "ENOENT" || code === "ECONNREFUSED") return "daemon offline";
  if (code === "EACCES" || code === "EPERM") return "socket exists but not readable";
  if (err.message === "timeout") return "daemon timeout";
  return err.message.replace(/(?:\/[\w.@~+-]+)+/g, "<path>");
}

export type DaemonRequest = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  timeoutMs?: number;
  maxResponseBytes?: number;
  retryTransportFailure?: boolean;
  diagnostics?: DaemonDiagnosticContext;
  diagnosticOperation?: string;
  diagnosticAttempt?: number;
};

export type DaemonResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
};

export async function callDaemon<T = unknown>(
  request: DaemonRequest,
): Promise<DaemonResponse<T>> {
  const target = await loadDaemonTarget();
  return callDaemonTarget<T>(target, request);
}

export async function callDaemonTarget<T = unknown>(
  target: DaemonTarget,
  {
    method = "GET",
    path: reqPath,
    body,
    timeoutMs = 4000,
    maxResponseBytes,
    retryTransportFailure = true,
    diagnostics = createDaemonDiagnosticContext(),
    diagnosticOperation = "daemon-request",
    diagnosticAttempt = 1,
  }: DaemonRequest,
): Promise<DaemonResponse<T>> {
  if (target.mode === "unconfigured-hub") {
    const result = {
      ok: false,
      status: 0,
      data: null,
      error: target.error,
    };
    recordDaemonDiagnosticEvent(diagnostics, {
      component: "daemon",
      operation: diagnosticOperation,
      phase: "target-resolution",
      attempt: diagnosticAttempt,
      outcome: "failed",
      process: { pid: process.pid },
      endpoint: { kind: "none", classification: "unconfigured-hub" },
      error: diagnosticError(target.error, "configuration-error"),
    });
    return result;
  }

  const first = await callDaemonTargetOnce<T>(target, {
    method,
    path: reqPath,
    body,
    timeoutMs,
    maxResponseBytes,
    diagnostics,
    diagnosticOperation,
    diagnosticAttempt,
  });
  // Retry transport-level failures (status 0: timeout/reset/refused) once for
  // reads unless the caller opts out — a briefly-busy daemon must not surface
  // a hard error for a GET (the /api/familiars 503 flake). Mutations never
  // retry: a timed-out POST may have been applied. HTTP-level errors (a real
  // status) never retry.
  if (!first.ok && first.status === 0 && method === "GET" && retryTransportFailure) {
    await new Promise((resolve) => setTimeout(resolve, GET_RETRY_DELAY_MS));
    return callDaemonTargetOnce<T>(target, {
      method,
      path: reqPath,
      body,
      timeoutMs,
      maxResponseBytes,
      retryTransportFailure,
      diagnostics,
      diagnosticOperation,
      diagnosticAttempt: diagnosticAttempt + 1,
    });
  }
  return first;
}

const GET_RETRY_DELAY_MS = 250;

function diagnosticResponseVersions(data: unknown): Record<string, string> {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  return Object.fromEntries(
    [
      ["api", record.apiVersion],
      ["daemon", record.covenVersion],
      ["service", record.version],
    ].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function callDaemonTargetOnce<T = unknown>(
  target: Exclude<DaemonTarget, { mode: "unconfigured-hub" }>,
  {
    method = "GET",
    path: reqPath,
    body,
    timeoutMs = 4000,
    maxResponseBytes,
    diagnostics = createDaemonDiagnosticContext(),
    diagnosticOperation = "daemon-request",
    diagnosticAttempt = 1,
  }: DaemonRequest,
): Promise<DaemonResponse<T>> {
  if (
    target.mode === "hub" &&
    target.accessToken &&
    !isSecureHubCredentialTransport(target.url)
  ) {
    return Promise.resolve({
      ok: false,
      status: 0,
      data: null,
      error: "refusing to send a hub access token without HTTPS or loopback secure transport",
    });
  }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const settle = (value: DaemonResponse<T>, sourceError?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      const errorClassification = value.ok
        ? null
        : value.status === 0
          ? "transport-error"
          : value.status === 401 || value.status === 403
            ? "authorization-error"
            : value.error === "malformed response"
              ? "malformed-response"
              : value.error === "daemon response exceeded size limit"
                ? "response-size-limit"
                : "http-error";
      recordDaemonDiagnosticEvent(diagnostics, {
        component: "daemon",
        operation: diagnosticOperation,
        phase: "response",
        attempt: diagnosticAttempt,
        durationMs: Date.now() - startedAt,
        outcome: value.ok ? "succeeded" : "failed",
        process: { pid: process.pid },
        versions: diagnosticResponseVersions(value.data),
        endpoint: {
          kind: target.mode === "hub" ? "hub-http" : "local-socket",
          classification: value.ok ? "online" : errorClassification ?? "unknown",
          status: value.status,
        },
        error: errorClassification
          ? diagnosticError(
              sourceError ?? value.error ?? `daemon http ${value.status}`,
              errorClassification,
            )
          : null,
      });
      resolve(value);
    };

    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload).toString();
    }
    if (target.mode === "hub" && target.accessToken) {
      headers.authorization = `Bearer ${target.accessToken}`;
    }
    headers[DAEMON_DIAGNOSTIC_CORRELATION_HEADER] = diagnostics.correlationId;
    const requestOptions =
      target.mode === "hub"
        ? (() => {
            const url = new URL(reqPath, `${target.url}/`);
            return {
              protocol: url.protocol,
              hostname: url.hostname,
              port: url.port,
              path: `${url.pathname}${url.search}`,
              method,
              timeout: timeoutMs,
              headers: Object.keys(headers).length ? headers : undefined,
            };
          })()
        : {
            socketPath: target.socketPath,
            method,
            path: reqPath,
            timeout: timeoutMs,
            headers: Object.keys(headers).length ? headers : undefined,
          };
    const requestFn =
      target.mode === "hub" &&
      "protocol" in requestOptions &&
      requestOptions.protocol === "https:"
        ? httpsRequest
        : httpRequest;

    const req = requestFn(
      requestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        let responseBytes = 0;
        res.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += bytes.byteLength;
          if (
            maxResponseBytes !== undefined &&
            responseBytes > maxResponseBytes
          ) {
            settle({
              ok: false,
              status: res.statusCode ?? 502,
              data: null,
              error: "daemon response exceeded size limit",
            });
            res.destroy();
            return;
          }
          chunks.push(bytes);
        });
        // A response that errors mid-body (daemon crash, connection reset)
        // never emits "end" — without this handler the promise would hang.
        res.on("error", (err) => {
          settle(
            { ok: false, status: 0, data: null, error: normalizeDaemonError(err) },
            err,
          );
        });
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          if (!raw) {
            settle({ ok, status, data: null });
            return;
          }
          try {
            const parsed = JSON.parse(raw) as T;
            settle({ ok, status, data: parsed });
          } catch {
            settle({
              ok: false,
              status,
              data: null,
              error: "malformed response",
            });
          }
        });
      },
    );

    // `timeout` above is an IDLE timeout — a body that trickles a byte inside
    // every idle window defeats it. This hard deadline bounds the total
    // request; daemon responses are small JSON, so 2× the idle budget is
    // generous for any legitimate reply.
    const deadline = setTimeout(() => {
      req.destroy(new Error("timeout"));
    }, timeoutMs * 2);
    (deadline as { unref?: () => void }).unref?.();

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      settle({
        ok: false,
        status: 0,
        data: null,
        error: normalizeDaemonError(err),
      }, err);
    });

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Snapshot of the resolved socket path at module load. Retained for callers
 * that surface the path in diagnostics — prefer `socketPath()` for any active
 * decision so env changes are honored at call time.
 */
export const COVEN_SOCKET_PATH = socketPath();

/**
 * Pull a human-readable error message out of a non-2xx daemon response.
 * The daemon's convention is `{ error: { code, message } }` (see e.g.
 * the session API's `invalid_request` 400s), but we accept a few shapes
 * defensively in case different routes drift:
 *
 *   - `{ error: { message: string, code?: string } }`  — canonical
 *   - `{ error: string }`                              — flat
 *   - `{ message: string }`                            — top-level
 *
 * Returns null when the response carries no message we can surface
 * (e.g. empty body, or the structured fields exist but aren't strings).
 * Callers should fall back to `res.error ?? "daemon http <status>"`
 * in that case.
 */
export function extractDaemonError(res: DaemonResponse<unknown>): string | null {
  if (res.error) return res.error;
  const data = res.data as Record<string, unknown> | null;
  if (!data) return null;
  const e = data.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const msg = (e as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
  }
  const msg = data.message;
  if (typeof msg === "string") return msg;
  return null;
}
