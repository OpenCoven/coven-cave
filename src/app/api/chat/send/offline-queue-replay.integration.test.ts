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
const sessionLookupRequests: string[] = [];
let nextSession = 1;
let server: http.Server | null = null;
const sessionResponses: Array<Record<string, unknown>> = [];
const sessionRecords = new Map<string, Record<string, unknown>>();

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
      const response = sessionResponses.shift() ?? { id: `hub-session-${nextSession++}`, status: "running" };
      if (typeof response.id === "string") sessionRecords.set(response.id, response);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/v1/sessions/")) {
      const sessionId = decodeURIComponent(req.url.slice("/api/v1/sessions/".length));
      sessionLookupRequests.push(sessionId);
      const response = sessionRecords.get(sessionId);
      if (response) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(response));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
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
  const sendRuntime = await import("./chat-send-runtime.ts");
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

  await conversations.saveConversation({
    sessionId: "offline-chat-requeue-without-native",
    familiarId: "sage",
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    runtime: `local:${projectRoot}`,
    title: "Replay-backed offline chat",
    createdAt: "2026-06-30T12:00:30.000Z",
    updatedAt: "2026-06-30T12:00:30.000Z",
    replaySessions: [{
      sessionId: "hub-session-unrecovered-native",
      createdAt: "2026-06-30T12:00:30.000Z",
      updatedAt: "2026-06-30T12:00:30.000Z",
    }],
    turns: [{
      id: "offline-chat-requeue-existing-user",
      role: "user",
      text: "Earlier queued turn",
      createdAt: "2026-06-30T12:00:30.000Z",
      parentId: null,
    }],
    activeLeafId: "offline-chat-requeue-existing-user",
  });
  const lookupCountBeforeOfflineRequeue = sessionLookupRequests.length;
  const requeueResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "queue another turn without native continuity",
      projectRoot,
      sessionId: "offline-chat-requeue-without-native",
      parentTurnId: "offline-chat-requeue-existing-user",
    }),
  }));
  const requeuedEvents = await readSse(requeueResponse);
  assert.equal(
    requeuedEvents.find((event) => event.kind === "session")?.sessionId,
    "offline-chat-requeue-without-native",
  );
  assert.equal(requeuedEvents.findLast((event) => event.kind === "done")?.isError, false);
  assert.equal(
    sessionLookupRequests.length,
    lookupCountBeforeOfflineRequeue,
    "travel-local queueing must not probe an unreachable hub for replay/native continuity",
  );
  const requeuedConversation = await conversations.loadConversation("offline-chat-requeue-without-native");
  assert.equal(requeuedConversation?.harnessSessionId, undefined);
  assert.equal(requeuedConversation?.turns.length, 2);
  assert.equal(
    requeuedConversation?.turns.at(-1)?.text,
    "queue another turn without native continuity",
    "queue acceptance persists the local user turn before reporting success",
  );
  const requeuedState = await config.loadState();
  const requeuedItem = requeuedState.travel.offlineQueue.find(
    (item) => item.payload?.sessionId === "offline-chat-requeue-without-native",
  );
  assert.ok(requeuedItem);
  await config.completeOfflineTravelItem(requeuedItem.id);

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
  assert.equal(sessionRequests[0]?.launchMode, "nonInteractive");
  assert.deepEqual(sessionRequests[0]?.conversation, {
    mode: "resume",
    id: "native-claude-session",
  });

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
      replayCase.expectedReplaySession.conversationId === replayCase.expectedReplaySession.sessionId
        ? undefined
        : replayCase.expectedReplaySession.conversationId,
      "offline replay promotes only distinct daemon-returned native conversation ids onto the stable transcript",
    );
    assert.equal(extraConversation?.replaySessions?.length, 1);
    assert.equal(extraConversation?.replaySessions?.[0]?.sessionId, replayCase.expectedReplaySession.sessionId);
    assert.equal(
      extraConversation?.replaySessions?.[0]?.conversationId,
      replayCase.expectedReplaySession.conversationId,
    );
  }

  await conversations.persistQueuedOfflineConversation({
    sessionId: "offline-chat-resolve-live",
    familiarId: "sage",
    harness: "claude",
    createdAt: "2026-06-30T12:05:00.000Z",
    userTurn: {
      id: "offline-chat-resolve-live-user",
      text: "queued offline-chat-resolve-live",
    },
  });
  await config.enqueueOfflineTravelItem({
    kind: "chat",
    summary: "offline-chat-resolve-live",
    payload: {
      familiarId: "sage",
      prompt: "queued offline-chat-resolve-live",
      sessionId: "offline-chat-resolve-live",
      userTurnId: "offline-chat-resolve-live-user",
      projectRoot,
    },
  });
  sessionResponses.push({ id: "hub-session-resolve-live", status: "completed" });
  assert.deepEqual(
    await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 }),
    { attempted: 1, synced: 1, failed: 0, errors: [] },
  );
  sessionRecords.set("hub-session-resolve-live", {
    id: "hub-session-resolve-live",
    status: "completed",
    conversation_id: "native-thread-resolved-live",
    updated_at: "2026-06-30T12:05:30.000Z",
  });
  assert.deepEqual(
    await sendRuntime.resolveReplayBackedResumeSessionId("offline-chat-resolve-live"),
    { ok: true, resumeSessionId: "native-thread-resolved-live", replayBound: true },
    "the next live resume resolves the canonical daemon conversation id instead of forking from the stable Cave id",
  );
  assert.equal(
    (await conversations.loadConversation("offline-chat-resolve-live"))?.harnessSessionId,
    "native-thread-resolved-live",
  );

  await conversations.persistQueuedOfflineConversation({
    sessionId: "offline-chat-running-wait",
    familiarId: "sage",
    harness: "claude",
    createdAt: "2026-06-30T12:06:00.000Z",
    userTurn: {
      id: "offline-chat-running-wait-user",
      text: "queued offline-chat-running-wait",
    },
  });
  await config.enqueueOfflineTravelItem({
    kind: "chat",
    summary: "offline-chat-running-wait",
    payload: {
      familiarId: "sage",
      prompt: "queued offline-chat-running-wait",
      sessionId: "offline-chat-running-wait",
      userTurnId: "offline-chat-running-wait-user",
      projectRoot,
    },
  });
  sessionResponses.push({ id: "hub-session-running-wait", status: "running" });
  assert.deepEqual(
    await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 }),
    { attempted: 1, synced: 1, failed: 0, errors: [] },
  );
  const runningResolution = await sendRuntime.resolveReplayBackedResumeSessionId("offline-chat-running-wait");
  assert.equal(runningResolution.ok, false);
  assert.equal(runningResolution.code, "conversation_continuity_syncing");
  assert.equal(runningResolution.retryable, true);
  assert.match(runningResolution.error, /Retry in a moment/i);
  assert.equal(
    (await conversations.loadConversation("offline-chat-running-wait"))?.harnessSessionId,
    undefined,
    "a still-running daemon replay must refuse fallback instead of stamping the stable Cave id as native continuity",
  );
  sessionRecords.set("hub-session-running-wait", {
    id: "hub-session-running-wait",
    status: "completed",
    conversationId: "native-thread-retry-success",
    updated_at: "2026-06-30T12:06:30.000Z",
  });
  assert.deepEqual(
    await sendRuntime.resolveReplayBackedResumeSessionId("offline-chat-running-wait"),
    { ok: true, resumeSessionId: "native-thread-retry-success", replayBound: true },
    "retrying after the daemon publishes conversation_id succeeds and persists the native resume id",
  );

  await conversations.persistQueuedOfflineConversation({
    sessionId: "offline-chat-terminal-missing",
    familiarId: "sage",
    harness: "claude",
    createdAt: "2026-06-30T12:07:00.000Z",
    userTurn: {
      id: "offline-chat-terminal-missing-user",
      text: "queued offline-chat-terminal-missing",
    },
  });
  await config.enqueueOfflineTravelItem({
    kind: "chat",
    summary: "offline-chat-terminal-missing",
    payload: {
      familiarId: "sage",
      prompt: "queued offline-chat-terminal-missing",
      sessionId: "offline-chat-terminal-missing",
      userTurnId: "offline-chat-terminal-missing-user",
      projectRoot,
    },
  });
  sessionResponses.push({ id: "hub-session-terminal-missing", status: "failed" });
  assert.deepEqual(
    await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 }),
    { attempted: 1, synced: 1, failed: 0, errors: [] },
  );
  const terminalResolution = await sendRuntime.resolveReplayBackedResumeSessionId("offline-chat-terminal-missing");
  assert.equal(terminalResolution.ok, false);
  assert.equal(terminalResolution.code, "conversation_continuity_unavailable");
  assert.equal(terminalResolution.retryable, false);
  assert.match(terminalResolution.error, /will not fall back/i);

  await conversations.persistQueuedOfflineConversation({
    sessionId: "offline-chat-malicious-id",
    familiarId: "sage",
    harness: "claude",
    createdAt: "2026-06-30T12:08:00.000Z",
    userTurn: {
      id: "offline-chat-malicious-id-user",
      text: "queued offline-chat-malicious-id",
    },
  });
  await config.enqueueOfflineTravelItem({
    kind: "chat",
    summary: "offline-chat-malicious-id",
    payload: {
      familiarId: "sage",
      prompt: "queued offline-chat-malicious-id",
      sessionId: "offline-chat-malicious-id",
      userTurnId: "offline-chat-malicious-id-user",
      projectRoot,
    },
  });
  sessionResponses.push({ id: "hub-session-malicious-id", status: "completed" });
  assert.deepEqual(
    await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 }),
    { attempted: 1, synced: 1, failed: 0, errors: [] },
  );
  sessionRecords.set("hub-session-malicious-id", {
    id: "hub-session-malicious-id",
    status: "completed",
    conversation_id: "../malicious",
  });
  const maliciousResolution = await sendRuntime.resolveReplayBackedResumeSessionId("offline-chat-malicious-id");
  assert.equal(maliciousResolution.ok, false);
  assert.equal(maliciousResolution.code, "conversation_continuity_unavailable");
  assert.equal(
    (await conversations.loadConversation("offline-chat-malicious-id"))?.harnessSessionId,
    undefined,
    "malicious daemon conversation ids are rejected instead of being cached as native continuity",
  );

  await conversations.saveConversation({
    sessionId: "offline-chat-consecutive",
    familiarId: "sage",
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    runtime: `local:${projectRoot}`,
    title: "Consecutive offline chat",
    createdAt: "2026-06-30T12:09:00.000Z",
    updatedAt: "2026-06-30T12:09:00.000Z",
    replaySessions: [
      {
        sessionId: "hub-history-valid",
        conversationId: "native-thread-history",
        createdAt: "2026-06-30T12:08:00.000Z",
        updatedAt: "2026-06-30T12:08:00.000Z",
      },
      {
        sessionId: "hub-history-equal",
        conversationId: "hub-history-equal",
        createdAt: "2026-06-30T12:08:30.000Z",
        updatedAt: "2026-06-30T12:08:30.000Z",
      },
      {
        sessionId: "hub-history-malicious",
        createdAt: "2026-06-30T12:08:45.000Z",
        updatedAt: "2026-06-30T12:08:45.000Z",
      },
    ],
    turns: [{
      id: "offline-chat-consecutive-root",
      role: "user",
      text: "root",
      createdAt: "2026-06-30T12:09:00.000Z",
      parentId: null,
    }],
    activeLeafId: "offline-chat-consecutive-root",
  });
  for (const [index, createdAt] of [
    "2026-06-30T12:10:00.000Z",
    "2026-06-30T12:11:00.000Z",
    "2026-06-30T12:12:00.000Z",
  ].entries()) {
    const turnNumber = index + 1;
    const userTurnId = `offline-chat-consecutive-user-${turnNumber}`;
    const parentId = turnNumber === 1
      ? "offline-chat-consecutive-root"
      : `offline-chat-consecutive-user-${turnNumber - 1}`;
    await conversations.persistQueuedOfflineConversation({
      sessionId: "offline-chat-consecutive",
      familiarId: "sage",
      harness: "claude",
      createdAt,
      userTurn: {
        id: userTurnId,
        text: `queued consecutive turn ${turnNumber}`,
        parentId,
      },
    });
    await config.enqueueOfflineTravelItem({
      kind: "chat",
      summary: `offline-chat-consecutive-${turnNumber}`,
      payload: {
        familiarId: "sage",
        prompt: `queued consecutive turn ${turnNumber}`,
        sessionId: "offline-chat-consecutive",
        userTurnId,
        parentTurnId: parentId,
        projectRoot,
      },
    });
  }
  const requestCountBeforeConsecutive = sessionRequests.length;
  sessionResponses.push(
    { id: "hub-consecutive-1", status: "running", conversationId: "native-thread-1" },
    { id: "hub-consecutive-2", status: "running", conversationId: "native-thread-2" },
    { id: "hub-consecutive-3", status: "running", conversationId: "native-thread-3" },
  );
  assert.deepEqual(
    await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 3 }),
    { attempted: 3, synced: 3, failed: 0, errors: [] },
  );
  const consecutiveRequests = sessionRequests.slice(requestCountBeforeConsecutive);
  assert.equal(consecutiveRequests.length, 3);
  assert.deepEqual(consecutiveRequests[0]?.conversation, {
    mode: "resume",
    id: "native-thread-history",
  }, "first replay falls back to the newest valid recorded native replay conversation id");
  assert.deepEqual(consecutiveRequests[1]?.conversation, {
    mode: "resume",
    id: "native-thread-1",
  }, "second replay promotes the daemon-returned native conversation id instead of reusing the daemon session id");
  assert.deepEqual(consecutiveRequests[2]?.conversation, {
    mode: "resume",
    id: "native-thread-2",
  }, "third replay reuses the latest promoted native conversation id after consecutive fresh offline turns");
  assert.equal(
    (await conversations.loadConversation("offline-chat-consecutive"))?.harnessSessionId,
    "native-thread-3",
    "consecutive replays promote each recovered native conversation id onto the stable transcript",
  );

  await conversations.persistQueuedOfflineConversation({
    sessionId: "offline-chat-crash-retry",
    familiarId: "sage",
    harness: "claude",
    createdAt: "2026-06-30T12:13:00.000Z",
    userTurn: {
      id: "offline-chat-crash-retry-user-1",
      text: "queued crash retry turn 1",
    },
  });
  const crashRetryItem = await config.enqueueOfflineTravelItem({
    kind: "chat",
    summary: "offline-chat-crash-retry-1",
    payload: {
      familiarId: "sage",
      prompt: "queued crash retry turn 1",
      sessionId: "offline-chat-crash-retry",
      userTurnId: "offline-chat-crash-retry-user-1",
      projectRoot,
      replaySessionId: "hub-crash-retry-1",
      conversationId: "native-thread-crash",
    },
  });
  const requestCountBeforeCrashRetry = sessionRequests.length;
  assert.deepEqual(
    await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 }),
    { attempted: 1, synced: 1, failed: 0, errors: [] },
  );
  assert.equal(
    sessionRequests.length,
    requestCountBeforeCrashRetry,
    "retrying a replay that already persisted daemon/native ids must not spawn a second daemon session after a crash",
  );
  assert.equal(
    (await conversations.loadConversation("offline-chat-crash-retry"))?.harnessSessionId,
    "native-thread-crash",
    "crash-retry replay state promotes the saved native conversation id before the next queued send launches",
  );
  await conversations.persistQueuedOfflineConversation({
    sessionId: "offline-chat-crash-retry",
    familiarId: "sage",
    harness: "claude",
    createdAt: "2026-06-30T12:14:00.000Z",
    userTurn: {
      id: "offline-chat-crash-retry-user-2",
      text: "queued crash retry turn 2",
      parentId: "offline-chat-crash-retry-user-1",
    },
  });
  await config.enqueueOfflineTravelItem({
    kind: "chat",
    summary: "offline-chat-crash-retry-2",
    payload: {
      familiarId: "sage",
      prompt: "queued crash retry turn 2",
      sessionId: "offline-chat-crash-retry",
      userTurnId: "offline-chat-crash-retry-user-2",
      parentTurnId: "offline-chat-crash-retry-user-1",
      projectRoot,
    },
  });
  sessionResponses.push({ id: "hub-crash-retry-2", status: "running", conversationId: "native-thread-crash-2" });
  assert.deepEqual(
    await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 }),
    { attempted: 1, synced: 1, failed: 0, errors: [] },
  );
  assert.deepEqual(
    sessionRequests.at(-1)?.conversation,
    { mode: "resume", id: "native-thread-crash" },
    "the first launch after a crash retry resumes the promoted native thread rather than the daemon replay session id",
  );
  const crashRetryState = await config.loadState();
  assert.equal(
    crashRetryState.travel.offlineQueue.find((item) => item.id === crashRetryItem.id)?.status,
    "synced",
  );

  await config.saveConfig({
    defaults: { harness: "claude", model: "anthropic/claude-sonnet-4-6" },
    familiars: {
      sage: { harness: "claude" },
      pilot: { harness: "copilot" },
    },
    multiHost: { mode: "hub", hubUrl, executorUrls: [] },
  });
  await grantProjectToFamiliar({ familiarId: "pilot", projectId: project.id, source: "human", access: "write" });
  await conversations.persistQueuedOfflineConversation({
    sessionId: "offline-chat-copilot-blocked",
    familiarId: "pilot",
    harness: "copilot",
    createdAt: "2026-06-30T12:15:00.000Z",
    userTurn: {
      id: "offline-chat-copilot-blocked-user",
      text: "multi word prompt for copilot replay",
    },
  });
  const copilotBlocked = await config.enqueueOfflineTravelItem({
    kind: "chat",
    summary: "offline-chat-copilot-blocked",
    payload: {
      familiarId: "pilot",
      prompt: "multi word prompt for copilot replay",
      sessionId: "offline-chat-copilot-blocked",
      userTurnId: "offline-chat-copilot-blocked-user",
      projectRoot,
    },
  });
  const requestCountBeforeCopilotReplay = sessionRequests.length;
  assert.deepEqual(
    await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 }),
    {
      attempted: 1,
      synced: 0,
      failed: 1,
      errors: [{
        id: copilotBlocked.id,
        error: "Offline Copilot replay cannot safely use the daemon's non-interactive session API yet. Reconnect to the hub, reopen this chat online, and retry so Cave can resume Copilot through its supported live path.",
      }],
    },
  );
  assert.equal(
    sessionRequests.length,
    requestCountBeforeCopilotReplay,
    "offline Copilot replay must fail closed before any daemon session spawn is attempted",
  );
  const copilotBlockedState = await config.loadState();
  const copilotBlockedItem = copilotBlockedState.travel.offlineQueue.find((item) => item.id === copilotBlocked.id);
  assert.equal(copilotBlockedItem?.status, "failed");
  assert.match(
    copilotBlockedItem?.lastError ?? "",
    /reopen this chat online, and retry/i,
    "offline Copilot replay surfaces a retryable, actionable error instead of silently launching a broken non-interactive session",
  );
  assert.equal(
    (await conversations.loadConversation("offline-chat-copilot-blocked"))?.replaySessions?.length ?? 0,
    0,
    "a blocked Copilot replay spawns no daemon session and records no replay metadata",
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
