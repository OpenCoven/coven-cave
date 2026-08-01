import assert from "node:assert/strict";
import test from "node:test";
import type { CaveConfig, CaveState, CaveTravelState } from "../cave-config.ts";
import type { DaemonTarget } from "../coven-daemon.ts";
import { deriveTravelClientStatus } from "../travel-client-state.ts";
import type { TravelOfflineReplayResult } from "../travel-offline-replay.ts";
import type { DaemonConnectionSnapshot } from "./daemon-connection-snapshot.ts";
import {
  type DaemonTravelReconcileInput,
  hasWakeRequestForCurrentOutage,
  reconcileDaemonTravelHeartbeatSnapshot,
  reconcileDaemonTravelState,
} from "./daemon-travel-reconcile.ts";

function config(mode: "hub" | "local" = "hub", hubUrl = "https://cave.tailnet.example.ts.net:8787"): CaveConfig {
  return {
    multiHost: { mode, hubUrl, executorUrls: [] },
  } as unknown as CaveConfig;
}

function travelState(overrides: Partial<CaveTravelState> = {}): CaveTravelState {
  return {
    manualOffline: false,
    hubUnreachableSince: null,
    lastHubReachableAt: null,
    staleCache: false,
    localSubdaemonWakeRequestedAt: null,
    localBindHost: "127.0.0.1",
    offlineQueue: [],
    ...overrides,
  };
}

function state(travel: CaveTravelState): CaveState {
  return { travel } as CaveState;
}

function queueItem(status: CaveTravelState["offlineQueue"][number]["status"] = "pending") {
  return {
    id: `travel-${status}`,
    kind: "chat" as const,
    summary: `queue ${status}`,
    createdAt: "2026-08-01T00:00:00.000Z",
    status,
  };
}

function hubTarget(url = "https://cave.tailnet.example.ts.net:8787"): DaemonTarget {
  return { mode: "hub", label: "Server hub", url };
}

function localTarget(): DaemonTarget {
  return { mode: "local", label: "Local daemon", socketPath: "/Users/test/.coven/coven.sock" };
}

function replayResult(overrides: Partial<TravelOfflineReplayResult> = {}): TravelOfflineReplayResult {
  return {
    attempted: 0,
    synced: 0,
    failed: 0,
    errors: [],
    ...overrides,
  };
}

function hubSnapshot(
  overrides: Partial<DaemonConnectionSnapshot> = {},
): DaemonConnectionSnapshot {
  return {
    running: true,
    availability: "online",
    checkedAt: "2026-08-01T00:00:00.000Z",
    target: { mode: "hub", label: "Server hub", url: "https://cave.tailnet.example.ts.net:8787" },
    ...overrides,
  };
}

test("heartbeat reconciliation skips local snapshots without loading travel state", async () => {
  let loads = 0;
  let reconciles = 0;

  const result = await reconcileDaemonTravelHeartbeatSnapshot(
    {
      running: true,
      availability: "online",
      checkedAt: "2026-08-01T00:00:00.000Z",
      target: { mode: "local", label: "Local daemon", socket: "/Users/test/.coven/coven.sock" },
    },
    {
      loadDaemonStatusSnapshot: async () => {
        loads += 1;
        return { config: config(), state: state(travelState()) };
      },
      reconcileDaemonTravelState: async () => {
        reconciles += 1;
        throw new Error("should not reconcile local snapshots");
      },
    },
  );

  assert.equal(result, null);
  assert.equal(loads, 0);
  assert.equal(reconciles, 0);
});

test("heartbeat reconciliation matches sanitized hub targets without credentials", async () => {
  let reconcileInput: DaemonTravelReconcileInput | null = null;
  const expected = {
    travelState: travelState(),
    travelStatus: deriveTravelClientStatus({
      multiHost: config().multiHost,
      travel: travelState(),
      hubReachable: true,
    }),
    travelReplay: null,
  };

  const result = await reconcileDaemonTravelHeartbeatSnapshot(
    hubSnapshot(),
    {
      loadDaemonStatusSnapshot: async () => ({
        config: config("hub", "https://witch:forest-secret@cave.tailnet.example.ts.net:8787///"),
        state: state(travelState()),
      }),
      reconcileDaemonTravelState: async (input) => {
        reconcileInput = input;
        return expected;
      },
    },
  );

  assert.equal(result, expected);
  if (!reconcileInput) {
    assert.fail("heartbeat reconciliation should forward the shared reconcile input");
  }
  const forwarded = reconcileInput as DaemonTravelReconcileInput;
  assert.equal(forwarded.target.mode, "hub");
  assert.equal(forwarded.hubAnswered, true);
  assert.equal(forwarded.daemonHealthy, true);
});

