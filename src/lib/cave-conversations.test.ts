// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const previousHome = process.env.HOME;
const previousCovenHome = process.env.COVEN_HOME;
const home = await mkdtemp(path.join(tmpdir(), "cave-conversations-"));
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");

const {
  clearConversationAliasIndexForTests,
  clearConversationListMetadataCache,
  deleteConversation,
  getConversationListMetrics,
  isSafeConversationSessionId,
  listConversations,
  loadConversation,
  persistQueuedOfflineConversation,
  resolveConversationSessionId,
  saveConversation,
} = await import("./cave-conversations.ts");
const {
  mapConversationHistoryTurns,
  retryTurnModelRequest,
} = await import("./chat-turn-state.ts");
const { deriveChatAttention, NO_CHAT_ATTENTION } = await import("./chat-attention.ts");
const { persistedTurnControls } = await import(
  "../app/api/chat/send/chat-send-models.ts"
);

assert.equal(isSafeConversationSessionId("session-1"), true);
assert.equal(isSafeConversationSessionId("019e-a-valid-thread"), true);
assert.equal(isSafeConversationSessionId("../session-1"), false);
assert.equal(isSafeConversationSessionId("nested/session-1"), false);
assert.equal(isSafeConversationSessionId("nested\\session-1"), false);
assert.equal(isSafeConversationSessionId("."), false);
assert.equal(isSafeConversationSessionId(".."), false);
assert.equal(isSafeConversationSessionId(""), false);

assert.deepEqual(
  mapConversationHistoryTurns([{
    id: "turn-progress",
    role: "assistant",
    text: "Safe reply",
    createdAt: "2026-07-25T00:00:00.000Z",
    progress: [{
      id: "opencode-compatibility",
      label: "OpenCode compatibility notice",
      detail: "unrecognized event",
      status: "error",
      createdAt: "2026-07-25T00:00:00.000Z",
    }],
  }]),
  [{
    id: "turn-progress",
    parentId: undefined,
    role: "assistant",
    text: "Safe reply",
    attachments: undefined,
    reasoning: undefined,
    tools: undefined,
    progress: [{
      id: "opencode-compatibility",
      label: "OpenCode compatibility notice",
      detail: "unrecognized event",
      status: "error",
      createdAt: "2026-07-25T00:00:00.000Z",
    }],
    durationMs: undefined,
    usage: undefined,
    costUsd: undefined,
    responseMetadata: undefined,
    modelControls: undefined,
    modelOverrideScope: undefined,
    error: undefined,
    lifecycle: undefined,
    createdAt: "2026-07-25T00:00:00.000Z",
    origin: undefined,
    voiceCallId: undefined,
  }],
  "persisted compatibility diagnostics round-trip into the client transcript after reload",
);

const reloadedRuntimeDefaultTurns = mapConversationHistoryTurns([
  {
    id: "runtime-default-user",
    role: "user",
    text: "Use the provider default",
    modelOverrideScope: "runtime-default",
    createdAt: "2026-07-31T00:00:00.000Z",
  },
  {
    id: "runtime-default-assistant",
    role: "assistant",
    text: "Done",
    createdAt: "2026-07-31T00:00:01.000Z",
  },
]);
assert.equal(
  reloadedRuntimeDefaultTurns[0]?.modelOverrideScope,
  "runtime-default",
  "reload retains model-less Runtime-default intent on the user turn",
);
assert.deepEqual(
  retryTurnModelRequest(
    reloadedRuntimeDefaultTurns[0],
    reloadedRuntimeDefaultTurns[1],
  ),
  { modelOverride: "", modelOverrideScope: "next-message" },
  "regenerate replays Runtime default once without replacing the chat's newer durable model",
);
assert.deepEqual(
  retryTurnModelRequest(
    reloadedRuntimeDefaultTurns[0],
    {
      ...reloadedRuntimeDefaultTurns[1],
      responseMetadata: { retryModel: "anthropic/claude-opus-4-6" },
    },
  ),
  {
    modelOverride: "anthropic/claude-opus-4-6",
    modelOverrideScope: "next-message",
  },
  "an honest concrete retry model remains a one-turn override",
);

const firstRuntimeDefaultRetry = retryTurnModelRequest(
  reloadedRuntimeDefaultTurns[0],
  reloadedRuntimeDefaultTurns[1],
);
const reloadedRuntimeDefaultRetry = mapConversationHistoryTurns([
  {
    id: "runtime-default-retry-user",
    role: "user",
    text: "Retry with the provider default",
    ...persistedTurnControls(firstRuntimeDefaultRetry),
    createdAt: "2026-07-31T00:00:02.000Z",
  },
  {
    id: "runtime-default-retry-assistant",
    role: "assistant",
    text: "Done again",
    createdAt: "2026-07-31T00:00:03.000Z",
  },
]);
assert.deepEqual(
  retryTurnModelRequest(
    reloadedRuntimeDefaultRetry[0],
    reloadedRuntimeDefaultRetry[1],
  ),
  { modelOverride: "", modelOverrideScope: "next-message" },
  "a persisted Runtime-default retry remains retryable after another reload",
);

await saveConversation({
  sessionId: "delete-me",
  familiarId: "charm",
  harness: "codex",
  title: "Delete me",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  turns: [
    {
      id: "turn-1",
      role: "user",
      text: "remove this",
      createdAt: "2026-06-10T00:00:00.000Z",
    },
  ],
});

assert.equal((await loadConversation("delete-me"))?.turns.length, 1);
assert.equal(await deleteConversation("delete-me"), true);
assert.equal(await loadConversation("delete-me"), null);
assert.equal(await deleteConversation("delete-me"), false);

await saveConversation({
  sessionId: "stable-replay-root",
  familiarId: "charm",
  harness: "codex",
  title: "Replay root",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  replaySessions: [{
    sessionId: "hub-replay-root",
    conversationId: "codex-thread-1",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:01.000Z",
  }],
  turns: [],
});
await saveConversation({
  sessionId: "hub-replay-root",
  familiarId: "charm",
  harness: "codex",
  title: "Stray replay alias",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  turns: [],
});
assert.deepEqual(
  await resolveConversationSessionId("hub-replay-root"),
  { sessionId: "stable-replay-root", canonicalized: true },
  "explicit replay history must outrank a same-named stray alias file",
);

await saveConversation({
  sessionId: "stable-self-alias",
  harnessSessionId: "stable-self-alias",
  familiarId: "charm",
  harness: "claude",
  title: "Self alias replay root",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  replaySessions: [{
    sessionId: "hub-self-alias",
    conversationId: "stable-self-alias",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:01.000Z",
  }],
  turns: [],
});
assert.deepEqual(
  await resolveConversationSessionId("stable-self-alias"),
  { sessionId: "stable-self-alias", canonicalized: false },
  "a replay owner naming its stable Cave id as its harness/conversation id stays canonical",
);
assert.deepEqual(
  await resolveConversationSessionId("hub-self-alias"),
  { sessionId: "stable-self-alias", canonicalized: true },
  "a replay daemon id still resolves through an owner self-alias",
);

await saveConversation({
  sessionId: "cycle-replay-root",
  familiarId: "charm",
  harness: "codex",
  title: "Replay cycle root",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  replaySessions: [{
    sessionId: "hub-replay-cycle",
    conversationId: "codex-thread-2",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:01.000Z",
  }],
  turns: [],
});
await saveConversation({
  sessionId: "hub-replay-cycle",
  familiarId: "charm",
  harness: "codex",
  title: "Replay cycle alias",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  replaySessions: [{
    sessionId: "cycle-replay-root",
    conversationId: "codex-thread-2",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:01.000Z",
  }],
  turns: [],
});
assert.deepEqual(
  await resolveConversationSessionId("hub-replay-cycle"),
  { sessionId: null, error: "cyclic-replay-history" },
  "cyclic replay mappings should fail closed instead of picking an arbitrary local file",
);
await deleteConversation("stable-replay-root");
await deleteConversation("hub-replay-root");
await deleteConversation("stable-self-alias");
await deleteConversation("cycle-replay-root");
await deleteConversation("hub-replay-cycle");

await saveConversation({
  sessionId: "alias-perf-root",
  harnessSessionId: "native-alias-perf",
  familiarId: "charm",
  harness: "codex",
  title: "Alias performance root",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  replaySessions: [{
    sessionId: "daemon-alias-perf",
    conversationId: "daemon-conversation-perf",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:01.000Z",
  }],
  turns: [],
});
await saveConversation({
  sessionId: "alias-perf-delete",
  familiarId: "charm",
  harness: "codex",
  title: "Alias performance delete",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  replaySessions: [{
    sessionId: "daemon-alias-delete",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:01.000Z",
  }],
  turns: [],
});

clearConversationAliasIndexForTests();
clearConversationListMetadataCache();
const aliasScanCountBefore = getConversationListMetrics().scanCount;
const coldAliasInputs = [
  "alias-perf-root",
  "native-alias-perf",
  "daemon-alias-perf",
  "daemon-conversation-perf",
];
const coldAliasResults = await Promise.all(
  Array.from({ length: 32 }, (_, index) =>
    resolveConversationSessionId(coldAliasInputs[index % coldAliasInputs.length])),
);
assert.ok(
  coldAliasResults.every((result, index) =>
    result.sessionId === "alias-perf-root"
    && result.canonicalized === (coldAliasInputs[index % coldAliasInputs.length] !== "alias-perf-root")),
  "stable ids and native/replay aliases share one canonical index",
);
const coldAliasMetrics = getConversationListMetrics();
assert.equal(
  coldAliasMetrics.scanCount,
  aliasScanCountBefore + 1,
  "concurrent cold alias callers share one compact-summary list scan",
);
assert.equal(
  coldAliasMetrics.cacheMisses,
  coldAliasMetrics.filesSeen,
  "the one cold scan stats and parses each compact summary only once",
);

for (const alias of coldAliasInputs) {
  await resolveConversationSessionId(alias);
}
assert.deepEqual(
  getConversationListMetrics(),
  coldAliasMetrics,
  "warm alias lookups perform no additional list, stat, or parse work",
);

const updatedAliasRoot = await loadConversation("alias-perf-root");
assert.ok(updatedAliasRoot);
updatedAliasRoot.title = "Normal save updates one indexed entry";
await saveConversation(updatedAliasRoot);
assert.deepEqual(
  await resolveConversationSessionId("native-alias-perf"),
  { sessionId: "alias-perf-root", canonicalized: true },
  "a normal save retains the affected native alias without rebuilding the index",
);
assert.deepEqual(
  getConversationListMetrics(),
  coldAliasMetrics,
  "normal saves update the affected alias entry without another store scan",
);

updatedAliasRoot.replaySessions = [{
  sessionId: "daemon-alias-updated",
  createdAt: "2026-06-10T00:02:00.000Z",
  updatedAt: "2026-06-10T00:02:00.000Z",
}];
await saveConversation(updatedAliasRoot);
assert.deepEqual(
  await resolveConversationSessionId("daemon-alias-perf"),
  { sessionId: "daemon-alias-perf", canonicalized: false },
  "saving changed replay mappings removes the old alias incrementally",
);
assert.deepEqual(
  await resolveConversationSessionId("daemon-alias-updated"),
  { sessionId: "alias-perf-root", canonicalized: true },
  "saving changed replay mappings installs the new alias incrementally",
);
assert.deepEqual(getConversationListMetrics(), coldAliasMetrics);

assert.equal(await deleteConversation("alias-perf-root"), true);
assert.deepEqual(
  await resolveConversationSessionId("native-alias-perf"),
  { sessionId: "native-alias-perf", canonicalized: false },
  "delete removes native aliases from the in-memory index",
);
assert.deepEqual(
  await resolveConversationSessionId("daemon-alias-updated"),
  { sessionId: "daemon-alias-updated", canonicalized: false },
  "delete removes replay aliases from the in-memory index",
);
assert.equal(await deleteConversation("alias-perf-delete"), true);
assert.deepEqual(
  await resolveConversationSessionId("daemon-alias-delete"),
  { sessionId: "daemon-alias-delete", canonicalized: false },
  "delete updates the index without rescanning the conversation store",
);
assert.deepEqual(getConversationListMetrics(), coldAliasMetrics);

