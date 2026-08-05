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
const daemonSessions = new Map<string, {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  completion_at: string;
  events: Array<{ kind: string; payload_json: string }>;
}>();
const replayPolls = new Map<string, number>();

function arbitraryOutputChunks(value: string): string[] {
  const widths = [13, 47, 5, 89, 23];
  const chunks: string[] = [];
  let cursor = 0;
  let widthIndex = 0;
  while (cursor < value.length) {
    const width = widths[widthIndex % widths.length]!;
    chunks.push(value.slice(cursor, cursor + width));
    cursor += width;
    widthIndex += 1;
  }
  return chunks;
}

function daemonTranscript(harness: string, prompt: string): string {
  if (harness === "claude") {
    return [
      "Working through it.",
      '{"answer":42}',
      "data: literal answer",
      "event: literal event",
      '<coven:attention reason="approval" />',
    ].join("\n") + "\n";
  }

  if (harness === "copilot") {
    return [
      "Working through it.",
      '{"answer":42}',
      "data: literal answer",
      "event: literal event",
      '<coven:attention reason="approval" />',
    ].join("\n") + "\n";
  }
  return [
    "OpenAI Codex",
    "--------",
    `workdir: ${projectRoot}`,
    "model: gpt-test",
    "user",
    prompt,
    "codex",
    "Working through it.",
    "exec",
    `/bin/zsh -lc 'cat private.txt' in ${projectRoot}`,
    "succeeded in 5ms:",
    "TOOL OUTPUT MUST NEVER BE MIRRORED",
    "",
    '<coven:attention reason="approval" />',
    "tokens used",
    "123",
  ].join("\n") + "\n";
}

