// @ts-nocheck
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

const sessionRequests: Array<Record<string, unknown>> = [];
let nextSession = 1;
let server: http.Server | null = null;

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

async function listenHub(port = 0): Promise<number> {
  server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/sessions") {
      sessionRequests.push(await readJson(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `hub-session-${nextSession++}`, status: "running" }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ apiVersion: "coven.daemon.v1", covenVersion: "test", daemon: { status: "ok" } }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object" && typeof address.port === "number");
  return address.port;
}

async function closeHub(): Promise<void> {
  const closing = server;
  server = null;
  if (!closing?.listening) return;
  await new Promise<void>((resolve, reject) => closing.close((error) => (error ? reject(error) : resolve())));
}

async function readSse(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return events;
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
  const {
    applyChatAttentionProjections,
    chatAttentionProjectionScopeKey,
    createChatAttentionProjectionState,
    recordChatAttentionClear,
    settleChatAttentionClear,
  } = await import("@/lib/chat-attention-projection.ts");
  const { mergeSessionRows } = await import("@/lib/session-list-merge.ts");

  await config.saveConfig({
    defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
    familiars: { sage: { harness: "codex" } },
    multiHost: { mode: "hub", hubUrl, executorUrls: [] },
  });

  const project = await createProject({ name: "Offline replay fixture", root: projectRoot });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });
  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:00:00.000Z"));

  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "queued during travel mode",
      projectRoot,
      sessionId: "offline-chat-1",
      runId: " run-offline-1 ",
      parentTurnId: null,
      attachments: [{
        name: "queue-context.txt",
        type: "text/plain",
        size: 11,
        text: "queue proof",
      }],
    }),
  }));
  const queuedEvents = await readSse(response);
  assert.equal(queuedEvents.find((event) => event.kind === "session")?.sessionId, "offline-chat-1");
  assert.equal(queuedEvents.findLast((event) => event.kind === "done")?.isError, false);

  const queuedState = await config.loadState();
  const queuedItem = queuedState.travel.offlineQueue[0];
  assert.ok(queuedItem, "offline chat send should queue one travel item");
  assert.equal(queuedItem.payload?.sessionId, "offline-chat-1");
  assert.equal(queuedItem.payload?.runId, "run-offline-1");
  assert.equal(typeof queuedItem.payload?.userTurnId, "string");
  assert.equal(queuedItem.payload?.parentTurnId, null);
  assert.deepEqual(queuedItem.payload?.attachments, [{
    name: "queue-context.txt",
    type: "text/plain",
    size: 11,
    text: "queue proof",
  }]);
  assert.equal("replaySessionId" in (queuedItem.payload ?? {}), false);
  assert.equal("daemonSessionId" in (queuedItem.payload ?? {}), false);
  assert.equal("conversationId" in (queuedItem.payload ?? {}), false);

  const queuedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(queuedConversation?.turns.length, 1, "queue acceptance should persist the original user turn");
  assert.equal(queuedConversation?.turns[0]?.role, "user");
  assert.equal(queuedConversation?.turns[0]?.id, queuedItem.payload?.userTurnId);
  assert.equal(queuedConversation?.turns[0]?.parentId, null);
  assert.deepEqual(queuedConversation?.turns[0]?.attachments, [{
    name: "queue-context.txt",
    type: "text/plain",
    size: 11,
    text: "queue proof",
  }]);
  assert.equal(queuedConversation?.turns[0]?.attentionClearOperationId, "run-offline-1");
  assert.equal(
    queuedConversation?.pendingUserTurnId,
    undefined,
    "queued offline chats are accepted, not left as pending first-turn stubs",
  );

  const queuedSummary = (await conversations.listConversations()).find((conv) => conv.sessionId === "offline-chat-1");
  assert.deepEqual(queuedSummary?.attentionEvidence, {
    latestCompletedTurn: { role: "user", at: queuedItem.createdAt },
    latestUserTurnAt: queuedItem.createdAt,
    attentionAfterOperationId: "run-offline-1",
    attentionOperationLineage: ["run-offline-1"],
    request: null,
  });

  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:02:00.000Z"));
  const replayResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(replayResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(sessionRequests.length, 1, "the first replay should spawn exactly one daemon session");
  assert.match(String(sessionRequests[0]?.prompt), /queued during travel mode/);
  assert.match(String(sessionRequests[0]?.prompt), /queue-context\.txt/);
  assert.equal(sessionRequests[0]?.harness, "codex");
  assert.equal("conversation" in (sessionRequests[0] ?? {}), false);
  assert.equal("conversationId" in (sessionRequests[0] ?? {}), false);

  const syncedState = await config.loadState();
  const syncedItem = syncedState.travel.offlineQueue[0];
  assert.equal(syncedItem?.status, "synced");
  assert.equal(
    syncedItem?.payload?.harnessSessionId,
    "hub-session-1",
    "successful replay should durably record the daemon session id for retries",
  );

  const replayedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(replayedConversation?.harnessSessionId, "hub-session-1");
  assert.equal(
    replayedConversation?.turns.length,
    1,
    "successful replay should not duplicate the already persisted offline user turn",
  );
  assert.equal(replayedConversation?.turns[0]?.id, queuedItem.payload?.userTurnId);
  assert.equal(replayedConversation?.turns[0]?.attentionClearOperationId, "run-offline-1");

  const merged = mergeSessionRows({
    daemonSessions: [
      {
        id: "hub-session-1",
        project_root: projectRoot,
        harness: "codex",
        title: "daemon replay row",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: queuedItem.createdAt,
        updated_at: "2026-06-30T12:02:05.000Z",
      },
    ],
    localConversations: await conversations.listConversations(),
    state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
    includeArchived: false,
  });
  assert.equal(merged[0]?.id, "offline-chat-1");
  assert.equal(merged[0]?.attentionAfterOperationId, "run-offline-1");
  assert.equal(merged[0]?.status, "completed");

  const projection = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey(null);
  const baselineAttention = {
    state: "awaiting-human" as const,
    since: "2026-06-30T11:59:00.000Z",
    reason: "approval" as const,
  };
  assert.equal(
    recordChatAttentionClear(projection, "offline-chat-1", "run-offline-1", scopeKey, baselineAttention).recorded,
    true,
  );
  settleChatAttentionClear(projection, "offline-chat-1", "run-offline-1", "persisted", 1);
  const projectedRows = applyChatAttentionProjections(projection, merged, 1, scopeKey);
  assert.equal(projectedRows[0]?.attentionAfterOperationId, "run-offline-1");
  assert.equal(
    projection.has("offline-chat-1"),
    false,
    "once the flushed row carries the original operation id, the optimistic projection retires",
  );

  await config.failOfflineTravelItem(queuedItem.id, "force retry");
  const retryResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(retryResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(
    sessionRequests.length,
    1,
    "retrying a replay after the daemon session id was recorded must not spawn a second daemon session",
  );
  assert.equal((await conversations.loadConversation("offline-chat-1"))?.turns.length, 1);

  // A separate process can sacrifice a queued transcript after queue
  // acceptance but before a reconnect. Replay must acquire the shared
  // conversation fence and reject that durable generation before its daemon
  // POST, so this prompt is never dispatched.
  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:03:00.000Z"));
  const deletedConversationId = "offline-chat-deleted-before-dispatch";
  const deletedQueueResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "this deleted offline prompt must never reach the hub",
      projectRoot,
      sessionId: deletedConversationId,
    }),
  }));
  await readSse(deletedQueueResponse);
  const deletedQueue = (await config.loadState()).travel.offlineQueue.find(
    (item) => item.payload?.sessionId === deletedConversationId,
  );
  assert.ok(deletedQueue);
  const conversationRouteUrl = pathToFileURL(
    path.resolve("src/app/api/chat/conversation/[id]/route.ts"),
  ).href;
  await execFileAsync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/test-alias-register.mjs",
      "--input-type=module",
      "--eval",
      `
        const { DELETE } = await import(${JSON.stringify(conversationRouteUrl)});
        const response = await DELETE(
          new Request("http://test/api/chat/conversation/${deletedConversationId}", { method: "DELETE" }),
          { params: Promise.resolve({ id: ${JSON.stringify(deletedConversationId)} }) },
        );
        if (response.status !== 200) throw new Error("delete failed: " + response.status);
      `,
    ],
    { cwd: process.cwd(), env: { ...process.env }, windowsHide: true },
  );
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:04:00.000Z"));
  const blockedReplay = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.equal(blockedReplay.attempted, 1);
  assert.equal(blockedReplay.synced, 0);
  assert.equal(blockedReplay.failed, 1);
  assert.match(blockedReplay.errors[0]?.error ?? "", /conversation deleted before offline replay dispatch/);
  assert.equal(
    sessionRequests.length,
    1,
    "a cross-process delete before replay must prevent the daemon from receiving the queued prompt",
  );
  assert.equal(
    (await config.loadState()).travel.offlineQueue.find((item) => item.id === deletedQueue.id)?.status,
    "failed",
  );

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
