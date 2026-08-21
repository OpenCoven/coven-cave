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

/**
 * The two rooted Windows shapes that provably stay on this machine: the local
 * named-pipe device, and a drive letter behind the long-path prefix.
 */
const WINDOWS_LOCAL_DEVICE_ROOT = /^\\\\[?.]\\(?:pipe\\|[a-z]:\\)/i;

/**
 * Whether a Windows path fails to prove it stays on this machine.
 *
 * This is an allowlist, and it has to be: enumerating off-machine spellings
 * does not converge. Measured on Windows 11 with `net.connect({ path })`
 * against a local `net.createServer` pipe, every one of these delivered to it
 * through the SMB redirector, and the last shows the nesting is open-ended
 * rather than a fixed set to denylist:
 *
 *     \\host\pipe\p
 *     \\?\UNC\host\pipe\p                    \\.\UNC\host\pipe\p
 *     \\?\GLOBALROOT\Device\Mup\host\pipe\p
 *     \\?\GLOBALROOT\Device\LanmanRedirector\host\pipe\p
 *     \\?\GLOBALROOT\??\UNC\host\pipe\p
 *
 * A path not rooted at `\\` — a drive letter, a bare pipe name, a relative
 * name — cannot leave the machine by spelling alone and is accepted without
 * enumeration. A path rooted at `\\` must match one of the two local device
 * roots above; everything else is refused, including spellings nobody has
 * written down yet. The local daemon is owner-local by definition, so a target
 * outside those roots is never it — it is a redirection, and every request
 * Cave would send (commands, conversation content, whatever the daemon is
 * asked to do) would reach the remote listener instead.
 *
 * What this cannot see: a drive letter mapped to a share
 * (`net use Z: \\host\share`) resolves off-machine while spelled `Z:\…`. No
 * syntactic check reaches that; it needs the connected pipe's owner.
 *
 * {@link isWindowsRemoteExecutablePath} in `coven-bin.ts` still draws the old,
 * narrower boundary for the CLI binary and admits the four spellings above.
 */
export function isRemoteWindowsPath(candidate: string): boolean {
  const normalized = candidate.trim().replaceAll("/", "\\");
  if (!normalized.startsWith("\\\\")) return false;
  return !WINDOWS_LOCAL_DEVICE_ROOT.test(normalized);
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
 * The residual exposure is therefore an attacker who can set `USERPROFILE` on
 * Cave's process, which is a strictly larger capability than planting a file.
 * See the PR discussion on #4780 before "fixing" this.
 */
function covenHomePath(
  env: Record<string, string | undefined>,
  homeDir: string,
  platform: NodeJS.Platform,
): string {
  const configured = env.COVEN_HOME;
  if (configured && !(platform === "win32" && isRemoteWindowsPath(configured))) {
    return configured;
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
 */
function localWindowsDaemonSocket(candidate: string): string | null {
  if (isRemoteWindowsPath(candidate)) return null;
  const normalized = normalizeWindowsDaemonSocket(candidate);
  // `normalizeWindowsDaemonSocket` rewrites separators and can prepend the
  // pipe prefix, so re-check the value that would actually be dialed.
  return isRemoteWindowsPath(normalized) ? null : normalized;
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
    const local = localWindowsDaemonSocket(env.COVEN_SOCKET);
    if (local) return local;
  } else if (platform === "win32") {
    const statusSocket = daemonStatusSocket(covenHome, readFile);
    const local = statusSocket ? localWindowsDaemonSocket(statusSocket) : null;
    if (local) return local;
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
