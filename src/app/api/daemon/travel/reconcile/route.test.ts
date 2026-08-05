import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createDaemonTravelReconcilePostHandler } from "./route.ts";

function request() {
  return new Request("http://127.0.0.1/api/daemon/travel/reconcile", {
    method: "POST",
  });
}

test("daemon travel reconcile POST reuses the current connection snapshot", async () => {
  const snapshot = {
    running: false,
    availability: "unreachable",
    checkedAt: "2026-08-01T00:00:00.000Z",
    target: {
      mode: "hub",
      label: "Server hub",
      url: "https://cave.tailnet.example.ts.net:8787",
    },
  } as const;
  const seen: unknown[] = [];
  const POST = createDaemonTravelReconcilePostHandler({
    loadDaemonConnectionSnapshot: async () => snapshot,
    reconcileDaemonTravelHeartbeatSnapshot: async (input) => {
      seen.push(input);
      return {
        travelState: {
          manualOffline: false,
          hubUnreachableSince: "2026-08-01T00:00:00.000Z",
          lastHubReachableAt: null,
          staleCache: true,
          localSubdaemonWakeRequestedAt: null,
          localBindHost: "127.0.0.1",
          offlineQueue: [],
        },
        travelStatus: {
          mode: "watching-hub",
          authority: "hub",
          reason: "hub unreachable",
          manualOffline: false,
          staleCache: true,
          wakeLocalSubdaemon: false,
          localBindHost: "127.0.0.1",
          hubUnreachableSince: "2026-08-01T00:00:00.000Z",
          hubUnreachableForMs: 5_000,
          pendingQueueCount: 0,
          handoffPending: false,
        },
        travelReplay: null,
      };
    },
  });

  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(seen, [snapshot]);
});

test("daemon travel reconcile POST asks the client to keep polling while replay is still pending", async () => {
  const POST = createDaemonTravelReconcilePostHandler({
    loadDaemonConnectionSnapshot: async () => ({
      running: true,
      availability: "online",
      checkedAt: "2026-08-01T00:00:00.000Z",
      target: {
        mode: "hub",
        label: "Server hub",
        url: "https://cave.tailnet.example.ts.net:8787",
      },
    }),
    reconcileDaemonTravelHeartbeatSnapshot: async () => ({
      travelState: {
        manualOffline: false,
        hubUnreachableSince: null,
        lastHubReachableAt: "2026-08-01T00:00:00.000Z",
        staleCache: true,
        localSubdaemonWakeRequestedAt: null,
        localBindHost: "127.0.0.1",
        offlineQueue: [
          {
            id: "queued-chat",
            kind: "chat",
            summary: "Queued chat",
            createdAt: "2026-08-01T00:00:00.000Z",
            status: "syncing",
          },
        ],
      },
      travelStatus: {
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
      travelReplay: { attempted: 1, synced: 1, failed: 0, errors: [] },
    }),
  });

  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, retryAfterMs: 1000 });
});

test("daemon travel reconcile POST converts reconcile failures into a generic 503", async () => {
  const POST = createDaemonTravelReconcilePostHandler({
    loadDaemonConnectionSnapshot: async () => ({
      running: false,
      availability: "unreachable",
      checkedAt: "2026-08-01T00:00:00.000Z",
      target: {
        mode: "hub",
        label: "Server hub",
        url: "https://cave.tailnet.example.ts.net:8787",
      },
    }),
    reconcileDaemonTravelHeartbeatSnapshot: async () => ({
      travelState: {
        manualOffline: false,
        hubUnreachableSince: "2026-08-01T00:00:00.000Z",
        lastHubReachableAt: null,
        staleCache: true,
        localSubdaemonWakeRequestedAt: null,
        localBindHost: "127.0.0.1",
        offlineQueue: [],
      },
      travelStatus: {
        mode: "travel",
        authority: "travel-local",
        reason: "hub unreachable for 10s",
        manualOffline: false,
        staleCache: true,
        wakeLocalSubdaemon: true,
        localBindHost: "127.0.0.1",
        hubUnreachableSince: "2026-08-01T00:00:00.000Z",
        hubUnreachableForMs: 20_000,
        pendingQueueCount: 0,
        handoffPending: false,
      },
      travelReplay: null,
      failure: { code: "local-start-failed" },
    }),
  });

  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "daemon travel reconciliation failed",
  });
});

test("daemon travel reconcile POST redacts thrown diagnostics", async () => {
  const POST = createDaemonTravelReconcilePostHandler({
    loadDaemonConnectionSnapshot: async () => {
      throw Object.assign(
        new Error("/Users/buns/.coven/daemon.sock: secret stack detail"),
        { code: "EACCES" },
      );
    },
    reconcileDaemonTravelHeartbeatSnapshot: async () => {
      throw new Error("should not reconcile after a snapshot load failure");
    },
  });

  const response = await POST(request());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.deepEqual(body, {
    ok: false,
    error: "daemon travel reconciliation failed",
  });
  assert.doesNotMatch(JSON.stringify(body), /Users|secret|EACCES/);
});

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export const runtime = "nodejs"/);
assert.match(source, /export const dynamic = "force-dynamic"/);
assert.match(
  source,
  /import \{[^}]*loadDaemonConnectionSnapshot[^}]*\} from "@\/lib\/server\/daemon-connection-snapshot"/,
);
assert.match(
  source,
  /import \{[^}]*reconcileDaemonTravelHeartbeatSnapshot[^}]*\} from "@\/lib\/server\/daemon-travel-reconcile"/,
);
assert.match(source, /loadDaemonConnectionSnapshot\(\)/);
assert.match(source, /reconcileDaemonTravelHeartbeatSnapshot\(snapshot\)/);
assert.match(source, /retryAfterMs !== null \? \{ retryAfterMs \} : \{\}/);
assert.match(source, /error: "daemon travel reconciliation failed"/);
assert.doesNotMatch(source, /executorStatusesForConfig|installedCovenVersion|request\.json\(/);
assert.doesNotMatch(source, /searchParams\.get\("fresh"\)|reconcileDaemonTravelState\(\{/);

console.log("daemon travel reconcile route.test.ts: ok");
