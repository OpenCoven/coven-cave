// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const previousHome = process.env.HOME;
const home = await mkdtemp(path.join(tmpdir(), "cave-conversations-"));
process.env.HOME = home;

const {
  deleteConversation,
  isSafeConversationSessionId,
  listConversations,
  loadConversation,
  saveConversation,
} = await import("./cave-conversations.ts");

assert.equal(isSafeConversationSessionId("session-1"), true);
assert.equal(isSafeConversationSessionId("019e-a-valid-thread"), true);
assert.equal(isSafeConversationSessionId("../session-1"), false);
assert.equal(isSafeConversationSessionId("nested/session-1"), false);
assert.equal(isSafeConversationSessionId("nested\\session-1"), false);
assert.equal(isSafeConversationSessionId("."), false);
assert.equal(isSafeConversationSessionId(".."), false);
assert.equal(isSafeConversationSessionId(""), false);

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
    userTurn: { id: "pending-user-turn", text: "fix the flaky test please" },
  });
  assert.equal(created, true, "a brand-new chat gets a stub conversation");

  const stub = await loadConversation("stub-first-turn");
  assert.equal(stub?.turns.length, 1, "stub holds only the pending user turn");
  assert.equal(stub?.turns[0]?.id, "pending-user-turn");
  assert.equal(stub?.turns[0]?.role, "user");
  assert.equal(stub?.turns[0]?.text, "fix the flaky test please");
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
}
console.log("cave-conversations cache test OK");