await persistQueuedOfflineConversation({
  sessionId: "queued-replay-null",
  familiarId: "charm",
  harness: "claude",
  createdAt: "2026-06-10T00:00:00.000Z",
  replaySessionId: "hub-replay-null",
  userTurn: { id: "queued-null-user", text: "queued replay null" },
});
const queuedReplayNull = await loadConversation("queued-replay-null");
assert.equal(
  queuedReplayNull?.harnessSessionId,
  undefined,
  "a daemon replay row id is not a native harness resume token",
);
assert.deepEqual(
  queuedReplayNull?.replaySessions,
  [{
    sessionId: "hub-replay-null",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  }],
);

await persistQueuedOfflineConversation({
  sessionId: "queued-replay-equal",
  familiarId: "charm",
  harness: "claude",
  createdAt: "2026-06-10T00:01:00.000Z",
  replaySessionId: "hub-replay-equal",
  conversationId: "hub-replay-equal",
  userTurn: { id: "queued-equal-user", text: "queued replay equal" },
});
const queuedReplayEqual = await loadConversation("queued-replay-equal");
assert.equal(
  queuedReplayEqual?.harnessSessionId,
  undefined,
  "a daemon conversation id equal to its execution row id is not a native resume token",
);

await saveConversation({
  sessionId: "queued-replay-distinct",
  harnessSessionId: "native-thread-distinct",
  familiarId: "charm",
  harness: "claude",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  replaySessions: [{
    sessionId: "hub-replay-prior",
    createdAt: "2026-06-10T00:01:00.000Z",
    updatedAt: "2026-06-10T00:01:00.000Z",
  }],
  turns: [],
});
await persistQueuedOfflineConversation({
  sessionId: "queued-replay-distinct",
  familiarId: "charm",
  harness: "claude",
  createdAt: "2026-06-10T00:03:00.000Z",
  replaySessionId: "hub-replay-distinct",
  conversationId: "daemon-conversation-alias",
  userTurn: { id: "queued-distinct-user", text: "queued replay distinct" },
});
await persistQueuedOfflineConversation({
  sessionId: "queued-replay-distinct",
  familiarId: "charm",
  harness: "claude",
  createdAt: "2026-06-10T00:02:00.000Z",
  replaySessionId: "hub-replay-older",
  userTurn: { id: "queued-older-user", text: "queued replay older" },
});
const queuedReplayDistinct = await loadConversation("queued-replay-distinct");
assert.equal(
  queuedReplayDistinct?.harnessSessionId,
  "native-thread-distinct",
  "an older replay alias must not overwrite the newer distinct native resume id",
);
assert.deepEqual(
  queuedReplayDistinct?.replaySessions,
  [
    {
      sessionId: "hub-replay-prior",
      createdAt: "2026-06-10T00:01:00.000Z",
      updatedAt: "2026-06-10T00:01:00.000Z",
    },
    {
      sessionId: "hub-replay-distinct",
      conversationId: "daemon-conversation-alias",
      createdAt: "2026-06-10T00:03:00.000Z",
      updatedAt: "2026-06-10T00:03:00.000Z",
    },
    {
      sessionId: "hub-replay-older",
      createdAt: "2026-06-10T00:02:00.000Z",
      updatedAt: "2026-06-10T00:02:00.000Z",
    },
  ],
  "replay aliases remain recorded separately for canonical mapping",
);

await persistQueuedOfflineConversation({
  sessionId: "queued-replay-distinct",
  familiarId: "charm",
  harness: "claude",
  createdAt: "2026-06-10T00:04:00.000Z",
  validatedNativeConversationId: "native-thread-revalidated",
  userTurn: { id: "queued-revalidated-user", text: "queued replay revalidated" },
});
assert.equal(
  (await loadConversation("queued-replay-distinct"))?.harnessSessionId,
  "native-thread-revalidated",
  "only a separately validated native conversation id may replace the native resume token",
);
await deleteConversation("queued-replay-null");
await deleteConversation("queued-replay-equal");
await deleteConversation("queued-replay-distinct");

// CHAT-D5-02: a user-cancelled turn persists as an honest cancelled record —
// partial text kept, cancelled flag set, never re-flagged as an error.
await saveConversation({
  sessionId: "cancelled-turn",
  familiarId: "charm",
  harness: "claude",
  title: "Cancelled mid-stream",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
  turns: [
    {
      id: "turn-user",
      role: "user",
      text: "write me a long poem",
      createdAt: "2026-06-11T00:00:00.000Z",
    },
    {
      id: "turn-assistant",
      role: "assistant",
      text: "Roses are red, violets",
      createdAt: "2026-06-11T00:00:01.000Z",
      isError: false,
      cancelled: true,
    },
  ],
});
const cancelledConv = await loadConversation("cancelled-turn");
const cancelledTurn = cancelledConv?.turns.find((turn) => turn.id === "turn-assistant");
assert.equal(cancelledTurn?.cancelled, true, "cancelled flag must round-trip through the store");
assert.equal(cancelledTurn?.isError, false, "a user cancel is not an error");
assert.equal(cancelledTurn?.text, "Roses are red, violets", "partial streamed text must survive the save");
const cancelledSummary = (await listConversations()).find((row) => row.sessionId === "cancelled-turn");
assert.equal(cancelledSummary?.status, "completed", "cancelled conversations remain non-failures");
assert.equal(cancelledSummary?.exitCode, 0, "cancelled conversations retain a successful exit code");
assert.equal(await deleteConversation("cancelled-turn"), true);

// CHAT-D12-02: per-turn token usage and cost round-trip through the store —
// optional fields that mirror how durationMs flows, absent when the harness
// emitted none (e.g. the OpenClaw bridge).
await saveConversation({
  sessionId: "usage-turn",
  familiarId: "charm",
  harness: "claude",
  title: "Usage and cost",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
  turns: [
    {
      id: "turn-user",
      role: "user",
      text: "how big was that?",
      createdAt: "2026-06-11T00:00:00.000Z",
    },
    {
      id: "turn-assistant",
      role: "assistant",
      text: "Pretty big.",
      createdAt: "2026-06-11T00:00:01.000Z",
      durationMs: 7000,
      isError: false,
      usage: {
        inputTokens: 10200,
        outputTokens: 2150,
        cacheReadTokens: 5000,
        cacheCreationTokens: 1200,
      },
      costUsd: 0.0812,
    },
    {
      id: "turn-assistant-no-usage",
      role: "assistant",
      text: "No billing metadata here.",
      createdAt: "2026-06-11T00:00:02.000Z",
    },
  ],
});
const usageConv = await loadConversation("usage-turn");
const usageTurn = usageConv?.turns.find((turn) => turn.id === "turn-assistant");
assert.deepEqual(
  usageTurn?.usage,
  { inputTokens: 10200, outputTokens: 2150, cacheReadTokens: 5000, cacheCreationTokens: 1200 },
  "token usage must round-trip through the store",
);
assert.equal(usageTurn?.costUsd, 0.0812, "cost must round-trip through the store");
const noUsageTurn = usageConv?.turns.find((turn) => turn.id === "turn-assistant-no-usage");
assert.equal(noUsageTurn?.usage, undefined, "turns without usage stay absent — never fabricated");
assert.equal(noUsageTurn?.costUsd, undefined, "turns without cost stay absent — never fabricated");
assert.equal(await deleteConversation("usage-turn"), true);

await saveConversation({
  sessionId: "summary-ok",
  familiarId: "charm",
  harness: "codex",
  title: "Healthy summary",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z",
  activeLeafId: "summary-ok-assistant",
  turns: [
    {
      id: "summary-ok-user",
      role: "user",
      text: "hello",
      createdAt: "2026-06-12T00:00:00.000Z",
    },
    {
      id: "summary-ok-assistant",
      role: "assistant",
      text: "hello",
      createdAt: "2026-06-12T00:00:01.000Z",
      parentId: "summary-ok-user",
      isError: false,
    },
  ],
});
await saveConversation({
  sessionId: "summary-failed",
  familiarId: "charm",
  harness: "codex",
  title: "Failed summary",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z",
  activeLeafId: "summary-failed-assistant",
  turns: [
    {
      id: "summary-failed-user",
      role: "user",
      text: "fail",
      createdAt: "2026-06-12T00:00:00.000Z",
    },
    {
      id: "summary-failed-assistant",
      role: "assistant",
      text: "failed",
      createdAt: "2026-06-12T00:00:01.000Z",
      parentId: "summary-failed-user",
      isError: true,
    },
  ],
});
const summaries = await listConversations();
const okSummary = summaries.find((conv) => conv.sessionId === "summary-ok");
const failedSummary = summaries.find((conv) => conv.sessionId === "summary-failed");
assert.equal(okSummary?.status, "completed", "conversation summaries expose successful terminal status");
assert.equal(okSummary?.exitCode, 0, "successful conversation summaries expose exit code 0");
assert.equal(failedSummary?.status, "failed", "conversation summaries expose failed terminal status");
assert.equal(failedSummary?.exitCode, 1, "failed conversation summaries expose exit code 1");
assert.equal(await deleteConversation("summary-ok"), true);
assert.equal(await deleteConversation("summary-failed"), true);

await saveConversation({
  sessionId: "legacy-linear-conversation",
  familiarId: "charm",
  harness: "claude",
  title: "Legacy linear conversation",
  createdAt: "2026-06-12T01:00:00.000Z",
  updatedAt: "2026-06-12T01:01:00.000Z",
  turns: [
    {
      id: "legacy-linear-user",
      role: "user",
      text: "Need approval?",
      createdAt: "2026-06-12T01:00:00.000Z",
    },
    {
      id: "legacy-linear-assistant",
      role: "assistant",
      text: "Yes.",
      createdAt: "2026-06-12T01:01:00.000Z",
    },
  ],
});
const legacyLinearConv = await loadConversation("legacy-linear-conversation");
assert.equal(
  legacyLinearConv?.activeLeafId,
  "legacy-linear-assistant",
  "genuinely legacy turns without parentId still linearize to the newest turn",
);
assert.equal(
  legacyLinearConv?.turns[0]?.parentId,
  null,
  "legacy linearization still marks the first historical turn as the root",
);
assert.equal(
  legacyLinearConv?.turns[1]?.parentId,
  "legacy-linear-user",
  "legacy linearization still links later historical turns in createdAt order",
);
assert.equal(await deleteConversation("legacy-linear-conversation"), true);

