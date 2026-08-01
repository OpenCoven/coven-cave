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
  failure?: { code: "local-start-failed" };
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
  now: () => Date;
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
  now: () => new Date(),
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

const HUB_REACHABILITY_REFRESH_MS = 30_000;

type ReconcileLane = {
  signature: string;
  promise: Promise<DaemonTravelReconcileResult>;
};

const reconcileLanes = new Map<string, ReconcileLane>();

function hasPendingTravelQueue(travelState: CaveTravelState): boolean {
  return travelState.offlineQueue.some((item) => item.status === "pending" || item.status === "syncing" || item.status === "failed");
}

function shouldRecordHubReachability(
  hubReachable: boolean,
  travelState: CaveTravelState,
  now: Date,
): boolean {
  if (!hubReachable) {
    return travelState.hubUnreachableSince === null;
  }
  if (travelState.hubUnreachableSince !== null) return true;
  if (travelState.lastHubReachableAt === null) return true;
  if (travelState.staleCache || travelState.manualOffline || hasPendingTravelQueue(travelState)) {
    return true;
  }
  const lastHubReachableAt = parseIsoMs(travelState.lastHubReachableAt);
  if (lastHubReachableAt === null) return true;
  return now.getTime() - lastHubReachableAt >= HUB_REACHABILITY_REFRESH_MS;
}

function daemonStartSucceeded(result: unknown): boolean {
  return typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    (result as { ok?: unknown }).ok === true;
}

function travelStateSignature(travelState: CaveTravelState): string {
  return JSON.stringify({
    manualOffline: travelState.manualOffline,
    hubUnreachableSince: travelState.hubUnreachableSince,
    lastHubReachableAt: travelState.lastHubReachableAt,
    staleCache: travelState.staleCache,
    localSubdaemonWakeRequestedAt: travelState.localSubdaemonWakeRequestedAt,
    localBindHost: travelState.localBindHost,
    offlineQueue: travelState.offlineQueue.map((item) => `${item.id}:${item.status}`),
  });
}

function reconcileInputSignature(input: DaemonTravelReconcileInput): string {
  return JSON.stringify({
    targetKey: daemonConnectionTargetKey(input.target),
    hubAnswered: input.hubAnswered,
    daemonHealthy: input.daemonHealthy,
    travelState: travelStateSignature(input.travelState),
  });
}

function startReconcileLane(
  key: string,
  signature: string,
  work: () => Promise<DaemonTravelReconcileResult>,
): Promise<DaemonTravelReconcileResult> {
  const lane: ReconcileLane = {
    signature,
    promise: Promise.resolve({
      travelState: {} as CaveTravelState,
      travelStatus: {} as TravelClientStatus,
      travelReplay: null,
    }),
  };
  const promise = (async () => {
    try {
      return await work();
    } finally {
      if (reconcileLanes.get(key) === lane) {
        reconcileLanes.delete(key);
      }
    }
  })();
  lane.promise = promise;
  reconcileLanes.set(key, lane);
  promise.catch(() => {});
  return promise;
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

async function executeDaemonTravelReconcile(
  input: DaemonTravelReconcileInput,
  deps: DaemonTravelReconcileDependencies,
): Promise<DaemonTravelReconcileResult> {
  const { config, target } = input;
  let travelState = input.travelState;
  let travelReplay: TravelOfflineReplayResult | null = null;
  const hubReachable = hubReachableForTarget(target, input.hubAnswered);
  const now = deps.now();

  if (target.mode === "hub" && shouldRecordHubReachability(hubReachable, travelState, now)) {
    travelState = await deps.recordTravelHubReachability(hubReachable, now);
  }

  if (target.mode === "hub") {
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
    now,
  });

  if (
    target.mode === "hub" &&
    travelStatus.wakeLocalSubdaemon &&
    !(hasWakeRequestForCurrentOutage(travelState) && !travelState.manualOffline)
  ) {
    let startResult: unknown;
    try {
      startResult = await deps.startLocalDaemon();
    } catch {
      return { travelState, travelStatus, travelReplay, failure: { code: "local-start-failed" } };
    }
    if (!daemonStartSucceeded(startResult)) {
      return { travelState, travelStatus, travelReplay, failure: { code: "local-start-failed" } };
    }
    travelState = await deps.recordLocalSubdaemonWakeRequest(now);
    travelStatus = deps.deriveTravelClientStatus({
      multiHost: config.multiHost,
      travel: travelState,
      hubReachable,
      now,
    });
  }

  return { travelState, travelStatus, travelReplay };
}

export async function reconcileDaemonTravelState(
  input: DaemonTravelReconcileInput,
  dependencies: Partial<DaemonTravelReconcileDependencies> = {},
): Promise<DaemonTravelReconcileResult> {
  const deps = { ...defaultReconcileDependencies, ...dependencies };
  const key = daemonConnectionTargetKey(input.target);
  const signature = reconcileInputSignature(input);
  const active = reconcileLanes.get(key);

  if (active) {
    if (active.signature === signature) {
      return active.promise;
    }
    return startReconcileLane(key, signature, async () => {
      await active.promise.catch(() => {});
      const travelState = input.target.mode === "hub"
        ? (await deps.loadState()).travel
        : input.travelState;
      return executeDaemonTravelReconcile({ ...input, travelState }, deps);
    });
  }

  return startReconcileLane(key, signature, () => executeDaemonTravelReconcile(input, deps));
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
