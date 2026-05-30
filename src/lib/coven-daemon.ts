import { request } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

const SOCKET_PATH = process.env.COVEN_SOCKET ?? path.join(homedir(), ".coven", "coven.sock");

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
        socketPath: SOCKET_PATH,
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
          let parsed: T | null = null;
          try {
            parsed = raw ? (JSON.parse(raw) as T) : null;
          } catch {
            parsed = null;
          }
          resolve({
            ok: res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode ?? 0,
            data: parsed,
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, data: null, error: err.message });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

export const COVEN_SOCKET_PATH = SOCKET_PATH;