// Issue #3266: metadata scans read each large transcript once, then use the
// stat-keyed summary cache until that specific file changes.
{
  const {
    clearConversationListMetadataCache,
    CONV_DIR,
    getConversationListMetrics,
  } = await import("./cave-conversations.ts");
  const { mkdir, rm, writeFile, utimes } = await import("node:fs/promises");
  await mkdir(CONV_DIR, { recursive: true });
  const fixtureIds = Array.from({ length: 12 }, (_, index) => `metadata-perf-${index}`);
  const largeText = "x".repeat(128 * 1024);

  for (const [index, sessionId] of fixtureIds.entries()) {
    await writeFile(
      path.join(CONV_DIR, `${sessionId}.json`),
      JSON.stringify({
        sessionId,
        familiarId: "charm",
        harness: "codex",
        title: `Cached ${index}`,
        branch: "main",
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: `2026-06-12T00:00:${String(index).padStart(2, "0")}.000Z`,
        turns: [
          {
            id: `${sessionId}-assistant`,
            role: "assistant",
            text: largeText,
            createdAt: "2026-06-12T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );
  }

  clearConversationListMetadataCache();
  const coldRows = await listConversations();
  const cold = getConversationListMetrics();
  assert.equal(coldRows.length, fixtureIds.length);
  assert.equal(cold.cacheMisses, fixtureIds.length);
  assert.ok(cold.bytesRead >= fixtureIds.length * largeText.length);
  assert.ok(cold.peakReadConcurrency <= 8, "cache misses stay under the read concurrency cap");

  const warmRows = await listConversations();
  const warm = getConversationListMetrics();
  assert.deepEqual(warmRows, coldRows, "warm metadata rows remain identical");
  assert.equal(warm.cacheHits, fixtureIds.length);
  assert.equal(warm.cacheMisses, 0);
  assert.equal(warm.cacheHitRate, 1);
  assert.equal(warm.bytesRead, 0, "unchanged scans do not reread transcript bodies");

  const externallyChanged = fixtureIds[0];
  const externalFile = path.join(CONV_DIR, `${externallyChanged}.json`);
  await writeFile(
    externalFile,
    JSON.stringify({
      sessionId: externallyChanged,
      familiarId: "charm",
      harness: "codex",
      title: "Changed outside Cave",
      branch: "agent/external-change",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z",
      activeLeafId: "external-assistant",
      turns: [
        {
          id: "external-assistant",
          role: "assistant",
          text: "failed externally",
          isError: true,
          createdAt: "2026-06-13T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  const future = new Date(Date.now() + 60_000);
  await utimes(externalFile, future, future);
  const changedRows = await listConversations();
  const changed = changedRows.find((row) => row.sessionId === externallyChanged);
  const changedMetrics = getConversationListMetrics();
  assert.equal(changed?.title, "Changed outside Cave");
  assert.equal(changed?.branch, "agent/external-change");
  assert.equal(changed?.status, "failed");
  assert.equal(changedMetrics.cacheMisses, 1, "only the externally changed file is reread");
  assert.equal(changedMetrics.cacheHits, fixtureIds.length - 1);

  const saved = await loadConversation(fixtureIds[1]);
  assert.ok(saved);
  saved.title = "Changed through saveConversation";
  saved.branch = "agent/saved-change";
  await saveConversation(saved);
  const savedRows = await listConversations();
  assert.equal(
    savedRows.find((row) => row.sessionId === fixtureIds[1])?.title,
    "Changed through saveConversation",
  );
  assert.equal(
    savedRows.find((row) => row.sessionId === fixtureIds[1])?.branch,
    "agent/saved-change",
  );
  assert.equal(getConversationListMetrics().cacheMisses, 1, "save invalidates one summary");

  for (const sessionId of fixtureIds) assert.equal(await deleteConversation(sessionId), true);
  assert.deepEqual(await listConversations(), []);
  assert.equal(getConversationListMetrics().cacheEntries, 0, "deleted entries are pruned");

  await writeFile(path.join(CONV_DIR, "metadata-corrupt.json"), "{ not json", "utf8");
  const corruptRows = await listConversations();
  assert.equal(corruptRows[0]?.sessionId, "metadata-corrupt");
  assert.equal(corruptRows[0]?.familiarId, "");
  await listConversations();
  assert.equal(getConversationListMetrics().bytesRead, 0, "corrupt fallback rows are cached too");
  assert.equal(await deleteConversation("metadata-corrupt"), true);

  await writeFile(path.join(CONV_DIR, "metadata-invalid-shape.json"), "{}", "utf8");
  const invalidShapeRows = await listConversations();
  assert.equal(invalidShapeRows[0]?.sessionId, "metadata-invalid-shape");
  assert.equal(invalidShapeRows[0]?.familiarId, "");
  await listConversations();
  assert.equal(
    getConversationListMetrics().bytesRead,
    0,
    "valid JSON with an invalid conversation shape keeps the cached fallback row",
  );
  assert.equal(await deleteConversation("metadata-invalid-shape"), true);

  const unreadablePath = path.join(CONV_DIR, "metadata-unreadable.json");
  await mkdir(unreadablePath);
  const unreadableRows = await listConversations();
  assert.equal(unreadableRows[0]?.sessionId, "metadata-unreadable");
  await listConversations();
  assert.equal(getConversationListMetrics().cacheMisses, 1, "read failures are retried");
  assert.equal(getConversationListMetrics().cacheHits, 0, "read failures are not cached");
  await rm(unreadablePath, { recursive: true });
}

// ── CHAT-D9-02: conversation content search ──────────────────────────────────
// Appended section — searchConversations over fixture transcripts written
// directly into CONV_DIR (still pointing at the temp HOME from above).
{
  const { searchConversations, CONV_DIR } = await import("./cave-conversations.ts");
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(CONV_DIR, { recursive: true });

  const fixture = (sessionId, updatedAt, texts) =>
    JSON.stringify({
      sessionId,
      familiarId: "charm",
      harness: "codex",
      title: `Title ${sessionId}`,
      createdAt: updatedAt,
      updatedAt,
      turns: texts.map((text, i) => ({
        id: `t${i}`,
        role: i % 2 ? "assistant" : "user",
        text,
        createdAt: updatedAt,
      })),
    });

  await writeFile(
    path.join(CONV_DIR, "search-hit.json"),
    fixture("search-hit", "2026-06-11T01:00:00.000Z", [
      "let's plan the trip",
      "We should book the Kyoto ryokan in autumn.\nKyoto is busy then.",
    ]),
    "utf8",
  );
  await writeFile(
    path.join(CONV_DIR, "search-miss.json"),
    fixture("search-miss", "2026-06-11T02:00:00.000Z", ["nothing relevant here"]),
    "utf8",
  );
  await writeFile(
    path.join(CONV_DIR, "same-date-a.json"),
    fixture("same-date-a", "2026-06-11T03:00:00.000Z", ["same timestamp match"]),
    "utf8",
  );
  await writeFile(
    path.join(CONV_DIR, "same-date-b.json"),
    fixture("same-date-b", "2026-06-11T03:00:00.000Z", ["same timestamp match"]),
    "utf8",
  );
  await writeFile(path.join(CONV_DIR, "search-corrupt.json"), "{ not json", "utf8");

  // Body match → one hit per conversation, with snippet + match count;
  // the corrupt file alongside must be skipped, not thrown on.
  const hits = await searchConversations("kyoto");
  assert.equal(hits.length, 1, "one conversation matches 'kyoto'");
  assert.equal(hits[0].sessionId, "search-hit");
  assert.equal(hits[0].matchCount, 2, "matchCount counts every occurrence across turns");
  assert.match(hits[0].snippet, /Kyoto ryokan/, "snippet centers on the first match");
  assert.doesNotMatch(hits[0].snippet, /\n/, "snippet is single-line");
  assert.ok(hits[0].snippet.length <= 100, "snippet stays excerpt-sized");

  // No match → empty; never an error.
  assert.deepEqual(await searchConversations("zanzibar"), []);

  const sameDateHits = await searchConversations("same timestamp", { limit: 2 });
  assert.deepEqual(
    sameDateHits.map((h) => h.sessionId),
    ["same-date-a", "same-date-b"],
    "equal updatedAt values keep deterministic filename order",
  );

  // Min query length 2 (whitespace doesn't count).
  assert.deepEqual(await searchConversations("k"), []);
  assert.deepEqual(await searchConversations("  k  "), []);
  assert.deepEqual(await searchConversations(""), []);

  // Result cap — most recently updated conversations win.
  for (let i = 0; i < 5; i++) {
    await writeFile(
      path.join(CONV_DIR, `cap-${i}.json`),
      fixture(`cap-${i}`, `2026-06-12T0${i}:00:00.000Z`, ["the otters convene at dawn"]),
      "utf8",
    );
  }
  const capped = await searchConversations("otters", { limit: 3 });
  assert.equal(capped.length, 3, "limit caps the hit list");
  assert.deepEqual(
    capped.map((h) => h.sessionId),
    ["cap-4", "cap-3", "cap-2"],
    "most recently updated conversations rank first",
  );

  // Oversized transcripts are skipped gracefully, not scanned.
  assert.deepEqual(
    await searchConversations("kyoto", { maxFileBytes: 10 }),
    [],
    "files above the byte cap are skipped",
  );
}

await saveConversation({
  sessionId: "model-intent",
  familiarId: "salem",
  harness: "claude",
  model: "anthropic/claude-sonnet-4-6",
  modelIntent: {
    model: "anthropic/claude-opus-4-7",
    source: "session",
    applicationState: "saved",
    reason: "Use Opus for this chat.",
  },
  title: "Model intent",
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
  turns: [],
});
const modelIntentConv = await loadConversation("model-intent");
assert.deepEqual(
  modelIntentConv?.modelIntent,
  {
    model: "anthropic/claude-opus-4-7",
    source: "session",
    applicationState: "saved",
    reason: "Use Opus for this chat.",
  },
  "conversation-level model intent must round-trip through the store",
);
assert.equal(await deleteConversation("model-intent"), true);

if (previousHome === undefined) {
  delete process.env.HOME;
} else {
  process.env.HOME = previousHome;
}
if (previousCovenHome === undefined) {
  delete process.env.COVEN_HOME;
} else {
  process.env.COVEN_HOME = previousCovenHome;
}
await rm(home, { recursive: true, force: true });

console.log("cave-conversations.test.ts: ok");

// ── searchConversations content cache invalidates on mtime (perf) ────────────
{
  const { searchConversations, CONV_DIR } = await import("./cave-conversations.ts");
  const { writeFile, utimes, mkdir } = await import("node:fs/promises");
  await mkdir(CONV_DIR, { recursive: true });
  const file = path.join(CONV_DIR, "cache-test.json");
  const mk = (text) =>
    JSON.stringify({
      sessionId: "cache-test",
      title: "Cache test",
      updatedAt: new Date().toISOString(),
      turns: [{ id: "t1", role: "user", text }],
    });
  await writeFile(file, mk("alpha unique-marker-aaa"), "utf8");
  let hits = await searchConversations("unique-marker-aaa");
  assert.equal(hits.length, 1, "first search finds the original content");

  await writeFile(file, mk("beta unique-marker-bbb"), "utf8");
  const future = new Date(Date.now() + 60_000);
  await utimes(file, future, future);
  hits = await searchConversations("unique-marker-bbb");
  assert.equal(hits.length, 1, "after edit, search finds the NEW content (mtime invalidation)");
  const stale = await searchConversations("unique-marker-aaa");
  assert.equal(stale.length, 0, "old content is no longer matched after the edit");

  const again = await searchConversations("unique-marker-bbb");
  assert.equal(again.length, 1, "repeat search via the cache returns the same hit");
}

// ── Atomic persistence (cave-1v95): no torn writes, no temp residue ──────────
{
  const { readdir, readFile } = await import("node:fs/promises");
  const { CONV_DIR } = await import("./cave-conversations.ts");
  await saveConversation({
    sessionId: "atomic-check",
    familiarId: "charm",
    harness: "codex",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    turns: [],
  });
  const entries = await readdir(CONV_DIR);
  assert.ok(entries.includes("atomic-check.json"), "the conversation file lands");
  assert.equal(
    entries.filter((name) => name.endsWith(".tmp")).length,
    0,
    "atomic replace leaves no temp residue behind",
  );
  const source = await readFile(new URL("./cave-conversations.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /writeJsonAtomic\(pathFor\(conv\.sessionId\), conv\)/,
    "saveConversation must go through the atomic writer",
  );
  assert.doesNotMatch(
    source,
    /writeFile\(pathFor/,
    "plain writeFile on a conversation path would reintroduce torn writes",
  );
}

// ── First-turn visibility stubs (cave-0g2x) ──────────────────────────────────
// A new chat must exist in the conversation store from the moment its session
// id is announced — not only at end-of-stream — so /api/sessions/list can
// surface it during the entire first turn, and a mid-turn crash leaves a
// listed chat holding the user's message.
{
  const { createConversationStub, stripConversationStubTurn } = await import(
    "./cave-conversations.ts"
  );

  const created = await createConversationStub({
    sessionId: "stub-first-turn",
    familiarId: "charm",
    harness: "claude",
    model: "claude-4",
    runtime: "local:/tmp/project",
    title: "Fix the flaky test",
    modelIntent: {
      model: "anthropic/claude-opus-4-6",
      source: "session",
      applicationState: "saved",
      reason: "Saved for this chat.",
    },
    userTurn: {
      id: "pending-user-turn",
      text: "fix the flaky test please",
      attentionClearOperationId: " run-stub ",
      reasoningEffort: "medium",
      responseSpeed: "careful",
      modelControls: { reasoning: "medium" },
      modelOverride: "anthropic/claude-opus-4-6",
    },
  });
  assert.equal(created, true, "a brand-new chat gets a stub conversation");

  const stub = await loadConversation("stub-first-turn");
  assert.equal(stub?.turns.length, 1, "stub holds only the pending user turn");
  assert.equal(stub?.turns[0]?.id, "pending-user-turn");
  assert.equal(stub?.turns[0]?.role, "user");
  assert.equal(stub?.turns[0]?.text, "fix the flaky test please");
  assert.equal(
    stub?.turns[0]?.attentionClearOperationId,
    "run-stub",
    "pending stubs normalize and retain the send's causal operation id",
  );
  assert.equal(stub?.turns[0]?.reasoningEffort, "medium");
  assert.equal(stub?.turns[0]?.responseSpeed, "careful");
  assert.deepEqual(stub?.turns[0]?.modelControls, { reasoning: "medium" });
  assert.equal(stub?.turns[0]?.modelOverride, "anthropic/claude-opus-4-6");
  assert.equal(stub?.modelIntent?.model, "anthropic/claude-opus-4-6");
  assert.equal(stub?.activeLeafId, "pending-user-turn");
  assert.equal(stub?.title, "Fix the flaky test");

  // The stub's summary must NOT infer a terminal status from the missing
  // assistant turn — the session-list merge would otherwise override a live
  // daemon "running" with "completed".
  const summaries = await listConversations();
  const stubSummary = summaries.find((s) => s.sessionId === "stub-first-turn");
  assert.ok(stubSummary, "stub appears in the conversation list");
  assert.equal(stubSummary.status, undefined, "pending first reply ⇒ no terminal status");
  assert.equal(stubSummary.exitCode, undefined, "pending first reply ⇒ no exit code");

  // Resumed turns must never be clobbered: a second stub attempt is a no-op.
  const again = await createConversationStub({
    sessionId: "stub-first-turn",
    familiarId: "other",
    harness: "codex",
    userTurn: { id: "other-turn", text: "clobber attempt" },
  });
  assert.equal(again, false, "stub creation no-ops when the conversation exists");
  const untouched = await loadConversation("stub-first-turn");
  assert.equal(untouched?.familiarId, "charm", "existing conversation is not clobbered");
  assert.equal(untouched?.turns[0]?.text, "fix the flaky test please");

  // End-of-stream: strip the stub turn and re-append the authoritative pair
  // under the same user-turn id (mirrors the send route's save).
  const conv = await loadConversation("stub-first-turn");
  const hadStub = stripConversationStubTurn(conv, "pending-user-turn");
  assert.equal(hadStub, true, "strip reports the conversation was stub-only");
  assert.equal(conv.turns.length, 0, "stub turn is removed");
  assert.equal(conv.activeLeafId, undefined, "active leaf reverts to the stub's parent");
  const branchParentId = conv.activeLeafId ?? null;
  assert.equal(branchParentId, null, "re-appended turn must not self-parent");
  conv.turns.push(
    {
      id: "pending-user-turn",
      role: "user",
      text: "fix the flaky test please",
      createdAt: "2026-07-21T00:00:01.000Z",
      parentId: branchParentId,
    },
    {
      id: "assistant-turn",
      role: "assistant",
      text: "done",
      createdAt: "2026-07-21T00:00:02.000Z",
      isError: false,
      parentId: "pending-user-turn",
    },
  );
  conv.activeLeafId = "assistant-turn";
  await saveConversation(conv);

  const finished = await loadConversation("stub-first-turn");
  assert.equal(finished?.turns.length, 2, "authoritative save replaces the stub turn");
  assert.equal(finished?.turns[0]?.id, "pending-user-turn", "user turn keeps its stub-era id");
  const finishedSummary = (await listConversations()).find(
    (s) => s.sessionId === "stub-first-turn",
  );
  assert.equal(finishedSummary?.status, "completed", "finished chat reports terminal status");
  assert.equal(finishedSummary?.exitCode, 0);

  // Resumed-chat path: stripping a turn id that never was a stub is a no-op.
  const notStub = await loadConversation("stub-first-turn");
  const turnCountBefore = notStub.turns.length;
  assert.equal(stripConversationStubTurn(notStub, "never-existed"), false);
  assert.equal(notStub.turns.length, turnCountBefore, "no-op strip leaves turns alone");
  assert.equal(stripConversationStubTurn(notStub, undefined), false, "no id ⇒ no-op");

  // Defensive re-parenting: children of the stripped stub turn re-point at the
  // stub's parent, so no dangling parentId survives.
  const branched = {
    sessionId: "stub-branched",
    familiarId: "charm",
    harness: "claude",
    createdAt: "2026-07-21T01:00:00.000Z",
    updatedAt: "2026-07-21T01:00:00.000Z",
    turns: [
      { id: "stub-turn", role: "user", text: "hi", createdAt: "2026-07-21T01:00:00.000Z", parentId: null },
      { id: "child-turn", role: "assistant", text: "…", createdAt: "2026-07-21T01:00:01.000Z", parentId: "stub-turn" },
    ],
    activeLeafId: "child-turn",
  };
  assert.equal(stripConversationStubTurn(branched, "stub-turn"), true);
  assert.equal(branched.turns.length, 1);
  assert.equal(branched.turns[0]?.parentId, null, "orphaned child re-points at stub's parent");
  assert.equal(branched.activeLeafId, "child-turn", "active leaf off the stub is untouched");

  await createConversationStub({
    sessionId: "stub-runtime-default",
    familiarId: "charm",
    harness: "hermes",
    userTurn: {
      id: "runtime-default-turn",
      text: "Use the provider default.",
      modelOverrideScope: "runtime-default",
    },
  });
  const runtimeDefaultStub = await loadConversation("stub-runtime-default");
  assert.equal(
    runtimeDefaultStub?.turns[0]?.modelOverrideScope,
    "runtime-default",
    "a first-turn stub round-trips model-less runtime-default retry intent",
  );
  await deleteConversation("stub-runtime-default");
}
console.log("cave-conversations cache test OK");

// ── First-turn stub pending marker (cave-0g2x crash truth) ───────────────────
// The stub write stamps pendingUserTurnId on the file and `pending` on the
// summary; the sessions list resolves pending rows against the live run
// registry (running vs failed) instead of letting a crashed first turn read
// as a phantom "completed". Any end-of-stream save settles the marker.
{
  const { createConversationStub, stripConversationStubTurn } = await import(
    "./cave-conversations.ts"
  );

  await createConversationStub({
    sessionId: "stub-pending-marker",
    familiarId: "charm",
    harness: "codex",
    userTurn: { id: "pending-turn", text: "long first prompt" },
  });
  const stub = await loadConversation("stub-pending-marker");
  assert.equal(stub?.pendingUserTurnId, "pending-turn", "stub write stamps the pending marker");
  const pendingSummary = (await listConversations()).find(
    (s) => s.sessionId === "stub-pending-marker",
  );
  assert.equal(pendingSummary?.pending, true, "summary carries the pending flag");
  assert.equal(pendingSummary?.status, undefined, "pending stays statusless (merge honesty)");

  // Normal settle: the same process strips its own stub turn — marker gone.
  const settled = await loadConversation("stub-pending-marker");
  assert.equal(stripConversationStubTurn(settled, "pending-turn"), true);
  assert.equal(settled.pendingUserTurnId, undefined, "strip clears the pending marker");
  settled.turns.push(
    { id: "pending-turn", role: "user", text: "long first prompt", createdAt: "2026-07-21T02:00:00.000Z", parentId: null },
    { id: "reply", role: "assistant", text: "ok", createdAt: "2026-07-21T02:00:01.000Z", isError: false, parentId: "pending-turn" },
  );
  settled.activeLeafId = "reply";
  await saveConversation(settled);
  const settledSummary = (await listConversations()).find(
    (s) => s.sessionId === "stub-pending-marker",
  );
  assert.equal(settledSummary?.pending, undefined, "settled conversation drops the flag");
  assert.equal(settledSummary?.status, "completed");

  // Crash-then-resume: a NEW server process saves a later turn without the
  // crashed run's in-memory stub id. The marker must still clear — while the
  // stubbed user turn deliberately stays as the record of the lost prompt.
  await createConversationStub({
    sessionId: "stub-crashed",
    familiarId: "charm",
    harness: "claude",
    userTurn: { id: "lost-prompt", text: "prompt the crash orphaned" },
  });
  const crashed = await loadConversation("stub-crashed");
  assert.equal(crashed?.pendingUserTurnId, "lost-prompt");
  assert.equal(
    stripConversationStubTurn(crashed, null),
    false,
    "a resumed save has no stub id to strip",
  );
  assert.equal(crashed.pendingUserTurnId, undefined, "…but the marker still settles");
  assert.equal(crashed.turns.length, 1, "the orphaned prompt stays in the tree");
  await saveConversation(crashed);
  const recoveredSummary = (await listConversations()).find(
    (s) => s.sessionId === "stub-crashed",
  );
  assert.equal(recoveredSummary?.pending, undefined, "recovered chat is no longer pending");

  await deleteConversation("stub-pending-marker");
  await deleteConversation("stub-crashed");
}
console.log("cave-conversations pending-marker test OK");

// ── Active-path attention evidence summaries (cave-zs85n task 4) ─────────────
{
  const NOW = Date.parse("2026-08-04T20:00:00.000Z");
  const ids = [
    "attention-leaf-request",
    "attention-stale-request-left-hanging",
    "attention-user-leaf-resolution",
    "attention-malformed-request",
    "attention-malformed-newer-request",
    "attention-noncanonical-request",
    "attention-cancelled-request-turn",
    "attention-error-request-turn",
    "attention-mismatched-turnid-request",
    "attention-off-path-request",
    "attention-root-sibling-active-request",
    "attention-root-sibling-inactive-request",
    "attention-root-sibling-active-completes",
    "attention-root-sibling-active-fails",
    "attention-malformed-turns",
    "attention-corrupt-leaf",
    "attention-duplicate-leaf-id",
    "attention-ambiguous-missing-leaf",
    "attention-explicit-null-roots",
    "attention-legacy-missing-parent-links",
    "attention-request-resolved-by-malformed-user",
    "attention-requested-at-mismatch",
    "attention-canonical-assistant-noncanonical-request",
    "attention-request-cleared-by-equal-timestamp",
    "attention-detached-leaf",
    "attention-broken-parent-chain",
    "attention-parent-cycle",
  ];

  await saveConversation({
    sessionId: "attention-leaf-request",
    familiarId: "charm",
    harness: "claude",
    title: "Leaf request",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T18:00:00.000Z",
    turns: [
      {
        id: "leaf-prior-user",
        role: "user",
        text: "Start the release review.",
        attentionClearOperationId: "run-prior",
        createdAt: "2026-08-04T16:00:00.000Z",
        parentId: null,
      },
      {
        id: "leaf-prior-assistant",
        role: "assistant",
        text: "The release is ready for a final decision.",
        createdAt: "2026-08-04T16:30:00.000Z",
        parentId: "leaf-prior-user",
      },
      {
        id: "leaf-user",
        role: "user",
        text: "Should I deploy this?",
        attentionClearOperationId: " run-leaf ",
        createdAt: "2026-08-04T17:00:00.000Z",
        parentId: "leaf-prior-assistant",
      },
      {
        id: "leaf-assistant",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-04T18:00:00.000Z",
        parentId: "leaf-user",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-leaf-request",
            turnId: "leaf-assistant",
            requestedAt: "2026-08-04T18:00:00.000Z",
            reason: "approval",
          },
        },
      },
    ],
    activeLeafId: "leaf-assistant",
  });

  await saveConversation({
    sessionId: "attention-stale-request-left-hanging",
    familiarId: "charm",
    harness: "claude",
    title: "Historical request on active path",
    createdAt: "2026-08-03T15:00:00.000Z",
    updatedAt: "2026-08-03T18:00:00.000Z",
    turns: [
      {
        id: "stale-user-1",
        role: "user",
        text: "Should we rotate the key?",
        createdAt: "2026-08-03T15:00:00.000Z",
        parentId: null,
      },
      {
        id: "stale-assistant-request",
        role: "assistant",
        text: "I need credentials from you.",
        createdAt: "2026-08-03T16:00:00.000Z",
        parentId: "stale-user-1",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-stale-request-left-hanging",
            turnId: "stale-assistant-request",
            requestedAt: "2026-08-03T16:00:00.000Z",
            reason: "credentials",
          },
        },
      },
      {
        id: "stale-user-2",
        role: "user",
        text: "Here they are.",
        attentionClearOperationId: "   ",
        createdAt: "2026-08-03T17:00:00.000Z",
        parentId: "stale-assistant-request",
      },
      {
        id: "stale-assistant-leaf",
        role: "assistant",
        text: "Thanks — I'll take it from here.",
        createdAt: "2026-08-03T18:00:00.000Z",
        parentId: "stale-user-2",
      },
    ],
    activeLeafId: "stale-assistant-leaf",
  });

  await saveConversation({
    sessionId: "attention-malformed-request",
    familiarId: "charm",
    harness: "claude",
    title: "Malformed request",
    createdAt: "2026-08-03T16:00:00.000Z",
    updatedAt: "2026-08-03T18:30:00.000Z",
    turns: [
      {
        id: "bad-request-user",
        role: "user",
        text: "Do you need anything?",
        createdAt: "2026-08-03T16:00:00.000Z",
        parentId: null,
      },
      {
        id: "bad-request-assistant",
        role: "assistant",
        text: "I need approval, but the stamp is corrupt.",
        createdAt: "2026-08-03T18:30:00.000Z",
        parentId: "bad-request-user",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-malformed-request",
            turnId: "bad-request-assistant",
            requestedAt: "not-a-date",
            reason: "approval",
          },
        },
      },
    ],
    activeLeafId: "bad-request-assistant",
  });

  await saveConversation({
    sessionId: "attention-malformed-newer-request",
    familiarId: "charm",
    harness: "claude",
    title: "Malformed newer request suppresses older request",
    createdAt: "2026-08-01T16:00:00.000Z",
    updatedAt: "2026-08-04T19:00:00.000Z",
    turns: [
      {
        id: "malformed-newer-user",
        role: "user",
        text: "Do you need anything?",
        createdAt: "2026-08-01T16:00:00.000Z",
        parentId: null,
      },
      {
        id: "malformed-newer-old-request",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-01T17:00:00.000Z",
        parentId: "malformed-newer-user",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-malformed-newer-request",
            turnId: "malformed-newer-old-request",
            requestedAt: "2026-08-01T17:00:00.000Z",
            reason: "approval",
          },
        },
      },
      {
        id: "malformed-newer-system",
        role: "system",
        text: "The runtime resumed the assistant.",
        createdAt: "2026-08-04T18:59:00.000Z",
        parentId: "malformed-newer-old-request",
      },
      {
        id: "malformed-newer-assistant",
        role: "assistant",
        text: "This newer request has corrupt evidence.",
        createdAt: "2026-08-04T19:00:00.000Z",
        parentId: "malformed-newer-system",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-malformed-newer-request",
            turnId: "malformed-newer-assistant",
            requestedAt: "not-a-date",
            reason: "approval",
          },
        },
      },
    ],
    activeLeafId: "malformed-newer-assistant",
  });

  await saveConversation({
    sessionId: "attention-user-leaf-resolution",
    familiarId: "charm",
    harness: "claude",
    title: "Active user leaf resolves request",
    createdAt: "2026-08-04T15:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      {
        id: "user-leaf-root",
        role: "user",
        text: "Do you need a decision?",
        createdAt: "2026-08-04T15:00:00.000Z",
        parentId: null,
      },
      {
        id: "user-leaf-request",
        role: "assistant",
        text: "Yes — please decide.",
        createdAt: "2026-08-04T16:00:00.000Z",
        parentId: "user-leaf-root",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-user-leaf-resolution",
            turnId: "user-leaf-request",
            requestedAt: "2026-08-04T16:00:00.000Z",
            reason: "decision",
          },
        },
      },
      {
        id: "user-leaf-active",
        role: "user",
        text: "Ship it.",
        createdAt: "2026-08-04T17:00:00.000Z",
        parentId: "user-leaf-request",
      },
    ],
    activeLeafId: "user-leaf-active",
  });

  await saveConversation({
    sessionId: "attention-noncanonical-request",
    familiarId: "charm",
    harness: "claude",
    title: "Reject parseable noncanonical timestamps",
    createdAt: "2026-08-04T16:45:00.000Z",
    updatedAt: "2026-08-04T18:45:00.000Z",
    turns: [
      {
        id: "noncanonical-user",
        role: "user",
        text: "Do you need anything?",
        createdAt: "2026-08-04T16:45:00.000Z",
        parentId: null,
      },
      {
        id: "noncanonical-assistant",
        role: "assistant",
        text: "I need approval, but the timestamps are noncanonical.",
        createdAt: "2026-08-04T18:45:00Z",
        parentId: "noncanonical-user",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-noncanonical-request",
            turnId: "noncanonical-assistant",
            requestedAt: "2026-08-04T18:45:00Z",
            reason: "approval",
          },
        },
      },
    ],
    activeLeafId: "noncanonical-assistant",
  });

  await saveConversation({
    sessionId: "attention-cancelled-request-turn",
    familiarId: "charm",
    harness: "claude",
    title: "Cancelled assistant requests no attention",
    createdAt: "2026-08-04T14:00:00.000Z",
    updatedAt: "2026-08-04T14:30:00.000Z",
    turns: [
      {
        id: "cancelled-request-user",
        role: "user",
        text: "Anything blocking you?",
        createdAt: "2026-08-04T14:00:00.000Z",
        parentId: null,
      },
      {
        id: "cancelled-request-assistant",
        role: "assistant",
        text: "Partial answer before cancel.",
        createdAt: "2026-08-04T14:30:00.000Z",
        parentId: "cancelled-request-user",
        cancelled: true,
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-cancelled-request-turn",
            turnId: "cancelled-request-assistant",
            requestedAt: "2026-08-04T14:30:00.000Z",
            reason: "input",
          },
        },
      },
    ],
    activeLeafId: "cancelled-request-assistant",
  });

  await saveConversation({
    sessionId: "attention-error-request-turn",
    familiarId: "charm",
    harness: "claude",
    title: "Errored assistant requests no attention",
    createdAt: "2026-08-04T14:40:00.000Z",
    updatedAt: "2026-08-04T14:50:00.000Z",
    turns: [
      {
        id: "error-request-user",
        role: "user",
        text: "Anything blocking you?",
        createdAt: "2026-08-04T14:40:00.000Z",
        parentId: null,
      },
      {
        id: "error-request-assistant",
        role: "assistant",
        text: "I crashed after asking.",
        createdAt: "2026-08-04T14:50:00.000Z",
        parentId: "error-request-user",
        isError: true,
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-error-request-turn",
            turnId: "error-request-assistant",
            requestedAt: "2026-08-04T14:50:00.000Z",
            reason: "credentials",
          },
        },
      },
    ],
    activeLeafId: "error-request-assistant",
  });

  await saveConversation({
    sessionId: "attention-mismatched-turnid-request",
    familiarId: "charm",
    harness: "claude",
    title: "Reject mismatched turn ids",
    createdAt: "2026-08-04T13:00:00.000Z",
    updatedAt: "2026-08-04T13:30:00.000Z",
    turns: [
      {
        id: "turn-mismatch-user",
        role: "user",
        text: "Anything blocking you?",
        createdAt: "2026-08-04T13:00:00.000Z",
        parentId: null,
      },
      {
        id: "turn-mismatch-assistant",
        role: "assistant",
        text: "The metadata points at a different turn.",
        createdAt: "2026-08-04T13:30:00.000Z",
        parentId: "turn-mismatch-user",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-mismatched-turnid-request",
            turnId: "some-other-turn",
            requestedAt: "2026-08-04T13:30:00.000Z",
            reason: "input",
          },
        },
      },
    ],
    activeLeafId: "turn-mismatch-assistant",
  });

  await saveConversation({
    sessionId: "attention-off-path-request",
    familiarId: "charm",
    harness: "claude",
    title: "Ignore inactive branch request",
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:02:00.000Z",
    turns: [
      {
        id: "branch-root",
        role: "user",
        text: "Summarize the plan.",
        createdAt: "2026-08-04T12:00:00.000Z",
        parentId: null,
      },
      {
        id: "branch-request",
        role: "assistant",
        text: "I need your input.",
        createdAt: "2026-08-04T12:01:00.000Z",
        parentId: "branch-root",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-off-path-request",
            turnId: "branch-request",
            requestedAt: "2026-08-04T12:01:00.000Z",
            reason: "input",
          },
        },
      },
      {
        id: "branch-active",
        role: "assistant",
        text: "Here is the answer.",
        createdAt: "2026-08-04T12:02:00.000Z",
        parentId: "branch-root",
      },
    ],
    activeLeafId: "branch-active",
  });

  // Regenerate/rerun legitimately produces a second *root-level* generation
  // (a fresh parentId: null turn) sitting alongside the first — this is not
  // corruption, it's a sibling generation the user can switch between. Only
  // the branch activeLeafId actually selects should ever be validated; the
  // other root sibling and its evidence must simply be ignored, never treated
  // as a "disconnected root" that invalidates the whole file.
  const rootSiblingTurns = [
    {
      id: "root-sibling-a-user",
      role: "user",
      text: "Do you need approval?",
      attentionClearOperationId: "run-root-a",
      createdAt: "2026-08-04T12:10:00.000Z",
      parentId: null,
    },
    {
      id: "root-sibling-a-assistant",
      role: "assistant",
      text: "I need your approval.",
      createdAt: "2026-08-04T12:11:00.000Z",
      parentId: "root-sibling-a-user",
      responseMetadata: {
        familiarId: "charm",
        harness: "claude",
        model: "anthropic/claude-sonnet-4.6",
        runtime: "local:/repo",
        attentionRequest: {
          sessionId: "attention-root-sibling-active-request",
          turnId: "root-sibling-a-assistant",
          requestedAt: "2026-08-04T12:11:00.000Z",
          reason: "approval",
        },
      },
    },
    {
      id: "root-sibling-b-user",
      role: "user",
      text: "Never mind, summarize it instead.",
      attentionClearOperationId: "run-root-b",
      createdAt: "2026-08-04T12:12:00.000Z",
      parentId: null,
    },
    {
      id: "root-sibling-b-assistant",
      role: "assistant",
      text: "Here is the summary.",
      createdAt: "2026-08-04T12:13:00.000Z",
      parentId: "root-sibling-b-user",
    },
  ];

  // activeLeafId selects the request-bearing root-sibling branch: its request
  // must surface.
  await saveConversation({
    sessionId: "attention-root-sibling-active-request",
    familiarId: "charm",
    harness: "claude",
    title: "Active leaf selects the request-bearing root sibling",
    createdAt: "2026-08-04T12:10:00.000Z",
    updatedAt: "2026-08-04T12:13:00.000Z",
    turns: rootSiblingTurns,
    activeLeafId: "root-sibling-a-assistant",
  });

  // Same tree, but activeLeafId selects the *other* root-sibling branch: the
  // inactive branch's request must be ignored, not surfaced and not treated
  // as disqualifying evidence.
  await saveConversation({
    sessionId: "attention-root-sibling-inactive-request",
    familiarId: "charm",
    harness: "claude",
    title: "Active leaf ignores an inactive root sibling's request",
    createdAt: "2026-08-04T12:10:00.000Z",
    updatedAt: "2026-08-04T12:13:00.000Z",
    turns: rootSiblingTurns.map((turn) =>
      turn.responseMetadata
        ? {
            ...turn,
            responseMetadata: {
              ...turn.responseMetadata,
              attentionRequest: {
                ...turn.responseMetadata.attentionRequest,
                sessionId: "attention-root-sibling-inactive-request",
              },
            },
          }
        : turn,
    ),
    activeLeafId: "root-sibling-b-assistant",
  });

  // Root-level terminal/status regression: a root-sibling generation whose
  // *inactive* branch ended in error must never leak that failure into the
  // conversation summary's terminal `status`/`exitCode` — those fields are
  // derived from the same active-path resolution as attentionEvidence, so
  // they must honor whichever root-level sibling activeLeafId selects.
  await saveConversation({
    sessionId: "attention-root-sibling-active-completes",
    familiarId: "charm",
    harness: "claude",
    title: "Active root sibling completes while the inactive one failed",
    createdAt: "2026-08-04T12:20:00.000Z",
    updatedAt: "2026-08-04T12:22:00.000Z",
    turns: [
      {
        id: "terminal-sibling-failed-user",
        role: "user",
        text: "Do this first.",
        createdAt: "2026-08-04T12:20:00.000Z",
        parentId: null,
      },
      {
        id: "terminal-sibling-failed-assistant",
        role: "assistant",
        text: "That failed.",
        createdAt: "2026-08-04T12:21:00.000Z",
        parentId: "terminal-sibling-failed-user",
        isError: true,
      },
      {
        id: "terminal-sibling-active-user",
        role: "user",
        text: "Never mind, do this instead.",
        createdAt: "2026-08-04T12:21:30.000Z",
        parentId: null,
      },
      {
        id: "terminal-sibling-active-assistant",
        role: "assistant",
        text: "Done.",
        createdAt: "2026-08-04T12:22:00.000Z",
        parentId: "terminal-sibling-active-user",
      },
    ],
    activeLeafId: "terminal-sibling-active-assistant",
  });

  // Same shape, terminal outcomes swapped: the active branch is the one that
  // failed. Together with the fixture above, this pins that `status`/
  // `exitCode` always track the selected branch in either direction, rather
  // than e.g. defaulting to "completed" or picking up whichever root sibling
  // happens to sort first.
  await saveConversation({
    sessionId: "attention-root-sibling-active-fails",
    familiarId: "charm",
    harness: "claude",
    title: "Active root sibling fails while the inactive one completed",
    createdAt: "2026-08-04T12:23:00.000Z",
    updatedAt: "2026-08-04T12:25:00.000Z",
    turns: [
      {
        id: "terminal-sibling-completed-user",
        role: "user",
        text: "Do this first.",
        createdAt: "2026-08-04T12:23:00.000Z",
        parentId: null,
      },
      {
        id: "terminal-sibling-completed-assistant",
        role: "assistant",
        text: "Done.",
        createdAt: "2026-08-04T12:24:00.000Z",
        parentId: "terminal-sibling-completed-user",
      },
      {
        id: "terminal-sibling-failing-active-user",
        role: "user",
        text: "Never mind, do this instead.",
        createdAt: "2026-08-04T12:24:30.000Z",
        parentId: null,
      },
      {
        id: "terminal-sibling-failing-active-assistant",
        role: "assistant",
        text: "That failed.",
        createdAt: "2026-08-04T12:25:00.000Z",
        parentId: "terminal-sibling-failing-active-user",
        isError: true,
      },
    ],
    activeLeafId: "terminal-sibling-failing-active-assistant",
  });

  await saveConversation({
    sessionId: "attention-malformed-turns",
    familiarId: "charm",
    harness: "claude",
    title: "Malformed timestamps stay isolated",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T20:00:00.000Z",
    turns: [
      {
        id: "malformed-valid-user",
        role: "user",
        text: "Keep going.",
        createdAt: "2026-08-04T17:00:00.000Z",
        parentId: null,
      },
      {
        id: "malformed-valid-assistant",
        role: "assistant",
        text: "On it.",
        createdAt: "2026-08-04T18:00:00.000Z",
        parentId: "malformed-valid-user",
      },
      {
        id: "malformed-bad-user",
        role: "user",
        text: "One more thing.",
        createdAt: "not-a-date",
        parentId: "malformed-valid-assistant",
      },
      {
        id: "malformed-cancelled-assistant",
        role: "assistant",
        text: "partial",
        createdAt: "2026-08-04T19:00:00.000Z",
        parentId: "malformed-bad-user",
        cancelled: true,
      },
      {
        id: "malformed-error-assistant",
        role: "assistant",
        text: "boom",
        createdAt: "2026-08-04T20:00:00.000Z",
        parentId: "malformed-cancelled-assistant",
        isError: true,
      },
    ],
    activeLeafId: "malformed-error-assistant",
  });

  // Regression (finding #1): a branched conversation whose activeLeafId is
  // missing/corrupt (points at no turn in the file) must fail quiet — never
  // fall back to a full createdAt linearization of every branch, which would
  // admit an abandoned branch's attention request as if it were live.
  await saveConversation({
    sessionId: "attention-corrupt-leaf",
    familiarId: "charm",
    harness: "claude",
    title: "Corrupt active leaf",
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T09:05:00.000Z",
    turns: [
      {
        id: "corrupt-root",
        role: "user",
        text: "Summarize the plan.",
        attentionClearOperationId: "run-corrupt-must-not-leak",
        createdAt: "2026-08-04T09:00:00.000Z",
        parentId: null,
      },
      {
        id: "corrupt-branch-request",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-04T09:03:00.000Z",
        parentId: "corrupt-root",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-corrupt-leaf",
            turnId: "corrupt-branch-request",
            requestedAt: "2026-08-04T09:03:00.000Z",
            reason: "approval",
          },
        },
      },
      {
        id: "corrupt-branch-active",
        role: "assistant",
        text: "Here is the answer.",
        createdAt: "2026-08-04T09:05:00.000Z",
        parentId: "corrupt-root",
      },
    ],
    // Neither branch tip — simulates a corrupted/rewritten activeLeafId.
    activeLeafId: "corrupt-leaf-that-does-not-exist",
  });

  await saveConversation({
    sessionId: "attention-duplicate-leaf-id",
    familiarId: "charm",
    harness: "claude",
    title: "Duplicate active leaf id",
    createdAt: "2026-08-04T09:10:00.000Z",
    updatedAt: "2026-08-04T09:15:00.000Z",
    turns: [
      {
        id: "duplicate-root",
        role: "user",
        text: "Do you still need approval?",
        createdAt: "2026-08-04T09:10:00.000Z",
        parentId: null,
      },
      {
        id: "duplicate-leaf",
        role: "assistant",
        text: "Yes, I need your approval.",
        createdAt: "2026-08-04T09:12:00.000Z",
        parentId: "duplicate-root",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-duplicate-leaf-id",
            turnId: "duplicate-leaf",
            requestedAt: "2026-08-04T09:12:00.000Z",
            reason: "approval",
          },
        },
      },
      {
        id: "duplicate-leaf",
        role: "assistant",
        text: "No branch disambiguation is possible here.",
        createdAt: "2026-08-04T09:15:00.000Z",
        parentId: "duplicate-root",
      },
    ],
    activeLeafId: "duplicate-leaf",
  });

  await saveConversation({
    sessionId: "attention-ambiguous-missing-leaf",
    familiarId: "charm",
    harness: "claude",
    title: "Ambiguous branch without active leaf",
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:06:00.000Z",
    turns: [
      {
        id: "ambiguous-user",
        role: "user",
        text: "Do you need anything?",
        createdAt: "2026-08-03T10:00:00.000Z",
        parentId: null,
      },
      {
        id: "ambiguous-request",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-03T10:05:00.000Z",
        parentId: "ambiguous-user",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-ambiguous-missing-leaf",
            turnId: "ambiguous-request",
            requestedAt: "2026-08-03T10:05:00.000Z",
            reason: "approval",
          },
        },
      },
      {
        id: "ambiguous-sibling",
        role: "assistant",
        text: "Here is the answer.",
        createdAt: "2026-08-03T10:06:00.000Z",
        parentId: "ambiguous-user",
      },
    ],
  });

  await saveConversation({
    sessionId: "attention-explicit-null-roots",
    familiarId: "charm",
    harness: "claude",
    title: "Explicit null roots must not linearize",
    createdAt: "2026-08-04T11:00:00.000Z",
    updatedAt: "2026-08-04T11:06:00.000Z",
    turns: [
      {
        id: "explicit-null-root-user",
        role: "user",
        text: "Need anything?",
        createdAt: "2026-08-04T11:00:00.000Z",
        parentId: null,
      },
      {
        id: "explicit-null-root-request",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-04T11:05:00.000Z",
        parentId: null,
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-explicit-null-roots",
            turnId: "explicit-null-root-request",
            requestedAt: "2026-08-04T11:05:00.000Z",
            reason: "approval",
          },
        },
      },
      {
        id: "explicit-null-root-answer",
        role: "assistant",
        text: "Here is the answer.",
        createdAt: "2026-08-04T11:06:00.000Z",
        parentId: null,
      },
    ],
  });

  await saveConversation({
    sessionId: "attention-legacy-missing-parent-links",
    familiarId: "charm",
    harness: "claude",
    title: "Legacy missing parent links still linearize",
    createdAt: "2026-08-04T11:10:00.000Z",
    updatedAt: "2026-08-04T11:15:00.000Z",
    turns: [
      {
        id: "legacy-missing-parent-user",
        role: "user",
        text: "Need anything?",
        createdAt: "2026-08-04T11:10:00.000Z",
      },
      {
        id: "legacy-missing-parent-request",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-04T11:15:00.000Z",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-legacy-missing-parent-links",
            turnId: "legacy-missing-parent-request",
            requestedAt: "2026-08-04T11:15:00.000Z",
            reason: "approval",
          },
        },
      },
    ],
  });

  await saveConversation({
    sessionId: "attention-request-resolved-by-malformed-user",
    familiarId: "charm",
    harness: "claude",
    title: "Malformed user still resolves older request",
    createdAt: "2026-08-03T15:00:00.000Z",
    updatedAt: "2026-08-03T18:00:00.000Z",
    turns: [
      {
        id: "malformed-resolution-user-1",
        role: "user",
        text: "Need anything?",
        createdAt: "2026-08-03T15:00:00.000Z",
        parentId: null,
      },
      {
        id: "malformed-resolution-request",
        role: "assistant",
        text: "I need approval.",
        createdAt: "2026-08-03T16:00:00.000Z",
        parentId: "malformed-resolution-user-1",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-request-resolved-by-malformed-user",
            turnId: "malformed-resolution-request",
            requestedAt: "2026-08-03T16:00:00.000Z",
            reason: "approval",
          },
        },
      },
      {
        id: "malformed-resolution-user-2",
        role: "user",
        text: "Go ahead.",
        createdAt: "not-a-date",
        parentId: "malformed-resolution-request",
      },
      {
        id: "malformed-resolution-assistant",
        role: "assistant",
        text: "Thanks — taking it from here.",
        createdAt: "2026-08-03T18:00:00.000Z",
        parentId: "malformed-resolution-user-2",
      },
    ],
    activeLeafId: "malformed-resolution-assistant",
  });

  await saveConversation({
    sessionId: "attention-requested-at-mismatch",
    familiarId: "charm",
    harness: "claude",
    title: "Reject requestedAt mismatch",
    createdAt: "2026-08-04T10:00:00.000Z",
    updatedAt: "2026-08-04T10:05:00.000Z",
    turns: [
      {
        id: "requested-at-mismatch-user",
        role: "user",
        text: "Anything blocking you?",
        createdAt: "2026-08-04T10:00:00.000Z",
        parentId: null,
      },
      {
        id: "requested-at-mismatch-assistant",
        role: "assistant",
        text: "The request timestamp is wrong.",
        createdAt: "2026-08-04T10:05:00.000Z",
        parentId: "requested-at-mismatch-user",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-requested-at-mismatch",
            turnId: "requested-at-mismatch-assistant",
            requestedAt: "2026-08-04T10:04:59.000Z",
            reason: "input",
          },
        },
      },
    ],
    activeLeafId: "requested-at-mismatch-assistant",
  });

  // Regression (cave-zs85n Task 4 spec gap): a noncanonical requestedAt that
  // carries an offset but still parses to the same instant as a canonical
  // assistant createdAt must be rejected. `normalizeStableAttentionRequest`
  // compared parsed instants only, so an offset-equivalent requestedAt was
  // silently canonicalized to the assistant's own createdAt instead of being
  // discarded — accepting a request whose recorded timestamp was never
  // actually canonical.
  await saveConversation({
    sessionId: "attention-canonical-assistant-noncanonical-request",
    familiarId: "charm",
    harness: "claude",
    title: "Canonical assistant, noncanonical request",
    createdAt: "2026-08-04T10:00:00.000Z",
    updatedAt: "2026-08-04T10:05:00.000Z",
    turns: [
      {
        id: "canonical-noncanonical-request-user",
        role: "user",
        text: "Anything blocking you?",
        createdAt: "2026-08-04T10:00:00.000Z",
        parentId: null,
      },
      {
        id: "canonical-noncanonical-request-assistant",
        role: "assistant",
        text: "The request timestamp is offset-equivalent but noncanonical.",
        createdAt: "2026-08-04T10:05:00.000Z",
        parentId: "canonical-noncanonical-request-user",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-canonical-assistant-noncanonical-request",
            turnId: "canonical-noncanonical-request-assistant",
            requestedAt: "2026-08-04T05:05:00.000-05:00",
            reason: "input",
          },
        },
      },
    ],
    activeLeafId: "canonical-noncanonical-request-assistant",
  });

  // Regression (task 4 follow-up): a structurally later user turn clears a
  // prior explicit request purely by active-path *order*, never by comparing
  // timestamps — so an equal (or malformed, see above) createdAt must not
  // let the request survive.
  await saveConversation({
    sessionId: "attention-request-cleared-by-equal-timestamp",
    familiarId: "charm",
    harness: "claude",
    title: "Equal timestamp still clears by path order",
    createdAt: "2026-08-04T08:00:00.000Z",
    updatedAt: "2026-08-04T08:05:00.000Z",
    turns: [
      {
        id: "equal-ts-user-1",
        role: "user",
        text: "Need anything?",
        createdAt: "2026-08-04T08:00:00.000Z",
        parentId: null,
      },
      {
        id: "equal-ts-request",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-04T08:05:00.000Z",
        parentId: "equal-ts-user-1",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-request-cleared-by-equal-timestamp",
            turnId: "equal-ts-request",
            requestedAt: "2026-08-04T08:05:00.000Z",
            reason: "approval",
          },
        },
      },
      {
        // Same instant as the request it structurally follows — the clear
        // must not depend on this being chronologically after it.
        id: "equal-ts-user-2",
        role: "user",
        text: "Go ahead.",
        createdAt: "2026-08-04T08:05:00.000Z",
        parentId: "equal-ts-request",
      },
    ],
    activeLeafId: "equal-ts-user-2",
  });

  // Regression (active-path trust): activeLeafId pointing at a detached,
  // parent-less system echo (excluded from the structural chain entirely)
  // must fail quiet rather than exposing the abandoned assistant request
  // still sitting on the real, unreachable branch.
  await saveConversation({
    sessionId: "attention-detached-leaf",
    familiarId: "charm",
    harness: "claude",
    title: "Detached leaf must fail quiet",
    createdAt: "2026-08-04T09:10:00.000Z",
    updatedAt: "2026-08-04T09:12:00.000Z",
    turns: [
      {
        id: "detached-root",
        role: "user",
        text: "Summarize the plan.",
        createdAt: "2026-08-04T09:10:00.000Z",
        parentId: null,
      },
      {
        id: "detached-abandoned-request",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-04T09:11:00.000Z",
        parentId: "detached-root",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-detached-leaf",
            turnId: "detached-abandoned-request",
            requestedAt: "2026-08-04T09:11:00.000Z",
            reason: "approval",
          },
        },
      },
      // Chain-less system echo: role "system" with no parentId, excluded
      // from structuralTurns entirely. activeLeafId below points at it.
      {
        id: "detached-system-echo",
        role: "system",
        text: "/help output",
        createdAt: "2026-08-04T09:12:00.000Z",
        parentId: null,
      },
    ],
    activeLeafId: "detached-system-echo",
  });

  // Regression (active-path trust): activeLeafId resolvable, but an ancestor
  // in its parent chain names a turn id absent from the file entirely. Must
  // fail quiet rather than truncating the walk and exposing the abandoned
  // request on the real branch.
  await saveConversation({
    sessionId: "attention-broken-parent-chain",
    familiarId: "charm",
    harness: "claude",
    title: "Broken parent chain must fail quiet",
    createdAt: "2026-08-04T09:20:00.000Z",
    updatedAt: "2026-08-04T09:22:00.000Z",
    turns: [
      {
        id: "broken-chain-root",
        role: "user",
        text: "Summarize the plan.",
        createdAt: "2026-08-04T09:20:00.000Z",
        parentId: null,
      },
      {
        id: "broken-chain-abandoned-request",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-04T09:21:00.000Z",
        parentId: "broken-chain-root",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-broken-parent-chain",
            turnId: "broken-chain-abandoned-request",
            requestedAt: "2026-08-04T09:21:00.000Z",
            reason: "approval",
          },
        },
      },
      {
        // parentId names a turn that does not exist anywhere in the file.
        id: "broken-chain-leaf",
        role: "assistant",
        text: "Here is the answer.",
        createdAt: "2026-08-04T09:22:00.000Z",
        parentId: "phantom-ancestor-that-does-not-exist",
      },
    ],
    activeLeafId: "broken-chain-leaf",
  });

  // Regression (active-path trust): a corrupt parent ring (cycle) must fail
  // quiet rather than resolving to any partial/looping chain.
  await saveConversation({
    sessionId: "attention-parent-cycle",
    familiarId: "charm",
    harness: "claude",
    title: "Parent cycle must fail quiet",
    createdAt: "2026-08-04T09:30:00.000Z",
    updatedAt: "2026-08-04T09:31:00.000Z",
    turns: [
      {
        id: "cycle-a",
        role: "user",
        text: "Do you need anything?",
        createdAt: "2026-08-04T09:30:00.000Z",
        parentId: "cycle-b",
      },
      {
        id: "cycle-b",
        role: "assistant",
        text: "I need your approval.",
        createdAt: "2026-08-04T09:31:00.000Z",
        parentId: "cycle-a",
        responseMetadata: {
          familiarId: "charm",
          harness: "claude",
          model: "anthropic/claude-sonnet-4.6",
          runtime: "local:/repo",
          attentionRequest: {
            sessionId: "attention-parent-cycle",
            turnId: "cycle-b",
            requestedAt: "2026-08-04T09:31:00.000Z",
            reason: "approval",
          },
        },
      },
    ],
    activeLeafId: "cycle-a",
  });

  const summaries = await listConversations();
  const byId = new Map(summaries.map((summary) => [summary.sessionId, summary]));

  assert.deepEqual(byId.get("attention-leaf-request")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T18:00:00.000Z" },
    latestUserTurnAt: "2026-08-04T17:00:00.000Z",
    attentionAfterOperationId: "run-leaf",
    attentionOperationLineage: ["run-prior", "run-leaf"],
    request: {
      sessionId: "attention-leaf-request",
      turnId: "leaf-assistant",
      requestedAt: "2026-08-04T18:00:00.000Z",
      reason: "approval",
    },
  });

  assert.deepEqual(byId.get("attention-stale-request-left-hanging")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-03T18:00:00.000Z" },
    latestUserTurnAt: "2026-08-03T17:00:00.000Z",
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-stale-request-left-hanging")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "left-hanging",
      since: "2026-08-03T18:00:00.000Z",
      reason: null,
    },
    "path order resolves historical requests before attention derivation, without erasing later left-hanging fallback",
  );

  assert.deepEqual(byId.get("attention-malformed-request")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-03T18:30:00.000Z" },
    latestUserTurnAt: "2026-08-03T16:00:00.000Z",
    request: { state: "invalid" },
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-malformed-request")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
    "a malformed request on the latest assistant must fail quiet instead of fabricating left-hanging",
  );

  assert.deepEqual(byId.get("attention-malformed-newer-request")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T19:00:00.000Z" },
    latestUserTurnAt: "2026-08-01T16:00:00.000Z",
    request: { state: "invalid" },
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-malformed-newer-request")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
    "newer malformed request evidence must fail quiet instead of resurrecting an older valid request",
  );

  assert.deepEqual(byId.get("attention-noncanonical-request")?.attentionEvidence, {
    latestCompletedTurn: null,
    latestUserTurnAt: "2026-08-04T16:45:00.000Z",
    request: { state: "invalid" },
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-noncanonical-request")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
    "parseable noncanonical assistant/request timestamps must not create attention-capable evidence",
  );

  assert.deepEqual(byId.get("attention-user-leaf-resolution")?.attentionEvidence, {
    latestCompletedTurn: { role: "user", at: "2026-08-04T17:00:00.000Z" },
    latestUserTurnAt: "2026-08-04T17:00:00.000Z",
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-user-leaf-resolution")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "an active user leaf resolves the request without inventing a later assistant fallback",
  );

  assert.deepEqual(byId.get("attention-cancelled-request-turn")?.attentionEvidence, {
    latestCompletedTurn: { role: "user", at: "2026-08-04T14:00:00.000Z" },
    latestUserTurnAt: "2026-08-04T14:00:00.000Z",
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-cancelled-request-turn")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
    "cancelled assistant turns must not surface explicit attention requests",
  );

  assert.deepEqual(byId.get("attention-error-request-turn")?.attentionEvidence, {
    latestCompletedTurn: { role: "user", at: "2026-08-04T14:40:00.000Z" },
    latestUserTurnAt: "2026-08-04T14:40:00.000Z",
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-error-request-turn")?.attentionEvidence,
      status: "failed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
    "error assistant turns must not surface explicit attention requests",
  );

  assert.deepEqual(byId.get("attention-mismatched-turnid-request")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T13:30:00.000Z" },
    latestUserTurnAt: "2026-08-04T13:00:00.000Z",
    request: { state: "invalid" },
  });

  assert.deepEqual(byId.get("attention-off-path-request")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T12:02:00.000Z" },
    latestUserTurnAt: "2026-08-04T12:00:00.000Z",
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-off-path-request")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "a one-root branched transcript remains valid when activeLeafId selects a sibling leaf",
  );

  // Regenerate/rerun root siblings: when activeLeafId selects the
  // request-bearing branch, its request must surface normally — the other
  // root-level sibling elsewhere in the file is irrelevant to that selection.
  assert.deepEqual(byId.get("attention-root-sibling-active-request")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T12:11:00.000Z" },
    latestUserTurnAt: "2026-08-04T12:10:00.000Z",
    attentionAfterOperationId: "run-root-a",
    attentionOperationLineage: ["run-root-a"],
    request: {
      sessionId: "attention-root-sibling-active-request",
      turnId: "root-sibling-a-assistant",
      requestedAt: "2026-08-04T12:11:00.000Z",
      reason: "approval",
    },
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-root-sibling-active-request")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "awaiting-human",
      since: "2026-08-04T12:11:00.000Z",
      reason: "approval",
    },
    "a legitimate root-sibling generation must surface its own request when activeLeafId selects it",
  );

  // Same tree, but activeLeafId selects the other root sibling: its own,
  // request-free branch is what must be reflected — the inactive sibling's
  // request must be ignored, not surfaced and not treated as corrupt.
  assert.deepEqual(byId.get("attention-root-sibling-inactive-request")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T12:13:00.000Z" },
    latestUserTurnAt: "2026-08-04T12:12:00.000Z",
    attentionAfterOperationId: "run-root-b",
    attentionOperationLineage: ["run-root-b"],
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-root-sibling-inactive-request")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "an inactive root sibling's request must never leak into the selected branch's evidence",
  );

  // Root-level terminal/status regression: `status`/`exitCode` are derived
  // from the same active-path resolution (deriveConversationSignals reuses
  // activeConversationTurns), so an inactive root sibling's terminal outcome
  // must never leak into the summary either — in both directions.
  assert.equal(
    byId.get("attention-root-sibling-active-completes")?.status,
    "completed",
    "the active root sibling's success must be reported even though the inactive sibling ended in error",
  );
  assert.equal(
    byId.get("attention-root-sibling-active-completes")?.exitCode,
    0,
    "the active root sibling's exit code must reflect its own success, not the inactive sibling's failure",
  );
  assert.equal(
    byId.get("attention-root-sibling-active-fails")?.status,
    "failed",
    "the active root sibling's failure must be reported even though the inactive sibling completed",
  );
  assert.equal(
    byId.get("attention-root-sibling-active-fails")?.exitCode,
    1,
    "the active root sibling's exit code must reflect its own failure, not the inactive sibling's success",
  );

  assert.deepEqual(byId.get("attention-malformed-turns")?.attentionEvidence, {
    latestCompletedTurn: null,
    latestUserTurnAt: null,
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-malformed-turns")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "a malformed latest eligible turn must not fall back to older completion evidence",
  );

  assert.equal(
    byId.get("attention-corrupt-leaf")?.attentionEvidence,
    undefined,
    "a missing/corrupt activeLeafId must fail quiet, not linearize every branch",
  );
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-corrupt-leaf")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "a corrupt active leaf must never surface an off-path branch's attention request",
  );

  assert.equal(
    byId.get("attention-duplicate-leaf-id")?.attentionEvidence,
    undefined,
    "duplicate turn ids must fail quiet instead of letting activeLeafId resolve by last-wins map order",
  );
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-duplicate-leaf-id")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "an ambiguous duplicate active leaf must not surface any attention state",
  );

  assert.equal(
    byId.get("attention-ambiguous-missing-leaf")?.attentionEvidence,
    undefined,
    "branched conversations without an activeLeafId must fail quiet instead of choosing a branch implicitly",
  );
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-ambiguous-missing-leaf")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "an ambiguous branched conversation with no active leaf must not surface any attention state",
  );

  assert.equal(
    byId.get("attention-explicit-null-roots")?.attentionEvidence,
    undefined,
    "multiple explicit null roots are ambiguous/corrupt, not legacy linear history",
  );
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-explicit-null-roots")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "explicit null-root ambiguity must fail quiet instead of surfacing an abandoned request",
  );

  assert.deepEqual(byId.get("attention-legacy-missing-parent-links")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T11:15:00.000Z" },
    latestUserTurnAt: "2026-08-04T11:10:00.000Z",
    request: {
      sessionId: "attention-legacy-missing-parent-links",
      turnId: "legacy-missing-parent-request",
      requestedAt: "2026-08-04T11:15:00.000Z",
      reason: "approval",
    },
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-legacy-missing-parent-links")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "awaiting-human",
      since: "2026-08-04T11:15:00.000Z",
      reason: "approval",
    },
    "genuinely legacy turns with no parentId must still linearize and surface active requests",
  );

  assert.deepEqual(byId.get("attention-request-resolved-by-malformed-user")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-03T18:00:00.000Z" },
    latestUserTurnAt: null,
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-request-resolved-by-malformed-user")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "left-hanging",
      since: "2026-08-03T18:00:00.000Z",
      reason: null,
    },
    "a malformed-date user turn still resolves the older request, while a later valid assistant can independently become left-hanging",
  );

  assert.deepEqual(byId.get("attention-requested-at-mismatch")?.attentionEvidence, {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T10:05:00.000Z" },
    latestUserTurnAt: "2026-08-04T10:00:00.000Z",
    request: { state: "invalid" },
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-requested-at-mismatch")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "requestedAt must match the containing assistant turn's instant or the request is discarded",
  );

  assert.deepEqual(
    byId.get("attention-canonical-assistant-noncanonical-request")?.attentionEvidence,
    {
      latestCompletedTurn: { role: "assistant", at: "2026-08-04T10:05:00.000Z" },
      latestUserTurnAt: "2026-08-04T10:00:00.000Z",
      request: { state: "invalid" },
    },
  );
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-canonical-assistant-noncanonical-request")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "a noncanonical requestedAt must be rejected even when it is only offset-equivalent to a canonical assistant createdAt",
  );

  assert.deepEqual(byId.get("attention-request-cleared-by-equal-timestamp")?.attentionEvidence, {
    latestCompletedTurn: { role: "user", at: "2026-08-04T08:05:00.000Z" },
    latestUserTurnAt: "2026-08-04T08:05:00.000Z",
    request: null,
  });
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-request-cleared-by-equal-timestamp")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "a structurally later user turn clears a prior request by active-path order even at an equal timestamp",
  );

  assert.equal(
    byId.get("attention-detached-leaf")?.attentionEvidence,
    undefined,
    "an activeLeafId pointing at a detached, parent-less system echo must fail quiet",
  );
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-detached-leaf")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "a detached leaf must never surface the real branch's abandoned attention request",
  );

  assert.equal(
    byId.get("attention-broken-parent-chain")?.attentionEvidence,
    undefined,
    "a parent chain naming a nonexistent ancestor id must fail quiet",
  );
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-broken-parent-chain")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "a broken parent chain must never surface the real branch's abandoned attention request",
  );

  assert.equal(
    byId.get("attention-parent-cycle")?.attentionEvidence,
    undefined,
    "a corrupt parent ring (cycle) must fail quiet rather than resolve a looping chain",
  );
  assert.deepEqual(
    deriveChatAttention({
      evidence: byId.get("attention-parent-cycle")?.attentionEvidence,
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "none",
      since: null,
      reason: null,
    },
    "a parent cycle must never surface its request",
  );

  for (const id of ids) {
    await deleteConversation(id);
  }
}
console.log("cave-conversations attention summary test OK");

