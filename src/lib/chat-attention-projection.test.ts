import assert from "node:assert/strict";
import test from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import {
  applyChatAttentionProjections,
  chatAttentionProjectionScopeKey,
  createChatAttentionProjectionState,
  forgetChatAttentionProjections,
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
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );

  assert.equal(
    applyChatAttentionProjections(state, [row()], 4, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
});

test("a failed send restores canonical attention on its reconciliation response", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  const canonical = [row()];
  assert.equal(
    applyChatAttentionProjections(state, canonical, 5, chatAttentionProjectionScopeKey("nova")),
    canonical,
  );
});

test("a matching canonical poll after a failed clear keeps the retry baseline alive for the next operation", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  const staleCanonical = [row({ attention: { ...NEEDS_ATTENTION } })];
  assert.equal(
    applyChatAttentionProjections(state, staleCanonical, 6, chatAttentionProjectionScopeKey("nova")),
    staleCanonical,
  );

  const retried = recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.deepEqual(retried, { recorded: true, reason: "recorded" });
  assert.deepEqual(state.get("session-1")?.get("operation-2")?.baseline, NEEDS_ATTENTION);
});

test("a response below the persisted threshold still projects none", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  assert.equal(
    applyChatAttentionProjections(state, [row()], 5, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.has("session-1"), true);
});

test("eligible overdue-human attention with the same request identity remains projected after settlement", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    { ...NEEDS_ATTENTION },
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const canonical = [row({
    attention: { state: "overdue-human", since: NEEDS_ATTENTION.since, reason: NEEDS_ATTENTION.reason },
  })];
  assert.equal(
    applyChatAttentionProjections(state, canonical, 6, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.has("session-1"), true);
});

test("eligible post-settlement canonical none still releases the persisted projection", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);
});

test("eligible new awaiting-human attention with a new since releases the persisted projection", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const newRequest = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:05:00.000Z", reason: "approval" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, newRequest, 6, chatAttentionProjectionScopeKey("nova")),
    newRequest,
  );
  assert.equal(state.has("session-1"), false);
});

test("eligible new awaiting-human attention with the same since but a changed reason releases the persisted projection", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const newRequest = [row({
    attention: { state: "awaiting-human", since: NEEDS_ATTENTION.since, reason: "approval" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, newRequest, 6, chatAttentionProjectionScopeKey("nova")),
    newRequest,
  );
  assert.equal(state.has("session-1"), false);
});

test("left-hanging attention identity is anchored by since when reason is null", () => {
  const state = createChatAttentionProjectionState();
  const baseline = { state: "left-hanging" as const, since: "2026-08-04T00:00:00.000Z", reason: null };
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    baseline,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  assert.equal(
    applyChatAttentionProjections(state, [row({ attention: baseline })], 6, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.has("session-1"), true);
});

test("the first failed operation cannot undo a second live clear for the same session", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  const projected = applyChatAttentionProjections(
    state,
    [row()],
    7,
    chatAttentionProjectionScopeKey("nova"),
  )[0]?.attention;
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    projected,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 8);

  assert.equal(
    applyChatAttentionProjections(state, [row()], 8, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );

  settleChatAttentionClear(state, "session-1", "operation-2", "persisted", 9);
  assert.equal(
    applyChatAttentionProjections(state, [row()], 9, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.has("session-1"), true);
});

test("an overlapping pending clear still projects none when an older persisted clear releases", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );

  const newRequest = row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:05:00.000Z", reason: "approval" },
  });
  assert.equal(
    applyChatAttentionProjections(state, [newRequest], 6, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.get("session-1")?.has("operation-1"), false);
  assert.equal(state.get("session-1")?.get("operation-2")?.status, "pending");
});

test("absence cannot release a pending clear but can retire a persisted clear after a fresh response", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );

  applyChatAttentionProjections(state, [], 9, chatAttentionProjectionScopeKey("sage"));
  assert.equal(state.has("session-1"), true);

  applyChatAttentionProjections(state, [], 9, chatAttentionProjectionScopeKey("nova"));
  assert.equal(state.has("session-1"), true);

  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 10);
  applyChatAttentionProjections(state, [], 10, chatAttentionProjectionScopeKey("nova"));
  assert.equal(state.has("session-1"), false);
});

