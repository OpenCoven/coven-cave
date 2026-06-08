import { request } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Resolve the daemon socket path at call time so a mid-session
 * COVEN_SOCKET env change is honored without an app restart.
 */
export function socketPath(): string {
  return process.env.COVEN_SOCKET ?? path.join(homedir(), ".coven", "coven.sock");
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
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;

    const req = request(
      {
        socketPath: socketPath(),
        method,
        path: reqPath,
        timeout: timeoutMs,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload).toString(),
            }
          : undefined,
      },
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
