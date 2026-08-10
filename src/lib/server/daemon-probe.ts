import {
  callDaemonTarget,
  daemonTargetForConfig,
  extractDaemonError,
  isSecureHubCredentialTransport,
  type DaemonRequest,
  type DaemonResponse,
  type DaemonTarget,
} from "../coven-daemon.ts";
import { daemonHealthRequest, daemonHealthResponseSucceeded } from "./daemon-health-request.ts";
import type { DaemonDiagnosticContext } from "./daemon-diagnostics.ts";

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
  diagnostics?: DaemonDiagnosticContext,
): Promise<DaemonProbeResult> {
  const resolvedTarget = daemonTargetForConfig({
    multiHost: { mode: "hub", hubUrl: url, executorUrls: [] },
  });
  if (resolvedTarget.mode !== "hub") {
    throw new Error(
      resolvedTarget.mode === "unconfigured-hub" ? resolvedTarget.error : "invalid hub URL",
    );
  }
  // Ad-hoc probes must never forward the process-wide or vaulted credential to
  // caller-selected origins. A token pasted into this exact probe URL is safe
  // to use because the caller already supplied it for that destination.
  const parsedUrl = new URL(url.includes("://") ? url : `http://${url}`);
  const embeddedToken = parsedUrl.searchParams.get("coven_access_token")?.trim();
  const { accessToken: _storedCredential, ...uncredentialedTarget } = resolvedTarget;
  const target: DaemonTarget = embeddedToken
    ? { ...uncredentialedTarget, accessToken: embeddedToken }
    : uncredentialedTarget;
  const startedAt = now();
  if (target.accessToken && !isSecureHubCredentialTransport(target.url)) {
    return {
      ok: true,
      reachable: false,
      status: 0,
      latencyMs: Math.max(0, now() - startedAt),
      reason: "Hub access tokens require HTTPS unless the endpoint is loopback.",
    };
  }
  const response = await call(
    target,
    diagnostics
      ? {
          ...daemonHealthRequest(),
          diagnostics,
          diagnosticOperation: "daemon-probe-health",
        }
      : daemonHealthRequest(),
  );
  const latencyMs = Math.max(0, now() - startedAt);
  if (daemonHealthResponseSucceeded(response)) {
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