test("heartbeat reconciliation refuses to mutate when the current hub target drifted", async () => {
  let loads = 0;
  let reconciles = 0;

  const result = await reconcileDaemonTravelHeartbeatSnapshot(
    hubSnapshot(),
    {
      loadDaemonStatusSnapshot: async () => {
        loads += 1;
        return {
          config: config("hub", "https://other.tailnet.example.ts.net:8787"),
          state: state(travelState()),
        };
      },
      reconcileDaemonTravelState: async () => {
        reconciles += 1;
        throw new Error("should not reconcile drifted targets");
      },
    },
  );

  assert.equal(result, null);
  assert.equal(loads, 1);
  assert.equal(reconciles, 0);
});

test("hub transport failures record unreachable and derive watching-hub state", async () => {
  const recorded: boolean[] = [];
  const deriveCalls: CaveTravelState[] = [];
  const nextState = travelState({
    hubUnreachableSince: new Date().toISOString(),
    staleCache: true,
  });

  const result = await reconcileDaemonTravelState(
    {
      config: config(),
      travelState: travelState(),
      target: hubTarget(),
      hubAnswered: false,
      daemonHealthy: false,
    },
    {
      recordTravelHubReachability: async (reachable) => {
        recorded.push(reachable);
        return nextState;
      },
      syncOfflineTravelQueue: async () => {
        assert.fail("transport failures should not replay queued work");
      },
      loadState: async () => {
        assert.fail("transport failures should not reload state");
      },
      startLocalDaemon: async () => {
        assert.fail("fresh transport failures should not start the local daemon yet");
      },
      recordLocalSubdaemonWakeRequest: async () => {
        assert.fail("fresh transport failures should not record a wake request");
      },
      deriveTravelClientStatus: (input) => {
        deriveCalls.push(input.travel);
        return deriveTravelClientStatus(input);
      },
    },
  );

  assert.deepEqual(recorded, [false]);
  assert.deepEqual(deriveCalls, [nextState]);
  assert.equal(result.travelReplay, null);
  assert.equal(result.travelStatus.mode, "watching-hub");
  assert.equal(result.travelStatus.authority, "hub");
  assert.equal(result.travelStatus.wakeLocalSubdaemon, false);
});

test("sustained hub failures trigger one local wake request and a second derive", async () => {
  const outageState = travelState({
    hubUnreachableSince: new Date(Date.now() - 20_000).toISOString(),
    staleCache: true,
  });
  const wokenState = {
    ...outageState,
    localSubdaemonWakeRequestedAt: new Date().toISOString(),
  };
  let startCalls = 0;
  let wakeRecords = 0;
  const deriveCalls: CaveTravelState[] = [];

  const result = await reconcileDaemonTravelState(
    {
      config: config(),
      travelState: travelState(),
      target: hubTarget(),
      hubAnswered: false,
      daemonHealthy: false,
    },
    {
      recordTravelHubReachability: async (reachable) => {
        assert.equal(reachable, false);
        return outageState;
      },
      syncOfflineTravelQueue: async () => {
        assert.fail("unhealthy failures should not replay queued work");
      },
      loadState: async () => {
        assert.fail("unhealthy failures should not reload state");
      },
      startLocalDaemon: async () => {
        startCalls += 1;
        return { ok: true };
      },
      recordLocalSubdaemonWakeRequest: async () => {
        wakeRecords += 1;
        return wokenState;
      },
      deriveTravelClientStatus: (input) => {
        deriveCalls.push(input.travel);
        return deriveTravelClientStatus(input);
      },
    },
  );

  assert.equal(startCalls, 1);
  assert.equal(wakeRecords, 1);
  assert.deepEqual(deriveCalls, [outageState, wokenState]);
  assert.equal(result.travelStatus.mode, "travel");
  assert.equal(result.travelStatus.authority, "travel-local");
  assert.equal(result.travelState.localSubdaemonWakeRequestedAt, wokenState.localSubdaemonWakeRequestedAt);
});

