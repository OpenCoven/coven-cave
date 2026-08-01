import type { DaemonRequest } from "../coven-daemon.ts";

export const DAEMON_HEALTH_TIMEOUT_MS = 1_500;

export function daemonHealthRequest(): Pick<DaemonRequest, "path" | "timeoutMs" | "retryTransportFailure"> {
  return {
    path: "/api/v1/health",
    timeoutMs: DAEMON_HEALTH_TIMEOUT_MS,
    retryTransportFailure: false,
  };
}