// ── First-turn stub / mid-stream model PATCH serialization ──────────────────
// The client receives a session id immediately and can PATCH its model while
// the stub is still being written. Both mutations must queue by conversation
// id so the PATCH sees the stub and the later transcript save sees the PATCH.
{
  const { createConversationStub, withConversationLock } = await import(
    "./cave-conversations.ts"
  );
  const sessionId = "stub-model-lock";
  let releaseHold;
  let markEntered;
  const entered = new Promise((resolve) => {
    markEntered = resolve;
  });
  const hold = withConversationLock(sessionId, async () => {
    markEntered();
    await new Promise((resolve) => {
      releaseHold = resolve;
    });
  });
  await entered;

  const stubWrite = createConversationStub({
    sessionId,
    familiarId: "nyx",
    harness: "claude",
    modelIntent: {
      model: "anthropic/claude-opus-4-6",
      source: "session",
      applicationState: "saved",
      reason: "Saved for this chat.",
    },
    userTurn: { id: "pending-model-turn", text: "Use the selected model." },
  });
  const modelPatch = withConversationLock(sessionId, async () => {
    const conversation = await loadConversation(sessionId);
    assert.ok(conversation, "the queued PATCH runs after first-turn stub persistence");
    conversation.modelIntent = {
      model: "anthropic/claude-haiku-4-5",
      source: "session",
      applicationState: "saved",
      reason: "Saved for this chat.",
    };
    await saveConversation(conversation);
  });

  releaseHold();
  await hold;
  assert.equal(await stubWrite, true);
  await modelPatch;
  assert.equal(
    (await loadConversation(sessionId))?.modelIntent?.model,
    "anthropic/claude-haiku-4-5",
    "a newer queued model PATCH wins without a transient 404 or lost update",
  );
  await deleteConversation(sessionId);
}
console.log("cave-conversations model-lock test OK");