test("existing outage wake requests suppress repeated local daemon starts", async () => {
  const outageState = travelState({
    hubUnreachableSince: new Date(Date.now() - 20_000).toISOString(),
    localSubdaemonWakeRequestedAt: new Date(Date.now() - 5_000).toISOString(),
    staleCache: true,
  });
  const deriveCalls: CaveTravelState[] = [];
  let startCalls = 0;
  let wakeRecords = 0;

  assert.equal(hasWakeRequestForCurrentOutage(outageState), true);

  const result = await reconcileDaemonTravelState(
    {
      config: config(),
      travelState: travelState(),
      target: hubTarget(),
      hubAnswered: false,
      daemonHealthy: false,
    },
    {
      recordTravelHubReachability: async (reachable) => {
        assert.equal(reachable, false);
        return outageState;
      },
      syncOfflineTravelQueue: async () => {
        assert.fail("unhealthy failures should not replay queued work");
      },
      loadState: async () => {
        assert.fail("unhealthy failures should not reload state");
      },
      startLocalDaemon: async () => {
        startCalls += 1;
        return { ok: true };
      },
      recordLocalSubdaemonWakeRequest: async () => {
        wakeRecords += 1;
        return outageState;
      },
      deriveTravelClientStatus: (input) => {
        deriveCalls.push(input.travel);
        return deriveTravelClientStatus(input);
      },
    },
  );

  assert.equal(startCalls, 0);
  assert.equal(wakeRecords, 0);
  assert.deepEqual(deriveCalls, [outageState]);
  assert.equal(result.travelStatus.mode, "travel");
  assert.equal(result.travelStatus.authority, "travel-local");
});

test("unauthorized or unhealthy hub answers still count as reachable but do not replay", async () => {
  const reachablePendingState = travelState({
    staleCache: true,
    lastHubReachableAt: "2026-08-01T00:00:00.000Z",
    offlineQueue: [queueItem("pending")],
  });
  let replayCalls = 0;

  const result = await reconcileDaemonTravelState(
    {
      config: config(),
      travelState: travelState({
        hubUnreachableSince: "2026-07-31T23:59:30.000Z",
        staleCache: true,
        offlineQueue: [queueItem("pending")],
      }),
      target: hubTarget(),
      hubAnswered: true,
      daemonHealthy: false,
    },
    {
      recordTravelHubReachability: async (reachable) => {
        assert.equal(reachable, true);
        return reachablePendingState;
      },
      syncOfflineTravelQueue: async () => {
        replayCalls += 1;
        return replayResult({ attempted: 1, synced: 1 });
      },
      loadState: async () => {
        assert.fail("unhealthy hub answers should not reload state");
      },
      startLocalDaemon: async () => {
        assert.fail("reachable hub answers should not wake the local daemon");
      },
      recordLocalSubdaemonWakeRequest: async () => {
        assert.fail("reachable hub answers should not record a wake request");
      },
      deriveTravelClientStatus,
    },
  );

  assert.equal(replayCalls, 0);
  assert.equal(result.travelReplay, null);
  assert.equal(result.travelStatus.mode, "handoff-pending");
  assert.equal(result.travelStatus.authority, "travel-local");
});

