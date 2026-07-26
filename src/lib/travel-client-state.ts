import type { CaveMultiHostConfig, CaveTravelState } from "./cave-config.ts";

export const TRAVEL_HUB_UNREACHABLE_MS = 10_000;

export type TravelClientStatus = {
  mode: "home" | "hub" | "watching-hub" | "travel" | "handoff-pending";
  authority: "local" | "hub" | "travel-local";
  reason: string;
  manualOffline: boolean;
  staleCache: boolean;
  wakeLocalSubdaemon: boolean;
  localBindHost: "127.0.0.1";
  hubUnreachableSince: string | null;
  hubUnreachableForMs: number;
  pendingQueueCount: number;
  handoffPending: boolean;
};

type DeriveTravelClientStatusInput = {
  multiHost: CaveMultiHostConfig;
  travel: CaveTravelState;
  hubReachable: boolean | null;
  now?: Date;
};

function pendingQueueCount(travel: CaveTravelState): number {
  return travel.offlineQueue.filter((item) => item.status === "pending" || item.status === "syncing" || item.status === "failed").length;
}

function unreachableForMs(travel: CaveTravelState, now: Date): number {
  if (!travel.hubUnreachableSince) return 0;
  const since = Date.parse(travel.hubUnreachableSince);
  if (!Number.isFinite(since)) return 0;
  return Math.max(0, now.getTime() - since);
}

function statusBase(travel: CaveTravelState, now: Date) {
  return {
    manualOffline: travel.manualOffline,
    staleCache: travel.staleCache,
    localBindHost: "127.0.0.1" as const,
    hubUnreachableSince: travel.hubUnreachableSince,
    hubUnreachableForMs: unreachableForMs(travel, now),
    pendingQueueCount: pendingQueueCount(travel),
  };
}

export function deriveTravelClientStatus({
  multiHost,
  travel,
  hubReachable,
  now = new Date(),
}: DeriveTravelClientStatusInput): TravelClientStatus {
  const base = statusBase(travel, now);
  if (multiHost.mode !== "hub") {
    return {
      mode: "home",
      authority: "local",
      reason: "local daemon authority",
      ...base,
      wakeLocalSubdaemon: false,
      handoffPending: false,
    };
  }

  if (travel.manualOffline) {
    return {
      mode: "travel",
      authority: "travel-local",
      reason: "manual offline",
      ...base,
      staleCache: true,
      wakeLocalSubdaemon: true,
      handoffPending: false,
    };
  }

  if (hubReachable === false) {
    if (base.hubUnreachableForMs >= TRAVEL_HUB_UNREACHABLE_MS) {
      return {
        mode: "travel",
        authority: "travel-local",
        reason: "hub unreachable for 10s",
        ...base,
        staleCache: true,
        wakeLocalSubdaemon: true,
        handoffPending: false,
      };
    }
    return {
      mode: "watching-hub",
      authority: "hub",
      reason: "hub unreachable",
      ...base,
      staleCache: true,
      wakeLocalSubdaemon: false,
      handoffPending: false,
    };
  }

  if (base.pendingQueueCount > 0) {
    return {
      mode: "handoff-pending",
      authority: "travel-local",
      reason: "offline queue pending sync",
      ...base,
      wakeLocalSubdaemon: false,
      handoffPending: true,
    };
  }

  return {
    mode: "hub",
    authority: "hub",
    reason: "server hub authority",
    ...base,
    wakeLocalSubdaemon: false,
    handoffPending: false,
  };
}
