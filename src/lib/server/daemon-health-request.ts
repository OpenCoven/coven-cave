import type { DaemonRequest, DaemonResponse } from "../coven-daemon.ts";

export const DAEMON_HEALTH_TIMEOUT_MS = 1_500;

type DaemonHealthResponseBody = Record<string, unknown> & { ok?: boolean };

function isDaemonHealthResponseBody(value: unknown): value is DaemonHealthResponseBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function daemonHealthRequest(): Pick<DaemonRequest, "path" | "timeoutMs" | "retryTransportFailure"> {
  return {
    path: "/api/v1/health",
    timeoutMs: DAEMON_HEALTH_TIMEOUT_MS,
    retryTransportFailure: false,
  };
}

export function daemonHealthResponseSucceeded<T>(
  response: DaemonResponse<T>,
): response is DaemonResponse<T & DaemonHealthResponseBody> {
  if (!response.ok) return false;
  if (!isDaemonHealthResponseBody(response.data)) return false;
  return response.data.ok !== false;
}