// ── Selected-chain validation stays O(chain length) on long/branched trees ──
// Regression for the retired `hasSingleStructuralRoot`: that check re-walked
// every turn's full ancestor chain looking for a shared root across the
// *entire* file, which cost O(n) per turn — O(n^2) overall — and wrongly
// treated legitimate root-level siblings (a regenerate/rerun starting a fresh
// root turn) as corruption. The current design never does that walk: it only
// resolves the ids the selected activeLeafId actually visits, via one O(n)
// id-map build (`resolveAncestorChainFromMap`'s caller) followed by an
// O(chain length) walk — which is visible directly in the resolver's source,
// so no runtime step-counter or wall-clock timing is needed here to prove it.
{
  function buildLinearChain(prefix, length, baseMs) {
    const turns = [];
    for (let i = 0; i < length; i += 1) {
      const role = i % 2 === 0 ? "user" : "assistant";
      turns.push({
        id: `${prefix}-${i}`,
        role,
        text: role === "user" ? `Message ${i}` : `Reply ${i}`,
        createdAt: new Date(baseMs + i * 1000).toISOString(),
        parentId: i === 0 ? null : `${prefix}-${i - 1}`,
      });
    }
    return turns;
  }

  // A long, entirely valid linear/selected chain: the active path must still
  // resolve correctly and surface the true latest turns at scale.
  const LONG_CHAIN_LENGTH = 6000;
  const longChainBaseMs = Date.UTC(2026, 7, 4, 0, 0, 0);
  const longChainTurns = buildLinearChain("long-chain-turn", LONG_CHAIN_LENGTH, longChainBaseMs);
  const longChainLeafId = longChainTurns[LONG_CHAIN_LENGTH - 1].id;

  await saveConversation({
    sessionId: "structural-root-long-chain",
    familiarId: "charm",
    harness: "claude",
    title: "Long linear history",
    createdAt: longChainTurns[0].createdAt,
    updatedAt: longChainTurns[LONG_CHAIN_LENGTH - 1].createdAt,
    turns: longChainTurns,
    activeLeafId: longChainLeafId,
  });

  const longChainSummaries = await listConversations();
  const longChainSummary = longChainSummaries.find(
    (summary) => summary.sessionId === "structural-root-long-chain",
  );

  assert.ok(
    longChainSummary?.attentionEvidence,
    "a long, entirely valid linear history must still resolve its active path and surface attention evidence",
  );
  assert.equal(
    longChainSummary?.attentionEvidence?.latestUserTurnAt,
    longChainTurns[LONG_CHAIN_LENGTH - 2].createdAt,
    "the active-path result over a long chain must still reflect the true latest user turn",
  );
  assert.deepEqual(
    longChainSummary?.attentionEvidence?.latestCompletedTurn,
    { role: "assistant", at: longChainTurns[LONG_CHAIN_LENGTH - 1].createdAt },
    "the active-path result over a long chain must still reflect the true latest completed turn",
  );

  await deleteConversation("structural-root-long-chain");

  // A long history whose parent links form one big cycle (no turn's chain
  // ever reaches a null parentId). Must fail quiet — not hang, not stack
  // overflow via recursion — since the walk is iterative and bounded by the
  // selected chain length (here, the whole ring).
  const CYCLE_LENGTH = 4000;
  const cycleBaseMs = Date.UTC(2026, 7, 5, 0, 0, 0);
  const cycleTurns = buildLinearChain("cycle-turn", CYCLE_LENGTH, cycleBaseMs);
  // Break the root: instead of null, point turn 0 at the last turn, closing
  // the whole chain into a single cycle of length CYCLE_LENGTH.
  cycleTurns[0].parentId = cycleTurns[CYCLE_LENGTH - 1].id;

  await saveConversation({
    sessionId: "structural-root-long-cycle",
    familiarId: "charm",
    harness: "claude",
    title: "Long parent cycle must fail quiet",
    createdAt: cycleTurns[0].createdAt,
    updatedAt: cycleTurns[CYCLE_LENGTH - 1].createdAt,
    turns: cycleTurns,
    activeLeafId: cycleTurns[CYCLE_LENGTH - 1].id,
  });

  const cycleSummaries = await listConversations();
  const cycleSummary = cycleSummaries.find(
    (summary) => summary.sessionId === "structural-root-long-cycle",
  );

  assert.equal(
    cycleSummary?.attentionEvidence,
    undefined,
    "a long parent cycle must fail quiet instead of resolving a looping chain",
  );

  await deleteConversation("structural-root-long-cycle");

  // Two long, individually valid chains that never connect: a legitimate
  // large-scale regenerate/rerun scenario (two big root-level siblings). The
  // active leaf lives on chain A; chain B is a disconnected root sibling and
  // must simply be ignored — never walked, and never treated as corruption —
  // while chain A's own evidence still resolves correctly at scale.
  const ROOT_SIBLING_HALF_LENGTH = 3000;
  const chainABaseMs = Date.UTC(2026, 7, 6, 0, 0, 0);
  const chainBBaseMs = Date.UTC(2026, 7, 6, 1, 0, 0);
  const chainATurns = buildLinearChain("root-sibling-a", ROOT_SIBLING_HALF_LENGTH, chainABaseMs);
  const chainBTurns = buildLinearChain("root-sibling-b", ROOT_SIBLING_HALF_LENGTH, chainBBaseMs);
  const rootSiblingActiveLeafId = chainATurns[ROOT_SIBLING_HALF_LENGTH - 1].id;

  await saveConversation({
    sessionId: "structural-root-long-root-siblings",
    familiarId: "charm",
    harness: "claude",
    title: "Long root-sibling generations resolve the active one",
    createdAt: chainATurns[0].createdAt,
    updatedAt: chainBTurns[ROOT_SIBLING_HALF_LENGTH - 1].createdAt,
    turns: [...chainATurns, ...chainBTurns],
    activeLeafId: rootSiblingActiveLeafId,
  });

  const rootSiblingSummaries = await listConversations();
  const rootSiblingSummary = rootSiblingSummaries.find(
    (summary) => summary.sessionId === "structural-root-long-root-siblings",
  );

  assert.ok(
    rootSiblingSummary?.attentionEvidence,
    "a large disconnected root sibling must never prevent the active chain from resolving",
  );
  assert.equal(
    rootSiblingSummary?.attentionEvidence?.latestUserTurnAt,
    chainATurns[ROOT_SIBLING_HALF_LENGTH - 2].createdAt,
    "the active chain's own latest user turn must resolve, ignoring the disconnected sibling entirely",
  );
  assert.deepEqual(
    rootSiblingSummary?.attentionEvidence?.latestCompletedTurn,
    { role: "assistant", at: chainATurns[ROOT_SIBLING_HALF_LENGTH - 1].createdAt },
    "the active chain's own latest completed turn must resolve, ignoring the disconnected sibling entirely",
  );

  await deleteConversation("structural-root-long-root-siblings");
}
console.log("cave-conversations structural-root perf/regression test OK");
