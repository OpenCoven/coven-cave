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

const sessionRequests: Array<Record<string, unknown>> = [];
const sessionRecords = new Map<string, Record<string, unknown>>();
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
      const body = await readJson(req);
      sessionRequests.push(body);
      const id = `hub-session-${nextSession++}`;
      sessionRecords.set(id, {
        id,
        status: "running",
        title: typeof body.title === "string" ? body.title : "offline replay",
        updated_at: "2026-06-30T12:02:01.000Z",
        conversation_id: null,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, status: "running" }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/v1/sessions/")) {
      const id = req.url.slice("/api/v1/sessions/".length);
      const record = sessionRecords.get(id);
      if (!record) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(record));
      return;
    }
    if (req.method === "GET" && req.url === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ apiVersion: "1", covenVersion: "test", daemon: { status: "ok" } }));
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
  const { filterVisibleChatSessions } = await import("@/lib/chat-projects.ts");

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

  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "queued during travel mode",
      projectRoot,
      sessionId: "offline-chat-1",
      runId: " run-offline-1 ",
      parentTurnId: "assistant-needs-human",
      attachments: [
        {
          name: "queue-context.txt",
          type: "text/plain",
          size: 11,
          text: "queue proof",
        },
      ],
      modelControls: { reasoning: "medium" },
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
  assert.equal(
    Object.prototype.hasOwnProperty.call(queuedItem.payload, "permissionMode"),
    false,
    "the baseline queue payload must not promise permission-mode replay",
  );

  const queuedConversation = await conversations.loadConversation("offline-chat-1");
  const queuedUserTurnId = String(queuedItem.payload?.userTurnId);
  const queuedUserTurns = queuedConversation?.turns.filter((turn) => turn.id === queuedUserTurnId) ?? [];
  assert.equal(queuedConversation?.turns.length, 3, "queue acceptance should append only the original user turn");
  assert.equal(queuedUserTurns.length, 1, "the queued stable user-turn id should occur exactly once");
  assert.equal(queuedUserTurns[0]?.role, "user");
  assert.equal(queuedUserTurns[0]?.parentId, "assistant-needs-human");
  assert.equal(queuedUserTurns[0]?.attentionClearOperationId, "run-offline-1");
  assert.deepEqual(queuedUserTurns[0]?.attachments, [
    {
      name: "queue-context.txt",
      type: "text/plain",
      size: 11,
      text: "queue proof",
    },
  ]);
  assert.deepEqual(queuedUserTurns[0]?.modelControls, { reasoning: "medium" });
  assert.equal(queuedConversation?.activeLeafId, queuedUserTurnId);
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
  assert.equal(
    queuedSummary?.attentionEvidence?.attentionOperationLineage?.includes("run-unrelated"),
    false,
    "queued summaries must keep only the selected path's causal clear ancestry",
  );

  const secondResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "second queued prompt",
      projectRoot,
      sessionId: "offline-chat-1",
      runId: "run-offline-2",
    }),
  }));
  const secondQueuedEvents = await readSse(secondResponse);
  assert.equal(secondQueuedEvents.find((event) => event.kind === "session")?.sessionId, "offline-chat-1");
  assert.equal(secondQueuedEvents.findLast((event) => event.kind === "done")?.isError, false);
  const afterSecondQueue = await config.loadState();
  assert.equal(afterSecondQueue.travel.offlineQueue.length, 2, "same-session offline sends should queue independently");
  const firstReplayItem = afterSecondQueue.travel.offlineQueue[0];
  const secondReplayItem = afterSecondQueue.travel.offlineQueue[1];
  const secondQueuedSummary = (await conversations.listConversations()).find((conv) => conv.sessionId === "offline-chat-1");
  await config.updateOfflineTravelItemPayload(firstReplayItem.id, {
    ...firstReplayItem.payload,
    modelControls: undefined,
    reasoningEffort: undefined,
    responseSpeed: undefined,
  });

  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:02:00.000Z"));
  const replayResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 2 });
  assert.deepEqual(replayResult, { attempted: 2, synced: 0, failed: 0, errors: [] });
  assert.equal(sessionRequests.length, 1, "the first replay should spawn exactly one daemon session");
  assert.match(
    String(sessionRequests[0]?.prompt),
    /^queued during travel mode[\s\S]*queue-context\.txt[\s\S]*queue proof/,
  );
  assert.equal(sessionRequests[0]?.harness, "claude");
  const inFlightState = await config.loadState();
  assert.equal(inFlightState.travel.offlineQueue[0]?.status, "syncing");
  assert.equal(inFlightState.travel.offlineQueue[1]?.status, "syncing");
  assert.equal(
    Object.hasOwn(sessionRequests[0] ?? {}, "conversation"),
    false,
    "the first replay should start fresh when no validated daemon conversation id exists yet",
  );

  sessionRecords.set("hub-session-1", {
    id: "hub-session-1",
    status: "completed",
    title: "daemon replay row 1",
    updated_at: "2026-06-30T12:02:05.000Z",
    conversation_id: "conv-offline-1",
  });
  const resumeResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 2 });
  assert.deepEqual(resumeResult, { attempted: 2, synced: 1, failed: 0, errors: [] });
  assert.equal(sessionRequests.length, 2, "the second queued prompt should wait for the first replay to finish");
  assert.deepEqual(sessionRequests[1]?.conversation, { mode: "resume", id: "conv-offline-1" });
  assert.equal(sessionRequests[1]?.conversationId, "conv-offline-1");

  const syncedState = await config.loadState();
  const syncedItem = syncedState.travel.offlineQueue.find((item) => item.id === firstReplayItem.id);
  const pendingItem = syncedState.travel.offlineQueue.find((item) => item.id === secondReplayItem.id);
  assert.equal(syncedItem?.status, "synced");
  assert.equal(pendingItem?.status, "syncing");
  assert.equal(
    syncedItem?.payload?.replaySessionId ?? syncedItem?.payload?.harnessSessionId,
    "hub-session-1",
    "successful replay should durably record the daemon session id for retries",
  );

  sessionRecords.set("hub-session-2", {
    id: "hub-session-2",
    status: "completed",
    title: "daemon replay row 2",
    updated_at: "2026-06-30T12:02:09.000Z",
    conversation_id: "conv-offline-1",
  });
  const finalReplayResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 2 });
  assert.deepEqual(finalReplayResult, { attempted: 1, synced: 1, failed: 0, errors: [] });

  const replayedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(replayedConversation?.harnessSessionId, "conv-offline-1");
  assert.equal(
    replayedConversation?.turns.length,
    4,
    "successful replay should not duplicate queued user turns or mirror assistant output",
  );
  assert.equal(
    replayedConversation?.turns.filter((turn) => turn.id === queuedUserTurnId).length,
    1,
  );
  assert.deepEqual(
    replayedConversation?.replaySessions?.map((entry) => ({
      sessionId: entry.sessionId,
      conversationId: entry.conversationId,
    })),
    [
      { sessionId: "hub-session-1", conversationId: "conv-offline-1" },
      { sessionId: "hub-session-2", conversationId: "conv-offline-1" },
    ],
    "the local conversation should preserve every replayed daemon run in order",
  );
  assert.equal(
    replayedConversation?.turns.some((turn) => turn.role === "assistant" && turn.parentId === queuedUserTurnId),
    false,
    "baseline replay transport must not claim an assistant reply",
  );
  const replayedSummary = (await conversations.listConversations()).find((conv) => conv.sessionId === "offline-chat-1");
  assert.deepEqual(
    replayedSummary?.attentionEvidence,
    secondQueuedSummary?.attentionEvidence,
    "status-only replay must not fabricate assistant attention or mutate queued causal evidence",
  );

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:03:00.000Z"));
  const aliasQueuedResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "follow up through replay alias",
      projectRoot,
      sessionId: "hub-session-1",
      runId: "run-offline-alias",
    }),
  }));
  const aliasQueuedEvents = await readSse(aliasQueuedResponse);
  assert.equal(aliasQueuedEvents.find((event) => event.kind === "session")?.sessionId, "offline-chat-1");
  const aliasQueuedState = await config.loadState();
  const aliasQueuedItem = aliasQueuedState.travel.offlineQueue.find((item) => item.payload?.runId === "run-offline-alias");
  assert.equal(aliasQueuedItem?.payload?.sessionId, "offline-chat-1");
  assert.equal(
    replayedConversation?.turns.some((turn) => turn.text === "follow up through replay alias"),
    false,
    "the pre-queue snapshot must stay unchanged until the newly queued follow-up is durably appended",
  );
  const aliasQueuedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(aliasQueuedConversation?.turns.at(-1)?.text, "follow up through replay alias");
  assert.equal(await conversations.loadConversation("hub-session-1"), null, "offline enqueue must not fork a replay alias file");

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
        created_at: queuedItem.createdAt,
        updated_at: "2026-06-30T12:02:05.000Z",
        conversation_id: "conv-offline-1",
      },
      {
        id: "hub-session-2",
        project_root: projectRoot,
        harness: "claude",
        title: "daemon replay row 2",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: secondReplayItem.createdAt,
        updated_at: "2026-06-30T12:02:09.000Z",
        conversation_id: "conv-offline-1",
      },
    ],
    localConversations: await conversations.listConversations(),
    state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
    includeArchived: false,
  });
  const primaryMerged = merged.find((row) => row.id === "offline-chat-1");
  const historicalReplayRow = merged.find((row) => row.id === "hub-session-1");
  assert.ok(primaryMerged, "the stable Cave conversation should stay reachable");
  assert.ok(historicalReplayRow, "earlier daemon replay rows stay reachable after a later replay");
  assert.equal(primaryMerged?.attentionAfterOperationId, "run-offline-alias");
  assert.equal(primaryMerged?.status, "completed");
  assert.deepEqual(
    primaryMerged?.attention,
    { state: "none", since: null, reason: null },
    "the queued human evidence should clear canonical session-list attention immediately",
  );
  assert.match(String(historicalReplayRow?.title), /Replay 1/);
  assert.equal(historicalReplayRow?.generated, undefined);
  assert.equal(historicalReplayRow?.hasLocalConversation, true);
  assert.ok(
    filterVisibleChatSessions(merged, null).some((row) => row.id === "hub-session-1"),
    "linked replay rows should not be filtered as generated daemon noise",
  );

  const projection = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey(null);
  const baselineAttention = {
    state: "awaiting-human" as const,
    since: "2026-06-30T11:59:00.000Z",
    reason: "approval" as const,
  };
  assert.equal(
    recordChatAttentionClear(projection, "offline-chat-1", "run-offline-alias", scopeKey, baselineAttention).recorded,
    true,
  );
  settleChatAttentionClear(projection, "offline-chat-1", "run-offline-alias", "persisted", 1);
  const projectedRows = applyChatAttentionProjections(projection, merged, 1, scopeKey);
  assert.equal(projectedRows.find((row) => row.id === "offline-chat-1")?.attentionAfterOperationId, "run-offline-alias");
  assert.equal(
    projection.has("offline-chat-1"),
    false,
    "once the flushed row carries the original operation id, the optimistic projection retires",
  );

  await config.failOfflineTravelItem(secondReplayItem.id, "force retry");
  const retryResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(retryResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(
    sessionRequests.length,
    2,
    "retrying a replay after the daemon session id was recorded must not spawn a second daemon session",
  );
  const retriedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(retriedConversation?.turns.length, 5);
  assert.equal(
    retriedConversation?.turns.filter((turn) => turn.id === queuedUserTurnId).length,
    1,
    "duplicate/retry persistence remains idempotent by stable user-turn id",
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
