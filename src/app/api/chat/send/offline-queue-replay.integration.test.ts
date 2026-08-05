// @ts-nocheck
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

const previousEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  COVEN_SOCKET: process.env.COVEN_SOCKET,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
};

const scratchRoot = path.join(process.cwd(), `.offline-queue-replay-${process.pid}`);
const covenHome = path.join(scratchRoot, "coven-home");
const caveHome = path.join(covenHome, "cave");
const projectRoot = path.join(scratchRoot, "project");

process.env.COVEN_HOME = covenHome;
process.env.COVEN_CAVE_HOME = caveHome;
delete process.env.COVEN_SOCKET;
delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;

const sessionRequests = [];
let sessionPhase = "running";
let server = null;

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function listenHub(port = 0) {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/api/v1/sessions") {
      sessionRequests.push(await readJson(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "hub-session-1", status: "running" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/v1/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          sessions: [
            sessionPhase === "completed"
              ? {
                  id: "hub-session-1",
                  status: "completed",
                  created_at: "2026-06-30T12:02:05.000Z",
                  updated_at: "2026-07-03T12:05:00.000Z",
                  completed_at: "2026-06-30T12:05:00.000Z",
                }
              : {
                  id: "hub-session-1",
                  status: "running",
                  created_at: "2026-06-30T12:02:05.000Z",
                  updated_at: "2026-06-30T12:03:00.000Z",
                },
          ],
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/v1/events") {
      res.writeHead(200, { "content-type": "application/json" });
      if (sessionPhase !== "completed") {
        res.end(JSON.stringify({ events: [], next_cursor: null }));
        return;
      }
      res.end(
        JSON.stringify({
          events: [
            {
              kind: "assistant.message",
              timestamp: "2026-06-30T12:05:00.000Z",
              payload_json: JSON.stringify({ data: { content: "Queued reply from daemon." } }),
            },
          ],
          next_cursor: null,
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ apiVersion: "1", covenVersion: "test", daemon: { status: "ok" } }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object" && typeof address.port === "number");
  return address.port;
}

async function closeHub() {
  const closing = server;
  server = null;
  if (!closing?.listening) return;
  await new Promise((resolve, reject) => closing.close((error) => (error ? reject(error) : resolve())));
}

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

try {
  await rm(scratchRoot, { recursive: true, force: true });
  await mkdir(projectRoot, { recursive: true });

  const port = await listenHub();
  const hubUrl = `http://127.0.0.1:${port}`;

  const { POST } = await import("./route.ts");
  const config = await import("@/lib/cave-config");
  const conversations = await import("@/lib/cave-conversations");
  const replay = await import("@/lib/travel-offline-replay.ts");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { mergeSessionRows } = await import("@/lib/session-list-merge.ts");

  await config.saveConfig({
    defaults: { harness: "claude", model: "anthropic/claude-sonnet-4-6" },
    familiars: { sage: { harness: "claude" } },
    multiHost: { mode: "hub", hubUrl, executorUrls: [] },
  });

  const project = await createProject({ name: "Offline replay fixture", root: projectRoot });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });
  await conversations.saveConversation({
    sessionId: "offline-chat-1",
    familiarId: "sage",
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    runtime: `local:${projectRoot}`,
    title: "Existing offline chat",
    createdAt: "2026-06-30T11:58:00.000Z",
    updatedAt: "2026-06-30T11:59:00.000Z",
    turns: [
      {
        id: "existing-user",
        role: "user",
        text: "What needs my attention?",
        createdAt: "2026-06-30T11:58:00.000Z",
        parentId: null,
      },
      {
        id: "assistant-needs-human",
        role: "assistant",
        text: "Please approve the next step.",
        createdAt: "2026-06-30T11:59:00.000Z",
        parentId: "existing-user",
        responseMetadata: {
          familiarId: "sage",
          harness: "claude",
          model: "anthropic/claude-sonnet-4-6",
          runtime: `local:${projectRoot}`,
          attentionRequest: {
            sessionId: "offline-chat-1",
            turnId: "assistant-needs-human",
            requestedAt: "2026-06-30T11:59:00.000Z",
            reason: "approval",
          },
        },
      },
    ],
    activeLeafId: "assistant-needs-human",
  });
  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:00:00.000Z"));

  const response = await POST(
    new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "sage",
        prompt: "queued during travel mode",
        projectRoot,
        sessionId: "offline-chat-1",
        runId: "run-offline-1",
        parentTurnId: "assistant-needs-human",
      }),
    }),
  );
  const queuedEvents = await readSse(response);
  assert.equal(queuedEvents.find((event) => event.kind === "session")?.sessionId, "offline-chat-1");
  assert.equal(queuedEvents.findLast((event) => event.kind === "done")?.isError, false);

  const queuedState = await config.loadState();
  const queuedItem = queuedState.travel.offlineQueue[0];
  assert.ok(queuedItem);
  const queuedUserTurnId = String(queuedItem.payload?.userTurnId);
  const queuedConversation = await conversations.loadConversation("offline-chat-1");
  const queuedUserTurn = queuedConversation?.turns.find((turn) => turn.id === queuedUserTurnId);
  assert.ok(queuedConversation && queuedUserTurn);
  queuedUserTurn.createdAt = "2026-06-30T12:01:00.000Z";
  queuedConversation.updatedAt = "2026-06-30T12:01:00.000Z";
  await conversations.saveConversation(queuedConversation);
  await config.completeOfflineTravelItem(queuedItem.id);
  const replayItem = await config.enqueueOfflineTravelItem(
    {
      kind: "chat",
      summary: queuedItem.summary,
      payload: queuedItem.payload,
    },
    new Date("2026-06-30T12:01:00.000Z"),
  );

  const firstReplay = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(firstReplay, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(sessionRequests.length, 1);
  const pendingState = await config.loadState();
  assert.equal(
    pendingState.travel.offlineQueue.find((item) => item.id === queuedItem.id)?.status,
    "synced",
  );
  assert.equal(
    pendingState.travel.offlineQueue.find((item) => item.id === replayItem.id)?.status,
    "syncing",
    "running daemon sessions stay retryable instead of being marked synced",
  );
  const pendingConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(
    pendingConversation?.turns.filter((turn) => turn.parentId === queuedUserTurnId && turn.role === "assistant").length,
    0,
  );

  sessionPhase = "completed";
  await config.recordTravelHubReachability(true, new Date("2026-07-03T12:05:00.000Z"));
  const secondReplay = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(secondReplay, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(sessionRequests.length, 1, "replay reuses the recorded daemon session id");

  const syncedState = await config.loadState();
  assert.equal(syncedState.travel.offlineQueue.find((item) => item.id === replayItem.id)?.status, "synced");
  const replayedConversation = await conversations.loadConversation("offline-chat-1");
  const mirroredAssistant = replayedConversation?.turns.find(
    (turn) => turn.role === "assistant" && turn.parentId === queuedUserTurnId,
  );
  assert.equal(mirroredAssistant?.text, "Queued reply from daemon.");
  assert.equal(mirroredAssistant?.createdAt, "2026-06-30T12:05:00.000Z");
  assert.equal(
    mirroredAssistant?.responseMetadata?.attentionRequest?.requestedAt,
    "2026-06-30T12:05:00.000Z",
    "attention age should come from daemon completion time, not delayed reconcile time",
  );

  const merged = mergeSessionRows({
    daemonSessions: [
      {
        id: "hub-session-1",
        project_root: projectRoot,
        harness: "claude",
        title: "daemon replay row",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: replayItem.createdAt,
        updated_at: "2026-07-03T12:05:00.000Z",
      },
    ],
    localConversations: await conversations.listConversations(),
    state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
    includeArchived: false,
  });
  assert.equal(merged[0]?.id, "offline-chat-1");
  assert.deepEqual(merged[0]?.attention, {
    state: "overdue-human",
    since: "2026-06-30T12:05:00.000Z",
    reason: "approval",
  });

  console.log("offline-queue-replay.integration.test.ts: ok");
} finally {
  await closeHub();
  await rm(scratchRoot, { recursive: true, force: true });
  if (previousEnv.COVEN_HOME === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousEnv.COVEN_HOME;
  if (previousEnv.COVEN_CAVE_HOME === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousEnv.COVEN_CAVE_HOME;
  if (previousEnv.COVEN_SOCKET === undefined) delete process.env.COVEN_SOCKET;
  else process.env.COVEN_SOCKET = previousEnv.COVEN_SOCKET;
  if (previousEnv.CAVE_PROJECTS_PATH_OVERRIDE === undefined) delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  else process.env.CAVE_PROJECTS_PATH_OVERRIDE = previousEnv.CAVE_PROJECTS_PATH_OVERRIDE;
}