test("repeated clears keep the original scope until that scope catches up", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("sage"),
    NO_CHAT_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 11);

  applyChatAttentionProjections(state, [], 11, chatAttentionProjectionScopeKey("sage"));
  assert.equal(state.has("session-1"), true);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 11, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);
});

test("projection preserves array identity when no field changes", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 1, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );

  const unrelated = [row({ id: "session-2" })];
  assert.equal(applyChatAttentionProjections(state, unrelated, 1), unrelated);
});

test("a stale pending notification cannot downgrade an already-persisted operation", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);
  assert.equal(state.get("session-1")?.get("operation-1")?.status, "persisted");

  // A duplicate/late recordChatAttentionClear for the SAME operationId (e.g. a
  // registry-subscription replay racing its own settle) must be a no-op: it
  // must not resurrect "pending" status, and it must not overwrite the
  // canonicalAfterRequestId or baseline the settlement already recorded.
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("sage"),
    NO_CHAT_ATTENTION,
  );
  const operation = state.get("session-1")?.get("operation-1");
  assert.equal(operation?.status, "persisted");
  assert.equal((operation as { canonicalAfterRequestId?: number })?.canonicalAfterRequestId, 6);
  assert.equal(operation?.scopeKey, chatAttentionProjectionScopeKey("nova"));
  assert.deepEqual(operation?.baseline, NEEDS_ATTENTION);

  // The persisted operation still retires correctly on a fresh, eligible
  // canonical response — proving the no-op left it fully functional.
  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);
});

test("a duplicate clear for the same live operation is a full no-op", () => {
  const state = createChatAttentionProjectionState();
  const first = recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  const originalOperation = state.get("session-1")?.get("operation-1");
  const duplicate = recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("sage"),
    NO_CHAT_ATTENTION,
  );

  assert.deepEqual(first, { recorded: true, reason: "recorded" });
  assert.deepEqual(duplicate, { recorded: false, reason: "duplicate" });
  assert.equal(state.get("session-1")?.get("operation-1"), originalOperation);
  assert.equal(originalOperation?.status, "pending");
  assert.equal(originalOperation?.scopeKey, chatAttentionProjectionScopeKey("nova"));
  assert.deepEqual(originalOperation?.baseline, NEEDS_ATTENTION);
});

test("an initial canonical none creates no override and cannot hide future attention", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );

  assert.equal(state.has("session-1"), false);
  const futureRequest = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:10:00.000Z", reason: "decision" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, futureRequest, 2, chatAttentionProjectionScopeKey("nova")),
    futureRequest,
  );
});

// Offline-queued sends settle "persisted" before canonical attention changes.
test("an offline-queued send settled persisted before travel sync keeps projecting none across repeated stale canonical polls", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const staleCanonical = [row({ attention: { ...NEEDS_ATTENTION } })];
  for (const responseRequestId of [6, 7, 8]) {
    assert.equal(
      applyChatAttentionProjections(state, staleCanonical, responseRequestId, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
      "none",
      `poll ${responseRequestId} must not resurrect the stale awaiting-human snapshot`,
    );
    assert.equal(state.has("session-1"), true, `projection must survive stale poll ${responseRequestId}`);
  }
});

test("a later durably-synced canonical response releases the offline-queued projection and reveals canonical state", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  applyChatAttentionProjections(state, [row({ attention: { ...NEEDS_ATTENTION } })], 6, chatAttentionProjectionScopeKey("nova"));
  applyChatAttentionProjections(state, [row({ attention: { ...NEEDS_ATTENTION } })], 7, chatAttentionProjectionScopeKey("nova"));
  assert.equal(state.has("session-1"), true);

  const syncedCanonical = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, syncedCanonical, 8, chatAttentionProjectionScopeKey("nova")),
    syncedCanonical,
  );
  assert.equal(state.has("session-1"), false);
});

