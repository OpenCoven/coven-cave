import {
  loadDaemonStatusSnapshot,
  loadState,
  recordLocalSubdaemonWakeRequest,
  recordTravelHubReachability,
  type CaveConfig,
  type CaveTravelState,
} from "../cave-config.ts";
import { daemonTargetForConfig, type DaemonTarget } from "../coven-daemon.ts";
import { startLocalDaemon } from "../daemon-start.ts";
import { deriveTravelClientStatus, type TravelClientStatus } from "../travel-client-state.ts";
import { syncOfflineTravelQueue, type TravelOfflineReplayResult } from "../travel-offline-replay.ts";
import {
  daemonConnectionTargetKey,
  daemonConnectionTargetSummary,
  type DaemonConnectionSnapshot,
} from "./daemon-connection-snapshot.ts";

export type DaemonTravelReconcileInput = {
  config: CaveConfig;
  travelState: CaveTravelState;
  target: DaemonTarget;
  hubAnswered: boolean;
  daemonHealthy: boolean;
};

export type DaemonTravelReconcileResult = {
  travelState: CaveTravelState;
  travelStatus: TravelClientStatus;
  travelReplay: TravelOfflineReplayResult | null;
};

type DaemonTravelReconcileDependencies = {
  recordTravelHubReachability: typeof recordTravelHubReachability;
  syncOfflineTravelQueue: (
    config: CaveConfig,
  ) => Promise<TravelOfflineReplayResult>;
  loadState: typeof loadState;
  startLocalDaemon: () => Promise<unknown>;
  recordLocalSubdaemonWakeRequest: typeof recordLocalSubdaemonWakeRequest;
  deriveTravelClientStatus: typeof deriveTravelClientStatus;
};

type DaemonTravelHeartbeatDependencies = {
  loadDaemonStatusSnapshot: typeof loadDaemonStatusSnapshot;
  daemonTargetForConfig: typeof daemonTargetForConfig;
  reconcileDaemonTravelState: (
    input: DaemonTravelReconcileInput,
    dependencies?: Partial<DaemonTravelReconcileDependencies>,
  ) => Promise<DaemonTravelReconcileResult>;
};

const defaultReconcileDependencies: DaemonTravelReconcileDependencies = {
  recordTravelHubReachability,
  syncOfflineTravelQueue,
  loadState,
  startLocalDaemon,
  recordLocalSubdaemonWakeRequest,
  deriveTravelClientStatus,
};

const defaultHeartbeatDependencies: DaemonTravelHeartbeatDependencies = {
  loadDaemonStatusSnapshot,
  daemonTargetForConfig,
  reconcileDaemonTravelState,
};

function hubReachableForTarget(target: DaemonTarget, hubAnswered: boolean): boolean {
  return target.mode === "local" ? true : hubAnswered;
}

function snapshotTargetKey(target: DaemonConnectionSnapshot["target"]): string {
  if (target.mode === "local") return `local:${target.socket}`;
  if (target.mode === "hub") return `hub:${target.url}`;
  return `unconfigured-hub:${target.error}`;
}

function sameSnapshotTarget(
  snapshot: DaemonConnectionSnapshot["target"],
  target: DaemonTarget,
): boolean {
  const summary = daemonConnectionTargetSummary(target);
  if (snapshotTargetKey(snapshot) !== daemonConnectionTargetKey(target)) return false;
  switch (summary.mode) {
    case "local":
      return snapshot.mode === "local" &&
        snapshot.label === summary.label &&
        snapshot.socket === summary.socket;
    case "hub":
      return snapshot.mode === "hub" &&
        snapshot.label === summary.label &&
        snapshot.url === summary.url;
    case "unconfigured-hub":
      return snapshot.mode === "unconfigured-hub" &&
        snapshot.label === summary.label &&
        snapshot.error === summary.error;
  }
}

function parseIsoMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function hasWakeRequestForCurrentOutage(
  travelState: Pick<CaveTravelState, "hubUnreachableSince" | "localSubdaemonWakeRequestedAt">,
): boolean {
  if (!travelState.hubUnreachableSince || !travelState.localSubdaemonWakeRequestedAt) {
    return false;
  }
  const outageAt = parseIsoMs(travelState.hubUnreachableSince);
  const wakeAt = parseIsoMs(travelState.localSubdaemonWakeRequestedAt);
  if (outageAt !== null && wakeAt !== null) {
    return wakeAt >= outageAt;
  }
  return true;
}

export async function reconcileDaemonTravelState(
  input: DaemonTravelReconcileInput,
  dependencies: Partial<DaemonTravelReconcileDependencies> = {},
): Promise<DaemonTravelReconcileResult> {
  const deps = { ...defaultReconcileDependencies, ...dependencies };
  const { config, target } = input;
  let travelState = input.travelState;
  let travelReplay: TravelOfflineReplayResult | null = null;
  const hubReachable = hubReachableForTarget(target, input.hubAnswered);

  if (target.mode === "hub") {
    travelState = await deps.recordTravelHubReachability(hubReachable);
    if (input.daemonHealthy && !travelState.manualOffline) {
      travelReplay = await deps.syncOfflineTravelQueue(config);
      if (travelReplay.attempted > 0) {
        travelState = (await deps.loadState()).travel;
      }
    }
  }

  let travelStatus = deps.deriveTravelClientStatus({
    multiHost: config.multiHost,
    travel: travelState,
    hubReachable,
  });

  if (
    target.mode === "hub" &&
    travelStatus.wakeLocalSubdaemon &&
    !(hasWakeRequestForCurrentOutage(travelState) && !travelState.manualOffline)
  ) {
    await deps.startLocalDaemon();
    travelState = await deps.recordLocalSubdaemonWakeRequest();
    travelStatus = deps.deriveTravelClientStatus({
      multiHost: config.multiHost,
      travel: travelState,
      hubReachable,
    });
  }

  return { travelState, travelStatus, travelReplay };
}

export async function reconcileDaemonTravelHeartbeatSnapshot(
  snapshot: DaemonConnectionSnapshot,
  dependencies: Partial<DaemonTravelHeartbeatDependencies> = {},
): Promise<DaemonTravelReconcileResult | null> {
  if (snapshot.target.mode !== "hub") {
    return null;
  }

  const deps = { ...defaultHeartbeatDependencies, ...dependencies };
  const statusSnapshot = await deps.loadDaemonStatusSnapshot();
  const target = deps.daemonTargetForConfig(statusSnapshot.config);
  if (target.mode !== "hub" || !sameSnapshotTarget(snapshot.target, target)) {
    return null;
  }

  return deps.reconcileDaemonTravelState({
    config: statusSnapshot.config,
    travelState: statusSnapshot.state.travel,
    target,
    hubAnswered: snapshot.availability !== "unreachable",
    daemonHealthy: snapshot.running,
  });
}
