import { NextResponse } from "next/server";
import { loadConfig, loadState, recordLocalSubdaemonWakeRequest, recordTravelHubReachability } from "@/lib/cave-config";
import {
  callDaemon,
  daemonTargetForConfig,
  extractDaemonError,
  type DaemonResponse,
  type DaemonTarget,
} from "@/lib/coven-daemon";
import { covenWorkspaceRoot } from "@/lib/coven-paths";
import { displayCovenVersion, installedCovenVersion } from "@/lib/coven-version";
import { startLocalDaemon } from "@/lib/daemon-start";
import { executorStatusesForConfig } from "@/lib/executor-status";
import { deriveTravelClientStatus } from "@/lib/travel-client-state";
import { syncOfflineTravelQueue, type TravelOfflineReplayResult } from "@/lib/travel-offline-replay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Health = {
  ok: boolean;
  apiVersion?: string;
  covenVersion?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
};

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
  if (res.status === 401 || res.status === 403) return `hub unauthorized: ${detail}`;
  if (hubAnswered(res)) return `hub unhealthy: ${detail}`;
  return `hub unreachable: ${detail}`;
}

export async function GET() {
  const config = await loadConfig();
  const target = daemonTargetForConfig(config);
  const executorStatuses = await executorStatusesForConfig(config);
  let travelState = (await loadState()).travel;
  let hubReachable: boolean | null = target.mode === "local" ? true : null;
  if (target.mode === "unconfigured-hub") {
    const root = covenWorkspaceRoot();
    const travelStatus = deriveTravelClientStatus({
      multiHost: config.multiHost,
      travel: travelState,
      hubReachable: false,
    });
    return NextResponse.json({
      running: false,
      reason: target.error,
      target: targetSummary(target),
      executors: executorStatuses,
      travel: travelStatus,
      workspacePath: root,
      projectRoot: root,
    });
  }

  const res = await callDaemon<Health>({ path: "/api/v1/health", timeoutMs: 1500 });
  let travelReplay: TravelOfflineReplayResult | null = null;
  if (target.mode === "hub") {
    hubReachable = hubAnswered(res);
    travelState = await recordTravelHubReachability(hubReachable);
    if (res.ok && !travelState.manualOffline) {
      travelReplay = await syncOfflineTravelQueue(config);
      if (travelReplay.attempted > 0) {
        travelState = (await loadState()).travel;
      }
    }
  }
  let travelStatus = deriveTravelClientStatus({
    multiHost: config.multiHost,
    travel: travelState,
    hubReachable,
  });
  if (target.mode === "hub" && travelStatus.wakeLocalSubdaemon) {
    await startLocalDaemon();
    travelState = await recordLocalSubdaemonWakeRequest();
    travelStatus = deriveTravelClientStatus({
      multiHost: config.multiHost,
      travel: travelState,
      hubReachable,
    });
  }
  const root = covenWorkspaceRoot();
  if (!res.ok || !res.data) {
    return NextResponse.json({
      running: false,
      reason: failureReason(target, res),
      target: targetSummary(target),
      executors: executorStatuses,
      travel: travelStatus,
      travelReplay,
      workspacePath: root,
      projectRoot: root,
    });
  }
  const installedVersion =
    !res.data.covenVersion || res.data.covenVersion === "0.0.0"
      ? await installedCovenVersion()
      : null;
  return NextResponse.json({
    running: true,
    apiVersion: res.data.apiVersion,
    covenVersion: displayCovenVersion({
      daemonVersion: res.data.covenVersion,
      installedVersion,
    }),
    daemon: res.data.daemon,
    target: targetSummary(target),
    executors: executorStatuses,
    travel: travelStatus,
    travelReplay,
    workspacePath: root,
    projectRoot: root,
  });
}