test("healthy hub answers replay queued work and reload travel state when sync attempts run", async () => {
  const pendingState = travelState({
    staleCache: true,
    lastHubReachableAt: "2026-08-01T00:00:00.000Z",
    offlineQueue: [queueItem("pending")],
  });
  const reloadedState = travelState({
    staleCache: false,
    lastHubReachableAt: "2026-08-01T00:00:00.000Z",
    offlineQueue: [queueItem("synced")],
  });
  const expectedReplay = replayResult({ attempted: 1, synced: 1 });
  let replayCalls = 0;
  let reloads = 0;

  const result = await reconcileDaemonTravelState(
    {
      config: config(),
      travelState: travelState({ offlineQueue: [queueItem("pending")] }),
      target: hubTarget(),
      hubAnswered: true,
      daemonHealthy: true,
    },
    {
      recordTravelHubReachability: async (reachable) => {
        assert.equal(reachable, true);
        return pendingState;
      },
      syncOfflineTravelQueue: async (savedConfig) => {
        replayCalls += 1;
        assert.equal(savedConfig.multiHost.mode, "hub");
        return expectedReplay;
      },
      loadState: async () => {
        reloads += 1;
        return state(reloadedState);
      },
      startLocalDaemon: async () => {
        assert.fail("healthy hub answers should not wake the local daemon");
      },
      recordLocalSubdaemonWakeRequest: async () => {
        assert.fail("healthy hub answers should not record a wake request");
      },
      deriveTravelClientStatus,
    },
  );

  assert.equal(replayCalls, 1);
  assert.equal(reloads, 1);
  assert.deepEqual(result.travelReplay, expectedReplay);
  assert.equal(result.travelStatus.mode, "hub");
  assert.equal(result.travelStatus.pendingQueueCount, 0);
});

test("manual offline mode blocks replay while preserving local travel authority", async () => {
  const manualState = travelState({
    manualOffline: true,
    staleCache: true,
    offlineQueue: [queueItem("pending")],
  });
  let replayCalls = 0;
  let startCalls = 0;
  let wakeRecords = 0;

  const result = await reconcileDaemonTravelState(
    {
      config: config(),
      travelState: travelState({ manualOffline: true, offlineQueue: [queueItem("pending")] }),
      target: hubTarget(),
      hubAnswered: true,
      daemonHealthy: true,
    },
    {
      recordTravelHubReachability: async (reachable) => {
        assert.equal(reachable, true);
        return manualState;
      },
      syncOfflineTravelQueue: async () => {
        replayCalls += 1;
        return replayResult({ attempted: 1, synced: 1 });
      },
      loadState: async () => {
        assert.fail("manual offline mode should not reload state because replay is blocked");
      },
      startLocalDaemon: async () => {
        startCalls += 1;
        return { ok: true };
      },
      recordLocalSubdaemonWakeRequest: async () => {
        wakeRecords += 1;
        return {
          ...manualState,
          localSubdaemonWakeRequestedAt: new Date().toISOString(),
        };
      },
      deriveTravelClientStatus,
    },
  );

  assert.equal(replayCalls, 0);
  assert.equal(startCalls, 1);
  assert.equal(wakeRecords, 1);
  assert.equal(result.travelReplay, null);
  assert.equal(result.travelStatus.mode, "travel");
  assert.equal(result.travelStatus.authority, "travel-local");
});

test("local targets derive local authority without hub persistence or replay", async () => {
  let recordCalls = 0;
  let replayCalls = 0;

  const currentState = travelState({
    offlineQueue: [queueItem("pending")],
  });

  const result = await reconcileDaemonTravelState(
    {
      config: config("local"),
      travelState: currentState,
      target: localTarget(),
      hubAnswered: false,
      daemonHealthy: true,
    },
    {
      recordTravelHubReachability: async () => {
        recordCalls += 1;
        return currentState;
      },
      syncOfflineTravelQueue: async () => {
        replayCalls += 1;
        return replayResult({ attempted: 1, synced: 1 });
      },
      loadState: async () => {
        assert.fail("local targets should not reload state through hub reconciliation");
      },
      startLocalDaemon: async () => {
        assert.fail("local targets should not wake the local daemon through hub reconciliation");
      },
      recordLocalSubdaemonWakeRequest: async () => {
        assert.fail("local targets should not record a hub wake request");
      },
      deriveTravelClientStatus,
    },
  );

  assert.equal(recordCalls, 0);
  assert.equal(replayCalls, 0);
  assert.equal(result.travelReplay, null);
  assert.equal(result.travelState, currentState);
  assert.equal(result.travelStatus.mode, "home");
  assert.equal(result.travelStatus.authority, "local");
});

console.log("daemon-travel-reconcile.test.ts: ok");
