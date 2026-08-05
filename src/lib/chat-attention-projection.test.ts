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

// ── Offline-queued sends (cave-zs85n Task 5): the offline travel queue's SSE
//    "done" event reports isError:false as soon as the human turn is accepted
//    into the queue (src/app/api/chat/send/route.ts maybeQueueOfflineChat) —
//    long before the queued item is actually flushed and appended to the
//    conversation file. ChatView cannot distinguish that queued acceptance
//    from a real persisted completion at the "done" event, so it settles the
//    same "persisted" outcome either way (chat-sidebar-wiring.test.ts pins
//    that only ev.isError gates markPersistenceConfirmed). Correctness must
//    therefore live here: a "persisted" settlement must not retire the
//    projection just because a poll became eligible — only once the
//    canonical row's attention actually diverges from the baseline captured
//    at clear time does that poll prove the queued turn (or its sync) really
//    landed. Until then the row keeps returning the exact same stale
//    awaiting-human snapshot every poll, since the travel queue hasn't
//    touched the conversation file yet. ──────────────────────────────────
test("an offline-queued send settled persisted before travel sync keeps projecting none across repeated stale canonical polls", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    NEEDS_ATTENTION,
  );
  // The offline-queue "done" event is isError:false, so ChatView settles
  // "persisted" exactly as it would for a real completion — there is no
  // distinct queued outcome at this layer.
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  // Every subsequent poll before the travel queue flushes returns the exact
  // same canonical row: the human turn was only queued, never written to the
  // conversation file, so nothing about the session's attention has changed.
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

  // Two stale polls first, matching the queued-but-unsynced window above.
  applyChatAttentionProjections(state, [row({ attention: { ...NEEDS_ATTENTION } })], 6, chatAttentionProjectionScopeKey("nova"));
  applyChatAttentionProjections(state, [row({ attention: { ...NEEDS_ATTENTION } })], 7, chatAttentionProjectionScopeKey("nova"));
  assert.equal(state.has("session-1"), true);

  // The travel queue flushes: the queued human turn is finally appended to
  // the conversation file, which resolves the outstanding attention request
  // (no new one has been stamped since). This is the first canonical
  // evidence that actually differs from the recorded baseline, so it must
  // retire the projection and surface the true, now-resolved row.
  const syncedCanonical = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, syncedCanonical, 8, chatAttentionProjectionScopeKey("nova")),
    syncedCanonical,
  );
  assert.equal(state.has("session-1"), false);
});
