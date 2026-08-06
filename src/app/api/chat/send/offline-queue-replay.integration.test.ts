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
let nextSession = 1;
let server: http.Server | null = null;
const sessionResponses: Array<Record<string, unknown>> = [];

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
      res.end(JSON.stringify(sessionResponses.shift() ?? { id: `hub-session-${nextSession++}`, status: "running" }));
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

  await config.saveConfig({
    defaults: { harness: "claude", model: "anthropic/claude-sonnet-4-6" },
    familiars: { sage: { harness: "claude" } },
    multiHost: { mode: "hub", hubUrl, executorUrls: [] },
  });

  const project = await createProject({ name: "Offline replay fixture", root: projectRoot });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });
  await conversations.saveConversation({
    sessionId: "offline-chat-1",
    harnessSessionId: "native-claude-session",
    familiarId: "sage",
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    runtime: `local:${projectRoot}`,
    title: "Existing offline chat",
    createdAt: "2026-06-30T11:58:00.000Z",
    updatedAt: "2026-06-30T11:59:00.000Z",
    replaySessions: [{
      sessionId: "older-daemon-replay",
      createdAt: "2026-06-30T11:57:00.000Z",
      updatedAt: "2026-06-30T11:57:00.000Z",
    }],
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
    queuedConversation?.harnessSessionId,
    "native-claude-session",
    "queue-time persistence preserves the validated native resume id even when replay metadata already exists",
  );
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

  await config.completeOfflineTravelItem(queuedItem.id);
  const replayItem = await config.enqueueOfflineTravelItem({
    kind: "chat",
    summary: queuedItem.summary,
    payload: {
      ...queuedItem.payload,
      modelControls: undefined,
      reasoningEffort: undefined,
      responseSpeed: undefined,
    },
  });
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:02:00.000Z"));
  const replayResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(replayResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(sessionRequests.length, 1, "the first replay should spawn exactly one daemon session");
  assert.match(
    String(sessionRequests[0]?.prompt),
    /^queued during travel mode[\s\S]*queue-context\.txt[\s\S]*queue proof/,
  );
  assert.equal(sessionRequests[0]?.harness, "claude");

  const syncedState = await config.loadState();
  const syncedItem = syncedState.travel.offlineQueue.find((item) => item.id === replayItem.id);
  assert.equal(syncedItem?.status, "synced");
  assert.equal(
    syncedItem?.payload?.replaySessionId,
    "hub-session-1",
    "successful replay durably records the daemon execution row only as replay metadata",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(syncedItem?.payload ?? {}, "harnessSessionId"),
    false,
    "the daemon execution row is never written into native-session payload metadata",
  );

  const replayedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(
    replayedConversation?.harnessSessionId,
    "native-claude-session",
    "replay persistence cannot replace an existing native resume id with the daemon execution row",
  );
  assert.equal(
    replayedConversation?.turns.length,
    3,
    "successful replay should not duplicate the queued user turn or mirror an assistant turn",
  );
  assert.equal(
    replayedConversation?.turns.filter((turn) => turn.id === queuedUserTurnId).length,
    1,
  );
  assert.equal(
    replayedConversation?.turns.some((turn) => turn.parentId === queuedUserTurnId),
    false,
    "baseline replay transport must not claim an assistant reply",
  );
  const replayedSummary = (await conversations.listConversations()).find((conv) => conv.sessionId === "offline-chat-1");
  assert.deepEqual(
    replayedSummary?.attentionEvidence,
    queuedSummary?.attentionEvidence,
    "status-only replay must not fabricate assistant attention or mutate queued causal evidence",
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
  assert.deepEqual(
    merged[0]?.attention,
    { state: "none", since: null, reason: null },
    "the queued human evidence should clear canonical session-list attention immediately",
  );

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

  await config.failOfflineTravelItem(replayItem.id, "force retry");
  const retryResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(retryResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(
    sessionRequests.length,
    1,
    "retrying a replay after the daemon session id was recorded must not spawn a second daemon session",
  );
  const retriedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(retriedConversation?.turns.length, 3);
  assert.equal(
    retriedConversation?.turns.filter((turn) => turn.id === queuedUserTurnId).length,
    1,
    "duplicate/retry persistence remains idempotent by stable user-turn id",
  );

  const replayCases = [
    {
      sessionId: "offline-chat-equal",
      createdAt: "2026-06-30T12:03:00.000Z",
      response: { id: "hub-session-2", status: "running", conversation_id: "hub-session-2" },
      expectedReplaySession: {
        sessionId: "hub-session-2",
        conversationId: "hub-session-2",
        createdAt: "2026-06-30T12:03:00.000Z",
        updatedAt: "2026-06-30T12:03:00.000Z",
      },
    },
    {
      sessionId: "offline-chat-distinct",
      createdAt: "2026-06-30T12:04:00.000Z",
      response: { id: "hub-session-3", status: "running", conversationId: "daemon-conversation-3" },
      expectedReplaySession: {
        sessionId: "hub-session-3",
        conversationId: "daemon-conversation-3",
        createdAt: "2026-06-30T12:04:00.000Z",
        updatedAt: "2026-06-30T12:04:00.000Z",
      },
    },
  ] as const;
  for (const replayCase of replayCases) {
    await conversations.persistQueuedOfflineConversation({
      sessionId: replayCase.sessionId,
      familiarId: "sage",
      harness: "claude",
      createdAt: replayCase.createdAt,
      userTurn: {
        id: `${replayCase.sessionId}-user`,
        text: `queued ${replayCase.sessionId}`,
      },
    });
    const extraItem = await config.enqueueOfflineTravelItem({
      kind: "chat",
      summary: replayCase.sessionId,
      payload: {
        familiarId: "sage",
        prompt: `queued ${replayCase.sessionId}`,
        sessionId: replayCase.sessionId,
        userTurnId: `${replayCase.sessionId}-user`,
        projectRoot,
      },
    });
    sessionResponses.push(replayCase.response);
    const extraReplayResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
    assert.deepEqual(extraReplayResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
    const extraState = await config.loadState();
    const extraSynced = extraState.travel.offlineQueue.find((item) => item.id === extraItem.id);
    assert.equal(extraSynced?.payload?.replaySessionId, replayCase.expectedReplaySession.sessionId);
    assert.equal(
      Object.prototype.hasOwnProperty.call(extraSynced?.payload ?? {}, "harnessSessionId"),
      false,
      "new replay payloads do not mislabel daemon ids as native harness ids",
    );
    const extraConversation = await conversations.loadConversation(replayCase.sessionId);
    assert.equal(
      extraConversation?.harnessSessionId,
      undefined,
      "new offline conversations leave the native resume id unset",
    );
    assert.equal(extraConversation?.replaySessions?.length, 1);
    assert.equal(extraConversation?.replaySessions?.[0]?.sessionId, replayCase.expectedReplaySession.sessionId);
    assert.equal(
      extraConversation?.replaySessions?.[0]?.conversationId,
      replayCase.expectedReplaySession.conversationId,
    );
  }

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
