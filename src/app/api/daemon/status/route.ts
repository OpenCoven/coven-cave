import { NextResponse } from "next/server";
import {
  loadDaemonStatusSnapshot,
  isCaveConfigCompatibilityError,
} from "@/lib/cave-config";
import {
  callDaemonTarget,
  daemonTargetForConfig,
  extractDaemonError,
  type DaemonResponse,
  type DaemonTarget,
} from "@/lib/coven-daemon";
import { covenWorkspaceRoot } from "@/lib/coven-paths";
import { displayCovenVersion, installedCovenVersion } from "@/lib/coven-version";
import { classifyDaemonFailureAvailability } from "@/lib/daemon-status-classification";
import { executorStatusesForConfig } from "@/lib/executor-status";
import { daemonHealthRequest, daemonHealthResponseSucceeded } from "@/lib/server/daemon-health-request";
import { assessDaemonStartupCompatibility, type DaemonStartupHealth } from "@/lib/daemon-startup-contract";
import { classifyHubFailure } from "@/lib/server/daemon-probe";
import { reconcileDaemonTravelState } from "@/lib/server/daemon-travel-reconcile";
import { deriveTravelClientStatus } from "@/lib/travel-client-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Health = DaemonStartupHealth;

function targetSummary(target: DaemonTarget) {
  if (target.mode === "local") {
    return { mode: target.mode, label: target.label, socket: target.socketPath };
  }
  if (target.mode === "hub") {
    return { mode: target.mode, label: target.label, url: target.url };
  }
  return { mode: target.mode, label: target.label, error: target.error };
}

function hubAnswered(res: DaemonResponse<unknown>) {
  return res.status > 0;
}

function failureReason(target: DaemonTarget, res: DaemonResponse<unknown>) {
  const detail = extractDaemonError(res) ?? `http ${res.status}`;
  if (target.mode !== "hub") return detail;
  return classifyHubFailure(res);
}

function failureAvailability(target: DaemonTarget, res: DaemonResponse<unknown>) {
  return classifyDaemonFailureAvailability({
    targetMode: target.mode,
    responseStatus: res.status,
    reason: extractDaemonError(res),
  });
}

function isCaveHomeStatusFailure(error: unknown): boolean {
  if (isCaveConfigCompatibilityError(error)) return true;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code ?? "")
    : "";
  if (["EACCES", "EPERM", "ETIMEDOUT"].includes(code)) return true;
  return error instanceof Error && error.message.startsWith("Cave home reconciliation failed");
}

function caveHomeStatusUnavailable(error?: unknown) {
  if (isCaveConfigCompatibilityError(error)) {
    return NextResponse.json({
      running: false,
      availability: "incompatible",
      reason: error.message,
    });
  }
  return NextResponse.json({
    running: false,
    availability: "status-unavailable",
    reason: "Cave home is temporarily busy; status will retry automatically",
  });
}

export async function GET() {
  let snapshot: Awaited<ReturnType<typeof loadDaemonStatusSnapshot>>;
  try {
    snapshot = await loadDaemonStatusSnapshot();
  } catch (error) {
    if (!isCaveHomeStatusFailure(error)) throw error;
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as NodeJS.ErrnoException).code ?? "")
      : "reconciliation";
    console.warn("[daemon-status] Cave home status snapshot unavailable", { code });
    return caveHomeStatusUnavailable(error);
  }
  const { config } = snapshot;
  const target = daemonTargetForConfig(config);
  const checkedAt = new Date().toISOString();
  const executorStatuses = await executorStatusesForConfig(config);
  const travelState = snapshot.state.travel;
  if (target.mode === "unconfigured-hub") {
    const root = covenWorkspaceRoot();
    const travelStatus = deriveTravelClientStatus({
      multiHost: config.multiHost,
      travel: travelState,
      hubReachable: false,
    });
    return NextResponse.json({
      running: false,
      availability: "misconfigured",
      reason: target.error,
      checkedAt,
      target: targetSummary(target),
      executors: executorStatuses,
      travel: travelStatus,
      workspacePath: root,
      projectRoot: root,
    });
  }

  // Use the same resolved target for the health request, response metadata,
  // and failure classification. Reloading config inside callDaemon() created
  // a race where a connection-mode change could query one target while the
  // response claimed (and classified) another.
  const res = await callDaemonTarget<Health>(target, daemonHealthRequest());
  const health = daemonHealthResponseSucceeded(res) ? res.data : null;
  const daemonHealthy = health !== null;
  const installedVersion = daemonHealthy && target.mode === "local"
    ? await installedCovenVersion()
    : null;
  const compatibility = daemonHealthy && target.mode === "local"
    ? assessDaemonStartupCompatibility(health, installedVersion)
    : null;
  const { travelStatus, travelReplay } = await reconcileDaemonTravelState({
    config,
    travelState,
    target,
    hubAnswered: target.mode === "local" ? true : hubAnswered(res),
    daemonHealthy,
  });
  const root = covenWorkspaceRoot();
  if (!daemonHealthy || (compatibility && !compatibility.ok)) {
    return NextResponse.json({
      running: false,
      availability: compatibility && !compatibility.ok ? "incompatible" : failureAvailability(target, res),
      reason: compatibility && !compatibility.ok ? compatibility.diagnostic : failureReason(target, res),
      checkedAt,
      target: targetSummary(target),
      executors: executorStatuses,
      travel: travelStatus,
      travelReplay,
      workspacePath: root,
      projectRoot: root,
    });
  }
  const daemonVersion = typeof health.covenVersion === "string" ? health.covenVersion : undefined;
  const fallbackInstalledVersion =
    !daemonVersion || daemonVersion === "0.0.0"
      ? await installedCovenVersion()
      : installedVersion;
  return NextResponse.json({
    running: true,
    availability: "online",
    checkedAt,
    apiVersion: health.apiVersion,
    covenVersion: displayCovenVersion({
      daemonVersion,
      installedVersion: fallbackInstalledVersion,
    }),
    daemon: health.daemon,
    target: targetSummary(target),
    executors: executorStatuses,
    travel: travelStatus,
    travelReplay,
    workspacePath: root,
    projectRoot: root,
  });
}
