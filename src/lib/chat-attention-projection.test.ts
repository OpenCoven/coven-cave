import assert from "node:assert/strict";
import test from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import {
  applyChatAttentionProjections,
  chatAttentionProjectionScopeKey,
  createChatAttentionProjectionState,
  isCurrentSessionListRequest,
  recordChatAttentionClear,
  settleChatAttentionClear,
} from "./chat-attention-projection.ts";
import type { SessionRow } from "./types.ts";

const NEEDS_ATTENTION = {
  state: "awaiting-human" as const,
  since: "2026-08-05T00:00:00.000Z",
  reason: "input" as const,
};

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    project_root: "/repo",
    harness: "claude",
    title: "Chat",
    status: "running",
    exit_code: null,
    archived_at: null,
    created_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
    attention: NEEDS_ATTENTION,
    ...overrides,
  };
}

test("scope switch rejects an old-scope response even when its request id is latest", () => {
  assert.equal(isCurrentSessionListRequest({
    requestId: 3,
    currentRequestId: 3,
    capturedScopeKey: "familiar:nova",
    currentScopeKey: "familiar:sage",
  }), false);
});

test("a stale list response after a clear remains projected to none", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));

  assert.equal(
    applyChatAttentionProjections(state, [row()], 4, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
});

test("a failed send restores canonical attention on its reconciliation response", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  const canonical = [row()];
  assert.equal(
    applyChatAttentionProjections(state, canonical, 5, chatAttentionProjectionScopeKey("nova")),
    canonical,
  );
});

test("a response below the persisted threshold still projects none", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  assert.equal(
    applyChatAttentionProjections(state, [row()], 5, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.has("session-1"), true);
});

test("eligible post-settlement canonical awaiting-human releases the persisted projection", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const canonical = [row()];
  assert.equal(
    applyChatAttentionProjections(state, canonical, 6, chatAttentionProjectionScopeKey("nova")),
    canonical,
  );
  assert.equal(state.has("session-1"), false);
});

test("eligible post-settlement canonical none still releases the persisted projection", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);
});

test("the first failed operation cannot undo a second live clear for the same session", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));
  recordChatAttentionClear(state, "session-1", "operation-2", chatAttentionProjectionScopeKey("nova"));
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 8);

  assert.equal(
    applyChatAttentionProjections(state, [row()], 8, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );

  settleChatAttentionClear(state, "session-1", "operation-2", "failed", 9);
  assert.equal(
    applyChatAttentionProjections(state, [row()], 9, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "awaiting-human",
  );
});

test("an overlapping pending clear still projects none when an older persisted clear releases", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);
  recordChatAttentionClear(state, "session-1", "operation-2", chatAttentionProjectionScopeKey("nova"));

  assert.equal(
    applyChatAttentionProjections(state, [row()], 6, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.get("session-1")?.has("operation-1"), false);
  assert.equal(state.get("session-1")?.get("operation-2")?.status, "pending");
});

test("absence cannot release a pending clear but can retire a persisted clear after a fresh response", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));

  applyChatAttentionProjections(state, [], 9, chatAttentionProjectionScopeKey("sage"));
  assert.equal(state.has("session-1"), true);

  applyChatAttentionProjections(state, [], 9, chatAttentionProjectionScopeKey("nova"));
  assert.equal(state.has("session-1"), true);

  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 10);
  applyChatAttentionProjections(state, [], 10, chatAttentionProjectionScopeKey("nova"));
  assert.equal(state.has("session-1"), false);
});

test("projection preserves array identity when no field changes", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(state, "session-1", "operation-1", chatAttentionProjectionScopeKey("nova"));
  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 1, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );

  const unrelated = [row({ id: "session-2" })];
  assert.equal(applyChatAttentionProjections(state, unrelated, 1), unrelated);
});
