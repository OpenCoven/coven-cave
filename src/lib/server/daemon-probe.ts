import {
  callDaemonTarget,
  daemonTargetForConfig,
  extractDaemonError,
  type DaemonRequest,
  type DaemonResponse,
  type DaemonTarget,
} from "../coven-daemon.ts";

export type DaemonProbeResult = {
  ok: true;
  reachable: boolean;
  status: number;
  latencyMs: number;
  reason?: string;
};

type CallDaemonTarget = (target: DaemonTarget, request: DaemonRequest) => Promise<DaemonResponse<unknown>>;

export function classifyHubFailure(res: DaemonResponse<unknown>): string {
  const detail = extractDaemonError(res) ?? `http ${res.status}`;
  if (res.status === 401 || res.status === 403) return `hub unauthorized: ${detail}`;
  if (res.status > 0) return `hub unhealthy: ${detail}`;
  return `hub unreachable: ${detail}`;
}

export async function probeDaemonUrl(
  url: string,
  call: CallDaemonTarget = callDaemonTarget,
  now: () => number = Date.now,
): Promise<DaemonProbeResult> {
  const target = daemonTargetForConfig({ multiHost: { mode: "hub", hubUrl: url, executorUrls: [] } });
  if (target.mode !== "hub") {
    throw new Error(target.mode === "unconfigured-hub" ? target.error : "invalid hub URL");
  }
  const startedAt = now();
  const response = await call(target, { path: "/api/v1/health", timeoutMs: 1500 });
  const latencyMs = Math.max(0, now() - startedAt);
  if (response.ok && response.data) {
    return { ok: true, reachable: true, status: response.status, latencyMs };
  }
  return {
    ok: true,
    reachable: false,
    status: response.status,
    latencyMs,
    reason: classifyHubFailure(response),
  };
}
