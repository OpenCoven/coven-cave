// @ts-nocheck
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const previousHome = process.env.HOME;
const tempHome = await mkdtemp(path.join(os.tmpdir(), "cave-travel-network-"));
process.env.HOME = tempHome;

const config = await import("./cave-config.ts");
const daemon = await import("./coven-daemon.ts");
const travel = await import("./travel-client-state.ts");
const replay = await import("./travel-offline-replay.ts");

const sessionRequests: Array<Record<string, unknown>> = [];
let nextSession = 1;
let server: http.Server | null = null;

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function createHubServer(): http.Server {
  return http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    if (method === "GET" && url === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ apiVersion: "1", covenVersion: "test", daemon: { status: "ok" } }));
      return;
    }
    if (method === "POST" && url === "/api/v1/sessions") {
      const body = await readJson(req);
      sessionRequests.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `hub-session-${nextSession++}`, status: "running" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
}

function listenHub(port = 0): Promise<number> {
  server = createHubServer();
  return new Promise((resolve) => {
    server!.listen(port, "127.0.0.1", () => {
      const address = server!.address();
      assert(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function closeHub(): Promise<void> {
  const closing = server;
  server = null;
  if (!closing?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    closing.close((err) => err ? reject(err) : resolve());
  });
}

try {
  const port = await listenHub();
  const hubUrl = `http://127.0.0.1:${port}`;
  const savedConfig = await config.saveConfig({
    defaults: { harness: "codex", model: "openai/gpt-5.5" },
    familiars: { sage: { harness: "codex" } },
    multiHost: { mode: "hub", hubUrl, executorUrls: [] },
  });
  const target = daemon.daemonTargetForConfig(savedConfig);
  assert.deepEqual(target, { mode: "hub", label: "Server hub", url: hubUrl });

  const initialHealth = await daemon.callDaemonTarget(target, { path: "/api/v1/health", timeoutMs: 500 });
  assert.equal(initialHealth.ok, true, "mock hub should start reachable");
  let state = await config.recordTravelHubReachability(true, new Date("2026-06-30T12:00:00.000Z"));
  assert.equal(
    travel.deriveTravelClientStatus({
      multiHost: savedConfig.multiHost,
      travel: state,
      hubReachable: true,
      now: new Date("2026-06-30T12:00:00.000Z"),
    }).mode,
    "hub",
  );

  await closeHub();
  const droppedHealth = await daemon.callDaemonTarget(target, { path: "/api/v1/health", timeoutMs: 250 });
  assert.equal(droppedHealth.ok, false, "closed hub socket should behave like a private-network drop");
  assert.equal(droppedHealth.status, 0);

  state = await config.recordTravelHubReachability(false, new Date("2026-06-30T12:01:00.000Z"));
  const watching = travel.deriveTravelClientStatus({
    multiHost: savedConfig.multiHost,
    travel: state,
    hubReachable: false,
    now: new Date("2026-06-30T12:01:05.000Z"),
  });
  assert.equal(watching.mode, "watching-hub");
  assert.equal(watching.authority, "hub");
  assert.equal(watching.wakeLocalSubdaemon, false);

  const travelMode = travel.deriveTravelClientStatus({
    multiHost: savedConfig.multiHost,
    travel: state,
    hubReachable: false,
    now: new Date("2026-06-30T12:01:11.000Z"),
  });
  assert.equal(travelMode.mode, "travel");
  assert.equal(travelMode.authority, "travel-local");
  assert.equal(travelMode.reason, "hub unreachable for 10s");
  assert.equal(travelMode.staleCache, true);
  assert.equal(travelMode.wakeLocalSubdaemon, true);
  assert.equal(travelMode.localBindHost, "127.0.0.1");

  const queued = await config.enqueueOfflineTravelItem(
    {
      kind: "chat",
      summary: "Offline Sage message",
      payload: {
        familiarId: "sage",
        prompt: "queued during private network drop",
        projectRoot: process.cwd(),
      },
    },
    new Date("2026-06-30T12:01:12.000Z"),
  );
  state = await config.loadState();
  assert.equal(state.travel.offlineQueue[0].id, queued.id);
  assert.equal(state.travel.offlineQueue[0].status, "pending");

  await listenHub(port);
  const restoredHealth = await daemon.callDaemonTarget(target, { path: "/api/v1/health", timeoutMs: 500 });
  assert.equal(restoredHealth.ok, true, "mock hub should be reachable again after reconnect");
  state = await config.recordTravelHubReachability(true, new Date("2026-06-30T12:02:00.000Z"));
  const handoff = travel.deriveTravelClientStatus({
    multiHost: savedConfig.multiHost,
    travel: state,
    hubReachable: true,
    now: new Date("2026-06-30T12:02:00.000Z"),
  });
  assert.equal(handoff.mode, "handoff-pending");
  assert.equal(handoff.authority, "travel-local");
  assert.equal(handoff.pendingQueueCount, 1);

  const result = await replay.syncOfflineTravelQueue(savedConfig, { maxItems: 1 });
  assert.deepEqual(result, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(sessionRequests.length, 1);
  assert.equal(sessionRequests[0].harness, "codex");
  assert.equal(sessionRequests[0].familiarId, "sage");
  assert.equal(sessionRequests[0].prompt, "queued during private network drop");

  state = await config.loadState();
  assert.equal(state.travel.offlineQueue[0].status, "synced");
  const finalStatus = travel.deriveTravelClientStatus({
    multiHost: savedConfig.multiHost,
    travel: state.travel,
    hubReachable: true,
    now: new Date("2026-06-30T12:02:05.000Z"),
  });
  assert.equal(finalStatus.mode, "hub");
  assert.equal(finalStatus.authority, "hub");
  assert.equal(finalStatus.pendingQueueCount, 0);
  assert.equal(finalStatus.staleCache, false);

  console.log("travel-network-drop-proof.test.ts: ok");
} finally {
  await closeHub();
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
}
