// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearChatDebugState,
  consumePendingDebugOpen,
  getChatDebugSnapshot,
  publishChatDebugState,
  requestDebugOpen,
} from "./chat-debug-store.ts";

const snap = (sessionId, extra = {}) => ({
  sessionId,
  session: null,
  familiar: null,
  turns: [],
  ...extra,
});

// ── Publish / read ───────────────────────────────────────────────────────────

const empty = getChatDebugSnapshot();
assert.equal(empty.sessionId, null, "store starts empty");
assert.throws(
  () => {
    empty.turns.push({ id: "x" });
  },
  "the EMPTY sentinel's turns array is frozen — accidental mutation must throw",
);

const tokenA = Symbol("a");
const tokenB = Symbol("b");

publishChatDebugState(tokenA, snap("s-a"));
assert.equal(getChatDebugSnapshot().sessionId, "s-a", "publish is readable");

// ── Last writer wins (the reason DebugPane must NOT read this store) ─────────

publishChatDebugState(tokenB, snap("s-b"));
assert.equal(
  getChatDebugSnapshot().sessionId,
  "s-b",
  "two live publishers race: the last writer wins, whatever pane it belongs to",
);

// ── Token-guarded clear ──────────────────────────────────────────────────────

clearChatDebugState(tokenA);
assert.equal(
  getChatDebugSnapshot().sessionId,
  "s-b",
  "a stale publisher unmounting must not wipe state published after it",
);

clearChatDebugState(tokenB);
assert.equal(getChatDebugSnapshot().sessionId, null, "the current publisher's clear empties the store");
assert.equal(getChatDebugSnapshot(), empty, "clearing restores the shared EMPTY sentinel");

clearChatDebugState(tokenB);
assert.equal(getChatDebugSnapshot(), empty, "double-clear is a no-op");

// ── Debug-open latch ─────────────────────────────────────────────────────────
// chat-list opens a session, then asks for the debug modal one rAF later; when
// ChatView (and its cave:debug-open listener) has not mounted yet, the window
// event alone is lost. The latch survives until the next ChatView mount.

assert.equal(consumePendingDebugOpen(), false, "no request pending initially");

requestDebugOpen(1_000);
assert.equal(consumePendingDebugOpen(1_500), true, "a fresh request is consumed");
assert.equal(consumePendingDebugOpen(1_500), false, "consuming is one-shot");

requestDebugOpen(1_000);
assert.equal(
  consumePendingDebugOpen(10_000),
  false,
  "a stale request (past the TTL) must not ghost-open the modal on a later mount",
);
assert.equal(consumePendingDebugOpen(10_000), false, "a stale request is discarded, not retried");

// ── Wiring pins ──────────────────────────────────────────────────────────────

const debugPane = readFileSync(new URL("../components/debug-pane.tsx", import.meta.url), "utf8");
assert.doesNotMatch(
  debugPane,
  /useChatDebugSnapshot/,
  "DebugPane must read its owning ChatView's props, not the global last-writer store — " +
    "with split panes, the store may hold a different pane's session",
);

const chatView = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
assert.match(
  chatView,
  /<DebugPane[\s\S]*sessionId=\{sessionId\}[\s\S]*session=\{session \?\? null\}[\s\S]*familiar=\{familiar\}[\s\S]*turns=\{turns\}[\s\S]*streamHealth=\{streamHealth\}[\s\S]*\/>/,
  "ChatView hands its own live state to the DebugPane in its modal",
);
assert.match(
  chatView,
  /if \(consumePendingDebugOpen\(\)\) setDebugModalOpen\(true\);/,
  "ChatView consumes a latched debug-open request on mount (rAF race fix)",
);

const chatList = readFileSync(new URL("../components/chat-list.tsx", import.meta.url), "utf8");
assert.match(chatList, /requestDebugOpen\(\)/, "chat-list debug action goes through the latched request");
assert.doesNotMatch(
  chatList,
  /new CustomEvent\("cave:debug-open"\)/,
  "chat-list must not raw-dispatch cave:debug-open — the bare event loses the race with ChatView's mount",
);

console.log("chat-debug-store tests passed");
