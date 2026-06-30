import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import path from "node:path";
import type { CaveConfig } from "./cave-config.ts";

type SocketPathResolverOptions = {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  readFileSync?: ReadTextFile;
};

type ReadTextFile = (filePath: string, encoding: BufferEncoding) => string;

const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\";
const DEFAULT_HUB_PROTOCOL = "http://";

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

function covenHomePath(env: Record<string, string | undefined>, homeDir: string): string {
  return env.COVEN_HOME ?? path.join(homeDir, ".coven");
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

export function resolveDaemonSocketPath(options: SocketPathResolverOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const readFile: ReadTextFile =
    options.readFileSync ?? ((filePath, encoding) => readFileSync(filePath, encoding));

  if (env.COVEN_SOCKET) {
    return platform === "win32"
      ? normalizeWindowsDaemonSocket(env.COVEN_SOCKET)
      : env.COVEN_SOCKET;
  }

  const covenHome = covenHomePath(env, homeDir);
  if (platform === "win32") {
    const statusSocket = daemonStatusSocket(covenHome, readFile);
    if (statusSocket) return normalizeWindowsDaemonSocket(statusSocket);
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

export function normalizeHubUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${DEFAULT_HUB_PROTOCOL}${trimmed}`;
}

function hubTargetFromUrl(rawUrl: string): Extract<DaemonTarget, { mode: "hub" }> | null {
  const normalized = normalizeHubUrl(rawUrl);
  if (!normalized) return null;
  const url = new URL(normalized);
  const accessToken = url.searchParams.get("coven_access_token")?.trim() || undefined;
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
};

export type DaemonResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
};

export async function callDaemon<T = unknown>({
  method = "GET",
  path: reqPath,
  body,
  timeoutMs = 4000,
}: DaemonRequest): Promise<DaemonResponse<T>> {
  const target = await loadDaemonTarget();
  return callDaemonTarget<T>(target, { method, path: reqPath, body, timeoutMs });
}

export async function callDaemonTarget<T = unknown>(
  target: DaemonTarget,
  {
    method = "GET",
    path: reqPath,
    body,
    timeoutMs = 4000,
  }: DaemonRequest,
): Promise<DaemonResponse<T>> {
  if (target.mode === "unconfigured-hub") {
    return {
      ok: false,
      status: 0,
      data: null,
      error: target.error,
    };
  }

  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload).toString();
    }
    if (target.mode === "hub" && target.accessToken) {
      headers.authorization = `Bearer ${target.accessToken}`;
    }
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
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          if (!raw) {
            resolve({ ok, status, data: null });
            return;
          }
          try {
            const parsed = JSON.parse(raw) as T;
            resolve({ ok, status, data: parsed });
          } catch {
            resolve({
              ok: false,
              status,
              data: null,
              error: "malformed response",
            });
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        status: 0,
        data: null,
        error: normalizeDaemonError(err),
      });
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