// Late duplicate clears must stay ignored after failure or canonical release.
test("a clear followed by failed settlement then a duplicate clear for the same op is ignored, restoring canonical attention", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);
  assert.equal(state.has("session-1"), false);

  const duplicate = recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.deepEqual(duplicate, { recorded: false, reason: "tombstoned" });
  assert.equal(state.has("session-1"), false);

  const canonical = [row()];
  assert.equal(
    applyChatAttentionProjections(state, canonical, 5, chatAttentionProjectionScopeKey("nova")),
    canonical,
  );
});

test("an immediate retry after a failed final clear inherits its canonical baseline and suppresses stale persisted polls", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.deepEqual(state.get("session-1")?.get("operation-2")?.baseline, NEEDS_ATTENTION);
  assert.equal(
    applyChatAttentionProjections(
      state,
      [row({ attention: { ...NEEDS_ATTENTION } })],
      6,
      chatAttentionProjectionScopeKey("nova"),
    )[0]?.attention.state,
    "none",
  );

  settleChatAttentionClear(state, "session-1", "operation-2", "persisted", 7);
  for (const responseRequestId of [7, 8]) {
    assert.equal(
      applyChatAttentionProjections(
        state,
        [row({ attention: { ...NEEDS_ATTENTION } })],
        responseRequestId,
        chatAttentionProjectionScopeKey("nova"),
      )[0]?.attention.state,
      "none",
      `unchanged canonical poll ${responseRequestId} must stay suppressed`,
    );
    assert.equal(state.has("session-1"), true);
  }
});

test("canonical reconciliation after a failed final clear consumes its retained baseline before a later clear", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.equal(state.has("session-1"), false);
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 7, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
});

test("scope absence only consumes a failed clear baseline when that response can prove absence", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  applyChatAttentionProjections(state, [], 6, chatAttentionProjectionScopeKey("sage"));
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.deepEqual(state.get("session-1")?.get("operation-2")?.baseline, NEEDS_ATTENTION);

  settleChatAttentionClear(state, "session-1", "operation-2", "failed", 6);
  applyChatAttentionProjections(state, [], 7, chatAttentionProjectionScopeKey("nova"));
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-3",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.equal(state.has("session-1"), false);
});

test("a clear followed by persisted settlement and canonical release, then a duplicate clear for the same op is ignored", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.has("session-1"), false);

  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 7, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
});

test("a duplicate clear while an operation is still persisted (not yet tombstoned) does not revert it to pending", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );

  assert.equal(state.get("session-1")?.get("operation-1")?.status, "persisted");
});

test("the same operation id tombstoned in one session leaves an identical operation id in a different session independent", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);
  assert.equal(state.has("session-1"), false);

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.has("session-1"), false);

  recordChatAttentionClear(
    state,
    "session-2",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.get("session-2")?.get("operation-1")?.status, "pending");
});

test("forgetting projections preserves settled tombstones so queued late clears stay ignored", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  recordChatAttentionClear(
    state,
    "session-2",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-2", "operation-1", "failed", 5);

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  recordChatAttentionClear(
    state,
    "session-2",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.has("session-1"), false);
  assert.equal(state.has("session-2"), false);

  forgetChatAttentionProjections(state, ["session-1"]);
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.has("session-1"), false);

  recordChatAttentionClear(
    state,
    "session-2",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.has("session-2"), false);
});

test("the state-wide tombstone bound evicts the oldest composite operation key", () => {
  const state = createChatAttentionProjectionState();
  const TOMBSTONE_LIMIT = 512;
  for (let i = 0; i < TOMBSTONE_LIMIT + 1; i += 1) {
    const sessionId = `session-${i}`;
    recordChatAttentionClear(
      state,
      sessionId,
      "operation-1",
      chatAttentionProjectionScopeKey("nova"),
      NEEDS_ATTENTION,
    );
    settleChatAttentionClear(state, sessionId, "operation-1", "failed", 5);
  }

  recordChatAttentionClear(
    state,
    "session-0",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.get("session-0")?.get("operation-1")?.status, "pending");

  recordChatAttentionClear(
    state,
    `session-${TOMBSTONE_LIMIT}`,
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.has(`session-${TOMBSTONE_LIMIT}`), false);
});