function daemonOutputEvents(transcript: string): Array<{ kind: string; payload_json: string }> {
  return arbitraryOutputChunks(transcript).map((data) => ({
    kind: "output",
    payload_json: JSON.stringify({ data }),
  }));
}

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
      const sessionNumber = nextSession++;
      const id = `hub-session-${sessionNumber}`;
      const launchedPrompt = typeof body.prompt === "string" ? body.prompt : "";
      const launchedHarness = typeof body.harness === "string" ? body.harness : "codex";
      if (launchedPrompt.includes("force daemon launch failure")) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "forced daemon launch failure" } }));
        return;
      }
      const outputOnly = launchedPrompt.includes("queued session that only ever emits raw daemon output");
      const truncatedReplay = launchedPrompt.includes("queued session whose replay output truncates");
      const malformedReplayEnvelope = launchedPrompt.includes("queued session whose replay output envelope is malformed");
      const transcript = outputOnly
        ? "raw PTY text without a verified assistant boundary"
        : daemonTranscript(launchedHarness, launchedPrompt);
      const events = truncatedReplay
        ? [
            ...daemonOutputEvents(transcript),
            { kind: "output_truncated", payload_json: JSON.stringify({ droppedEvents: 1, droppedBytes: 128 }) },
          ]
        : malformedReplayEnvelope
          ? [
              ...daemonOutputEvents(transcript).slice(0, 1),
              { kind: "output", payload_json: JSON.stringify({ notData: "oops" }) },
            ]
          : daemonOutputEvents(transcript);
      daemonSessions.set(id, {
        id,
        status: "running",
        created_at: "2026-06-30T12:02:00.000Z",
        updated_at: "2026-06-30T12:02:00.000Z",
        completion_at: sessionNumber === 1
          ? "2026-06-30T12:02:05.000Z"
          : "2099-06-30T12:02:05.000Z",
        events,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, status: "running" }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions") {
      for (const session of daemonSessions.values()) {
        const seen = (replayPolls.get(session.id) ?? 0) + 1;
        replayPolls.set(session.id, seen);
        if (seen >= 2) {
          session.status = "completed";
          session.updated_at = session.completion_at;
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([...daemonSessions.values()].map((session) => ({
        id: session.id,
        project_root: projectRoot,
        harness: "codex",
        title: "daemon replay row",
        status: session.status,
        exit_code: session.status === "completed" ? 0 : null,
        archived_at: null,
        created_at: session.created_at,
        updated_at: session.updated_at,
      }))));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/v1/events?")) {
      const url = new URL(req.url, "http://127.0.0.1");
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const session = daemonSessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        events: session.events.map((event, index) => ({
          seq: index + 1,
          id: `${sessionId}-output-${index + 1}`,
          session_id: sessionId,
          kind: event.kind,
          payload_json: event.payload_json,
          created_at: session.updated_at,
        })),
        nextCursor: { afterSeq: session.events.length },
        hasMore: false,
      }));
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
    defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
    familiars: {
      sage: { harness: "codex" },
      charm: { harness: "claude" },
      nova: { harness: "copilot" },
      opal: { harness: "opencode" },
    },
    multiHost: { mode: "hub", hubUrl, executorUrls: [] },
  });

  const project = await createProject({ name: "Offline replay fixture", root: projectRoot });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });
  await grantProjectToFamiliar({ familiarId: "charm", projectId: project.id, source: "human", access: "write" });
  await grantProjectToFamiliar({ familiarId: "nova", projectId: project.id, source: "human", access: "write" });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });
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

  const queuedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(queuedConversation?.turns.length, 1, "queue acceptance should persist the original user turn");
  assert.equal(queuedConversation?.turns[0]?.role, "user");
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
    request: null,
  });

  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:02:00.000Z"));
  const replayResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(replayResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(sessionRequests.length, 1, "the first replay should spawn exactly one daemon session");
  const replayPrompt = String(sessionRequests[0]?.prompt ?? "");
  assert.equal(
    replayPrompt.split("queued during travel mode").length - 1,
    1,
    "the replay prompt contains the original user prompt exactly once",
  );
  assert.equal(
    replayPrompt.split('<coven:attention reason="input|approval|credentials|decision" />').length - 1,
    1,
    "the replay prompt carries the shared attention-marker protocol exactly once",
  );
  assert.equal(sessionRequests[0]?.harness, "codex");
  assert.equal(sessionRequests[0]?.launchMode, "nonInteractive");

  const syncedState = await config.loadState();
  const syncedItem = syncedState.travel.offlineQueue[0];
  assert.equal(syncedItem?.status, "syncing", "the replay stays syncing until the daemon transcript is durably mirrored");
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
    "spawning the daemon session must not duplicate the already persisted offline user turn",
  );
  assert.equal(replayedConversation?.turns[0]?.attentionClearOperationId, "run-offline-1");

  const completedResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(completedResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
  const completedConversation = await conversations.loadConversation("offline-chat-1");
  assert.equal(completedConversation?.turns.length, 2, "completion persists exactly one assistant reply back into the original conversation");
  assert.equal(completedConversation?.turns[1]?.role, "assistant");
  assert.equal(
    completedConversation?.turns[1]?.text,
    "Working through it.",
    "the mirrored assistant reply strips the raw attention marker but keeps ordinary text visible",
  );
  const behindAssistant = completedConversation?.turns[1];
  const behindRequest = behindAssistant?.responseMetadata?.attentionRequest;
  await config.completeOfflineTravelItem(queuedItem.id);

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:02:10.000Z"));
  await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "charm",
      prompt: "queued during travel mode for Claude",
      projectRoot,
      sessionId: "offline-chat-claude",
      runId: "run-offline-claude",
    }),
  })));
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:02:11.000Z"));
  const claudeSpawn = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(claudeSpawn, { attempted: 1, synced: 1, failed: 0, errors: [] });
  const claudeRequest = [...sessionRequests].reverse().find((request) =>
    String(request.prompt ?? "").includes("queued during travel mode for Claude")
  );
  const claudePrompt = String(claudeRequest?.prompt ?? "");
  assert.equal(claudeRequest?.harness, "claude");
  assert.equal(claudeRequest?.launchMode, "nonInteractive");
  assert.equal(
    claudePrompt.split("queued during travel mode for Claude").length - 1,
    1,
    "Claude replay keeps the multi-word human prompt intact",
  );
  const requestsAfterClaudeSpawn = sessionRequests.length;
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.equal(
    sessionRequests.length,
    requestsAfterClaudeSpawn,
    "Claude replay re-polls the existing daemon session instead of spawning duplicates",
  );
  assert.equal(
    (await conversations.loadConversation("offline-chat-claude"))?.turns.at(-1)?.text,
    [
      "Working through it.",
      '{"answer":42}',
      "data: literal answer",
      "event: literal event",
    ].join("\n"),
    "offline replay mirrors plain output without interpreting JSON or SSE-looking prose",
  );

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:02:12.000Z"));
  await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "nova",
      prompt: "queued multi word Copilot replay prompt",
      projectRoot,
      sessionId: "offline-chat-copilot",
      runId: "run-offline-copilot",
    }),
  })));
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:02:13.000Z"));
  const copilotSpawn = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(copilotSpawn, { attempted: 1, synced: 1, failed: 0, errors: [] });
  const copilotRequest = sessionRequests.at(-1);
  assert.equal(copilotRequest?.harness, "copilot");
  assert.equal(copilotRequest?.launchMode, "nonInteractive");
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.equal(
    (await conversations.loadConversation("offline-chat-copilot"))?.turns.at(-1)?.text,
    [
      "Working through it.",
      '{"answer":42}',
      "data: literal answer",
      "event: literal event",
    ].join("\n"),
  );

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:02:14.000Z"));
  await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      prompt: "queued OpenCode replay must fail before spawn",
      projectRoot,
      sessionId: "offline-chat-opencode",
      runId: "run-offline-opencode",
    }),
  })));
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:02:15.000Z"));
  const requestsBeforeUnsupportedReplay = sessionRequests.length;
  const openCodeReplay = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.equal(openCodeReplay.attempted, 1);
  assert.equal(openCodeReplay.synced, 0);
  assert.equal(openCodeReplay.failed, 1);
  assert.match(
    openCodeReplay.errors[0]?.error ?? "",
    /nonInteractive plain stdout does not separate assistant replies from tool or control output/i,
  );
  assert.equal(
    sessionRequests.length,
    requestsBeforeUnsupportedReplay,
    "unsupported replay output contracts fail before launching a daemon session",
  );
  const unsupportedItem = (await config.loadState()).travel.offlineQueue.find(
    (item) => item.payload?.sessionId === "offline-chat-opencode",
  );
  assert.ok(unsupportedItem);
  await config.completeOfflineTravelItem(unsupportedItem.id);

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
  const mergedOfflineReplay = merged.find((row) => row.id === "offline-chat-1");
  assert.equal(mergedOfflineReplay?.id, "offline-chat-1");
  assert.equal(mergedOfflineReplay?.attentionAfterOperationId, "run-offline-1");
  assert.equal(mergedOfflineReplay?.status, "completed");
  assert.equal(mergedOfflineReplay?.attention.state, "awaiting-human");

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
  const projectedOfflineReplay = projectedRows.find((row) => row.id === "offline-chat-1");
  assert.equal(projectedOfflineReplay?.attentionAfterOperationId, "run-offline-1");
  assert.equal(
    projectedOfflineReplay?.attention.state,
    "awaiting-human",
    "the mirrored assistant reply reveals the accepted post-clear request instead of masking it forever",
  );
  assert.equal(projection.has("offline-chat-1"), false);

  const requestCountBeforeRetry = sessionRequests.length;
  await config.failOfflineTravelItem(queuedItem.id, "force retry");
  const retryResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.deepEqual(retryResult, { attempted: 1, synced: 1, failed: 0, errors: [] });
  assert.equal(
    sessionRequests.length,
    requestCountBeforeRetry,
    "retrying a replay after the daemon session id was recorded must not spawn a second daemon session",
  );
  assert.equal(
    (await conversations.loadConversation("offline-chat-1"))?.turns.length,
    2,
    "retrying a completed replay must not duplicate the mirrored assistant turn",
  );

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:03:00.000Z"));
  const aheadResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "queued for ahead-clock replay",
      projectRoot,
      sessionId: "offline-chat-ahead",
      runId: "run-offline-ahead",
    }),
  }));
  await readSse(aheadResponse);

  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:04:00.000Z"));
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });

  const aheadConversation = await conversations.loadConversation("offline-chat-ahead");
  const aheadAssistant = aheadConversation?.turns[1];
  const aheadRequest = aheadAssistant?.responseMetadata?.attentionRequest;
  const attentionBySession = new Map(
    (await conversations.listConversations()).map((conversation) => [
      conversation.sessionId,
      conversation.attentionEvidence?.request,
    ]),
  );
  assert.deepEqual(
    [
      {
        skew: "hub-behind",
        mirroredLocally: behindRequest?.requestedAt === behindAssistant?.createdAt,
        requestValid: attentionBySession.get("offline-chat-1")?.turnId === behindAssistant?.id,
      },
      {
        skew: "hub-ahead",
        mirroredLocally: aheadRequest?.requestedAt === aheadAssistant?.createdAt,
        requestValid: attentionBySession.get("offline-chat-ahead")?.turnId === aheadAssistant?.id,
      },
    ],
    [
      { skew: "hub-behind", mirroredLocally: true, requestValid: true },
      { skew: "hub-ahead", mirroredLocally: true, requestValid: true },
    ],
    "hub clock skew must not invalidate replayed attention requests",
  );

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:05:00.000Z"));
  const outputOnlyResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "charm",
      prompt: "queued session that only ever emits raw daemon output",
      projectRoot,
      sessionId: "offline-chat-output-only",
      runId: "run-offline-output-only",
    }),
  }));
  await readSse(outputOnlyResponse);
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:06:00.000Z"));

  const spawnResult = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.equal(spawnResult.failed, 0, "spawning the daemon session must not itself fail the item");
  const outputOnlyState = await config.loadState();
  const outputOnlyItem = outputOnlyState.travel.offlineQueue.find(
    (entry) => entry.payload?.sessionId === "offline-chat-output-only",
  );
  assert.ok(outputOnlyItem, "the raw-output-only chat should still be queued after spawning");

  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });

  const outputOnlyFinalState = await config.loadState();
  assert.equal(
    outputOnlyFinalState.travel.offlineQueue.find((entry) => entry.id === outputOnlyItem?.id)?.status,
    "synced",
    "the plain-output item stays durably synced after its reply is mirrored",
  );
  const outputOnlyConversation = await conversations.loadConversation("offline-chat-output-only");
  assert.equal(
    outputOnlyConversation?.turns.length,
    2,
    "plain daemon output is persisted as the mirrored assistant turn",
  );
  assert.equal(
    outputOnlyConversation?.turns[1]?.text,
    "raw PTY text without a verified assistant boundary",
    "a direct plain-output harness does not require structured framing",
  );

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:06:30.000Z"));
  await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "queued session whose replay output truncates",
      projectRoot,
      sessionId: "offline-chat-truncated",
      runId: "run-offline-truncated",
    }),
  })));
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:06:40.000Z"));
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  const truncatedFailure = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  assert.equal(truncatedFailure.failed, 1);
  assert.match(truncatedFailure.errors[0]?.error ?? "", /truncated/i);
  const truncatedState = await config.loadState();
  const truncatedItem = truncatedState.travel.offlineQueue.find(
    (entry) => entry.payload?.sessionId === "offline-chat-truncated",
  );
  assert.equal(truncatedItem?.status, "failed", "truncated replay output leaves the queue item retryable");
  const truncatedConversation = await conversations.loadConversation("offline-chat-truncated");
  assert.equal(truncatedConversation?.turns.length, 1, "truncated replay output must not persist a partial assistant turn");
  await config.completeOfflineTravelItem(truncatedItem.id);
  assert.equal(
    (await config.loadState()).travel.offlineQueue.find((entry) => entry.id === truncatedItem.id)?.status,
    "synced",
  );

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:07:00.000Z"));
  for (const body of [
    {
      familiarId: "sage",
      prompt: "serialized first reply",
      projectRoot,
      sessionId: "offline-chat-serialized",
      runId: "run-serialized-first",
    },
    {
      familiarId: "sage",
      prompt: "serialized second reply",
      projectRoot,
      sessionId: "offline-chat-serialized",
      runId: "run-serialized-second",
    },
    {
      familiarId: "sage",
      prompt: "independent reply may continue",
      projectRoot,
      sessionId: "offline-chat-independent",
      runId: "run-independent",
    },
  ]) {
    await readSse(await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })));
  }

  const serialQueuedState = await config.loadState();
  const serialItems = serialQueuedState.travel.offlineQueue.filter(
    (entry) => entry.payload?.sessionId === "offline-chat-serialized",
  );
  assert.equal(serialItems.length, 2);
  const firstSerialItem = serialItems[0];
  const secondSerialItem = serialItems[1];
  assert.ok(firstSerialItem?.payload?.userTurnId);
  assert.ok(secondSerialItem?.payload?.userTurnId);

  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:08:00.000Z"));
  const serialRequestStart = sessionRequests.length;
  const firstSerialPass = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 2 });
  assert.deepEqual(firstSerialPass, { attempted: 2, synced: 2, failed: 0, errors: [] });
  const firstSerialPrompts = sessionRequests
    .slice(serialRequestStart)
    .map((request) => String(request.prompt ?? ""));
  assert.deepEqual(
    firstSerialPrompts.map((prompt) => [
      prompt.includes("serialized first reply"),
      prompt.includes("serialized second reply"),
      prompt.includes("independent reply may continue"),
    ]),
    [
      [true, false, false],
      [false, false, true],
    ],
    "a pending first chat blocks its later same-conversation item without consuming the independent attempt",
  );
  const afterFirstSerialPass = await config.loadState();
  const deferredSerialItem = afterFirstSerialPass.travel.offlineQueue.find(
    (entry) => entry.id === secondSerialItem.id,
  );
  assert.equal(deferredSerialItem?.status, "pending");
  assert.equal(
    deferredSerialItem?.payload?.harnessSessionId,
    undefined,
    "the blocked later chat must not spawn a daemon session",
  );

  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 3 });
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 3 });
  const completedSerialState = await config.loadState();
  const completedSecondSerialItem = completedSerialState.travel.offlineQueue.find(
    (entry) => entry.id === secondSerialItem.id,
  );
  const serialConversation = await conversations.loadConversation("offline-chat-serialized");
  const firstSerialAssistantId = `${firstSerialItem.payload.userTurnId}:offline-replay-assistant`;
  const secondSerialAssistantId = `${secondSerialItem.payload.userTurnId}:offline-replay-assistant`;
  assert.equal(
    serialConversation?.turns.find((turn) => turn.id === firstSerialAssistantId)?.parentId,
    firstSerialItem.payload.userTurnId,
  );
  assert.equal(
    serialConversation?.turns.find((turn) => turn.id === secondSerialAssistantId)?.parentId,
    secondSerialItem.payload.userTurnId,
  );
  assert.equal(serialConversation?.activeLeafId, secondSerialAssistantId);
  assert.equal(serialConversation?.harnessSessionId, completedSecondSerialItem?.payload?.harnessSessionId);

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:09:00.000Z"));
  await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt: "stale completion reply",
      projectRoot,
      sessionId: "offline-chat-stale-completion",
      runId: "run-stale-completion",
    }),
  })));
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:10:00.000Z"));
  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  const staleQueuedState = await config.loadState();
  const staleItem = staleQueuedState.travel.offlineQueue.find(
    (entry) => entry.payload?.sessionId === "offline-chat-stale-completion",
  );
  assert.ok(staleItem?.payload?.userTurnId);
  const staleConversation = await conversations.loadConversation("offline-chat-stale-completion");
  assert.ok(staleConversation);
  staleConversation.turns.push({
    id: "newer-active-user",
    role: "user",
    text: "newer active branch",
    createdAt: "2026-06-30T12:10:01.000Z",
    parentId: staleItem.payload.userTurnId,
  });
  staleConversation.activeLeafId = "newer-active-user";
  staleConversation.harnessSessionId = "newer-harness-session";
  await conversations.saveConversation(staleConversation);

  await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 1 });
  const afterStaleCompletion = await conversations.loadConversation("offline-chat-stale-completion");
  assert.equal(afterStaleCompletion?.activeLeafId, "newer-active-user");
  assert.equal(afterStaleCompletion?.harnessSessionId, "newer-harness-session");
  assert.equal(
    afterStaleCompletion?.turns.find(
      (turn) => turn.id === `${staleItem.payload.userTurnId}:offline-replay-assistant`,
    )?.parentId,
    staleItem.payload.userTurnId,
    "the stale reply remains durable on its causal branch without selecting that branch",
  );

  await config.recordTravelHubReachability(false, new Date("2026-06-30T12:11:00.000Z"));
  for (const body of [
    {
      familiarId: "sage",
      prompt: "force daemon launch failure",
      projectRoot,
      sessionId: "offline-chat-failed-serial",
      runId: "run-failed-serial-first",
    },
    {
      familiarId: "sage",
      prompt: "must wait behind failed earlier reply",
      projectRoot,
      sessionId: "offline-chat-failed-serial",
      runId: "run-failed-serial-second",
    },
    {
      familiarId: "sage",
      prompt: "independent reply after failure",
      projectRoot,
      sessionId: "offline-chat-after-failure",
      runId: "run-after-failure",
    },
  ]) {
    await readSse(await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })));
  }
  await config.recordTravelHubReachability(true, new Date("2026-06-30T12:12:00.000Z"));
  const failedRequestStart = sessionRequests.length;
  const failedSerialPass = await replay.syncOfflineTravelQueue(await config.loadConfig(), { maxItems: 2 });
  assert.equal(failedSerialPass.attempted, 2);
  assert.equal(failedSerialPass.failed, 1);
  const failedSerialPrompts = sessionRequests
    .slice(failedRequestStart)
    .map((request) => String(request.prompt ?? ""));
  assert.deepEqual(
    failedSerialPrompts.map((prompt) => [
      prompt.includes("force daemon launch failure"),
      prompt.includes("must wait behind failed earlier reply"),
      prompt.includes("independent reply after failure"),
    ]),
    [
      [true, false, false],
      [false, false, true],
    ],
    "a failed first chat blocks its later same-conversation item while independent work continues",
  );
  const failedSerialState = await config.loadState();
  assert.equal(
    failedSerialState.travel.offlineQueue.find(
      (entry) => entry.payload?.runId === "run-failed-serial-second",
    )?.status,
    "pending",
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
  daemonSessions.clear();
  replayPolls.clear();
}
