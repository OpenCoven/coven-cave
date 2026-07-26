// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const previousHome = process.env.HOME;
const tempHome = await mkdtemp(path.join(os.tmpdir(), "cave-travel-state-"));
process.env.HOME = tempHome;

const config = await import("./cave-config.ts");
const travel = await import("./travel-client-state.ts");

try {
  assert.deepEqual((await config.loadState()).travel, {
    manualOffline: false,
    hubUnreachableSince: null,
    lastHubReachableAt: null,
    staleCache: false,
    localSubdaemonWakeRequestedAt: null,
    localBindHost: "127.0.0.1",
    offlineQueue: [],
  });

  const manualAt = await config.setManualTravelMode(true, new Date("2026-06-30T10:00:00.000Z"));
  assert.equal(manualAt, "2026-06-30T10:00:00.000Z");

  let state = await config.loadState();
  assert.equal(state.travel.manualOffline, true);
  assert.equal(state.travel.staleCache, true);
  assert.equal(state.travel.localSubdaemonWakeRequestedAt, "2026-06-30T10:00:00.000Z");
  assert.equal(state.travel.localBindHost, "127.0.0.1");

  const queued = await config.enqueueOfflineTravelItem(
    {
      kind: "chat",
      summary: "Message to Sage",
      payload: { familiarId: "sage", prompt: "queued while traveling" },
    },
    new Date("2026-06-30T10:01:00.000Z"),
  );
  assert.equal(queued.status, "pending");
  assert.equal(queued.summary, "Message to Sage");

  state = await config.loadState();
  assert.equal(state.travel.offlineQueue.length, 1);
  assert.equal(state.travel.offlineQueue[0].id, queued.id);

  assert.deepEqual(
    travel.deriveTravelClientStatus({
      multiHost: { mode: "hub", hubUrl: "server.tailnet:8787", executorUrls: [] },
      travel: state.travel,
      hubReachable: true,
      now: new Date("2026-06-30T10:02:00.000Z"),
    }),
    {
      mode: "travel",
      authority: "travel-local",
      reason: "manual offline",
      manualOffline: true,
      staleCache: true,
      wakeLocalSubdaemon: true,
      localBindHost: "127.0.0.1",
      hubUnreachableSince: null,
      hubUnreachableForMs: 0,
      pendingQueueCount: 1,
      handoffPending: false,
    },
  );

  await config.setManualTravelMode(false, new Date("2026-06-30T10:03:00.000Z"));
  const unreachableState = await config.recordTravelHubReachability(false, new Date("2026-06-30T10:03:30.000Z"));
  assert.equal(unreachableState.hubUnreachableSince, "2026-06-30T10:03:30.000Z");

  assert.equal(
    travel.deriveTravelClientStatus({
      multiHost: { mode: "hub", hubUrl: "server.tailnet:8787", executorUrls: [] },
      travel: unreachableState,
      hubReachable: false,
      now: new Date("2026-06-30T10:03:35.000Z"),
    }).mode,
    "watching-hub",
    "hub loss below the 10s threshold should not switch authority yet",
  );

  assert.deepEqual(
    travel.deriveTravelClientStatus({
      multiHost: { mode: "hub", hubUrl: "server.tailnet:8787", executorUrls: [] },
      travel: unreachableState,
      hubReachable: false,
      now: new Date("2026-06-30T10:03:41.000Z"),
    }),
    {
      mode: "travel",
      authority: "travel-local",
      reason: "hub unreachable for 10s",
      manualOffline: false,
      staleCache: true,
      wakeLocalSubdaemon: true,
      localBindHost: "127.0.0.1",
      hubUnreachableSince: "2026-06-30T10:03:30.000Z",
      hubUnreachableForMs: 11000,
      pendingQueueCount: 1,
      handoffPending: false,
    },
  );

  const reachableState = await config.recordTravelHubReachability(true, new Date("2026-06-30T10:04:00.000Z"));
  assert.deepEqual(
    travel.deriveTravelClientStatus({
      multiHost: { mode: "hub", hubUrl: "server.tailnet:8787", executorUrls: [] },
      travel: reachableState,
      hubReachable: true,
      now: new Date("2026-06-30T10:04:00.000Z"),
    }),
    {
      mode: "handoff-pending",
      authority: "travel-local",
      reason: "offline queue pending sync",
      manualOffline: false,
      staleCache: true,
      wakeLocalSubdaemon: false,
      localBindHost: "127.0.0.1",
      hubUnreachableSince: null,
      hubUnreachableForMs: 0,
      pendingQueueCount: 1,
      handoffPending: true,
    },
  );

  await config.completeOfflineTravelItem(queued.id);
  state = await config.loadState();
  assert.equal(state.travel.offlineQueue[0].status, "synced");
  assert.equal(
    travel.deriveTravelClientStatus({
      multiHost: { mode: "hub", hubUrl: "server.tailnet:8787", executorUrls: [] },
      travel: state.travel,
      hubReachable: true,
      now: new Date("2026-06-30T10:05:00.000Z"),
    }).mode,
    "hub",
  );

  console.log("travel-client-state.test.ts: ok");
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
}
