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

if (previousHome === undefined) {
  delete process.env.HOME;
} else {
  process.env.HOME = previousHome;
}
await rm(home, { recursive: true, force: true });

console.log("cave-conversations.test.ts: ok");