test("the outer projection state evicts the oldest settled session before a still-pending one", () => {
  const state = createChatAttentionProjectionState();
  const SESSION_LIMIT = 512;

  recordChatAttentionClear(
    state,
    "session-pending",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  for (let i = 0; i < SESSION_LIMIT; i += 1) {
    const sessionId = `session-${i}`;
    recordChatAttentionClear(
      state,
      sessionId,
      "operation-1",
      chatAttentionProjectionScopeKey("nova"),
      NEEDS_ATTENTION,
    );
    settleChatAttentionClear(state, sessionId, "operation-1", "persisted", 5);
  }

  assert.equal(state.size, SESSION_LIMIT);
  assert.equal(state.has("session-pending"), true);
  assert.equal(state.has("session-0"), false);
  assert.equal(state.has(`session-${SESSION_LIMIT - 1}`), true);
});

test("a duplicate clear for the same live operation refreshes recency without altering recorded state", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  const before = state.get("session-1")?.get("operation-1");

  const duplicate = recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );

  assert.deepEqual(duplicate, { recorded: false, reason: "duplicate" });
  // Idempotent: the recorded operation itself is untouched by the replay.
  assert.equal(state.get("session-1")?.get("operation-1"), before);
});

test("a duplicate clear for an already-persisted operation refreshes recency and does not starve under the eviction bound", () => {
  // Regression: recordChatAttentionClear used to return the "duplicate"
  // rejection before touching the session's LRU bucket, so a session hit only
  // by replayed/duplicate clears (its one real record long past) never
  // refreshed its recency. Under the CHAT_ATTENTION_SESSION_BUCKET_LIMIT
  // eviction bound that starved it: a still-relevant session (proven live by
  // the very fact it keeps receiving clear replays) could be evicted ahead of
  // genuinely idle sessions. The duplicate path must touch recency too.
  const state = createChatAttentionProjectionState();
  const SESSION_LIMIT = 512;

  recordChatAttentionClear(
    state,
    "session-old",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-old", "operation-1", "persisted", 5);

  // The first batch session lands immediately after session-old, so it
  // becomes the new "oldest" once session-old's recency is refreshed below.
  recordChatAttentionClear(
    state,
    "session-0",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-0", "operation-1", "persisted", 5);

  // A duplicate/replayed clear for session-old's already-persisted operation:
  // rejected, but must move session-old to the back of the recency order.
  const duplicate = recordChatAttentionClear(
    state,
    "session-old",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.deepEqual(duplicate, { recorded: false, reason: "duplicate" });

  for (let i = 1; i < SESSION_LIMIT; i += 1) {
    const sessionId = `session-${i}`;
    recordChatAttentionClear(
      state,
      sessionId,
      "operation-1",
      chatAttentionProjectionScopeKey("nova"),
      NEEDS_ATTENTION,
    );
    settleChatAttentionClear(state, sessionId, "operation-1", "persisted", 5);
  }

  assert.equal(state.size, SESSION_LIMIT);
  assert.equal(state.has("session-old"), true, "the duplicate-refreshed session must survive eviction");
  assert.equal(state.has("session-0"), false, "the session that fell behind session-old's refresh is now oldest");
  assert.equal(state.has(`session-${SESSION_LIMIT - 1}`), true);
});

test("forgetting a session keeps its settled operation in the bounded replay cache", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);
  forgetChatAttentionProjections(state, ["session-1"]);

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  assert.equal(state.has("session-1"), false);
});

test("retained canonical baselines are bounded across sessions", () => {
  const state = createChatAttentionProjectionState();
  const TRACKER_LIMIT = 512;
  for (let i = 0; i < TRACKER_LIMIT + 1; i += 1) {
    const sessionId = `session-${i}`;
    recordChatAttentionClear(
      state,
      sessionId,
      "operation-1",
      chatAttentionProjectionScopeKey("nova"),
      NEEDS_ATTENTION,
    );
    settleChatAttentionClear(state, sessionId, "operation-1", "failed", 5);
  }

  recordChatAttentionClear(
    state,
    "session-0",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.equal(state.has("session-0"), false);

  recordChatAttentionClear(
    state,
    `session-${TRACKER_LIMIT}`,
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.deepEqual(
    state.get(`session-${TRACKER_LIMIT}`)?.get("operation-2")?.baseline,
    NEEDS_ATTENTION,
  );
});

// Overlapping clears must baseline from the last accepted canonical row.
test("an overlapping operation captures the latest tracked canonical baseline, not a sibling's stale one", () => {
  const state = createChatAttentionProjectionState();
  const canonicalA = NEEDS_ATTENTION;
  const canonicalB = {
    state: "awaiting-human" as const,
    since: "2026-08-05T00:10:00.000Z",
    reason: "approval" as const,
  };
  const canonicalC = {
    state: "awaiting-human" as const,
    since: "2026-08-05T00:20:00.000Z",
    reason: "decision" as const,
  };

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    canonicalA,
  );

  applyChatAttentionProjections(
    state,
    [row({ attention: canonicalB })],
    5,
    chatAttentionProjectionScopeKey("nova"),
  );

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.deepEqual(state.get("session-1")?.get("operation-2")?.baseline, canonicalB);

  settleChatAttentionClear(state, "session-1", "operation-2", "persisted", 6);

  for (const responseRequestId of [6, 7]) {
    assert.equal(
      applyChatAttentionProjections(
        state,
        [row({ attention: canonicalB })],
        responseRequestId,
        chatAttentionProjectionScopeKey("nova"),
      )[0]?.attention.state,
      "none",
      `poll ${responseRequestId} must not retire op2 against its own matching baseline B`,
    );
    assert.equal(
      state.get("session-1")?.has("operation-2"),
      true,
      `op2 must survive stale-but-matching poll ${responseRequestId}`,
    );
  }

  assert.equal(state.get("session-1")?.get("operation-1")?.status, "pending");
  assert.deepEqual(state.get("session-1")?.get("operation-1")?.baseline, canonicalA);

  const projectedAfterC = applyChatAttentionProjections(
    state,
    [row({ attention: canonicalC })],
    8,
    chatAttentionProjectionScopeKey("nova"),
  );
  assert.equal(
    state.get("session-1")?.has("operation-2"),
    false,
    "op2 must retire once canonical truly diverges from its own baseline B",
  );
  assert.equal(projectedAfterC[0]?.attention.state, "none");
  assert.equal(state.get("session-1")?.has("operation-1"), true);

  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 9);
  assert.equal(
    applyChatAttentionProjections(
      state,
      [row({ attention: canonicalA })],
      9,
      chatAttentionProjectionScopeKey("nova"),
    )[0]?.attention.state,
    "none",
  );
  assert.equal(state.get("session-1")?.has("operation-1"), true);

  const finalProjected = applyChatAttentionProjections(
    state,
    [row({ attention: canonicalC })],
    9,
    chatAttentionProjectionScopeKey("nova"),
  );
  assert.equal(finalProjected[0]?.attention.state, "awaiting-human");
  assert.equal(state.has("session-1"), false);
});

test("a duplicate clear for an overlapping operation keeps its already-captured baseline", () => {
  const state = createChatAttentionProjectionState();
  const canonicalA = NEEDS_ATTENTION;
  const canonicalB = {
    state: "awaiting-human" as const,
    since: "2026-08-05T00:10:00.000Z",
    reason: "approval" as const,
  };

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    canonicalA,
  );
  applyChatAttentionProjections(
    state,
    [row({ attention: canonicalB })],
    5,
    chatAttentionProjectionScopeKey("nova"),
  );
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.deepEqual(state.get("session-1")?.get("operation-2")?.baseline, canonicalB);

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    canonicalA,
  );
  assert.deepEqual(state.get("session-1")?.get("operation-2")?.baseline, canonicalB);
  assert.equal(state.get("session-1")?.get("operation-2")?.status, "pending");
});

test("releasing the last operation forgets the tracked canonical baseline for that session", () => {
  const state = createChatAttentionProjectionState();
  const canonicalB = {
    state: "awaiting-human" as const,
    since: "2026-08-05T00:10:00.000Z",
    reason: "approval" as const,
  };

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  applyChatAttentionProjections(
    state,
    [row({ attention: canonicalB })],
    5,
    chatAttentionProjectionScopeKey("nova"),
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    NO_CHAT_ATTENTION,
  );
  assert.equal(state.has("session-1"), false);
});
