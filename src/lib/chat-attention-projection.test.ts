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

test("an accepted canonical baseline outranks stale overlapping event evidence", () => {
  const state = createChatAttentionProjectionState();
  const staleEventBaseline = {
    state: "awaiting-human" as const,
    since: "2026-08-05T00:00:00.000Z",
    reason: "input" as const,
  };
  const acceptedCanonical = {
    state: "awaiting-human" as const,
    since: "2026-08-05T00:05:00.000Z",
    reason: "approval" as const,
  };

  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    staleEventBaseline,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  const acceptedRows = [row({ attention: acceptedCanonical })];
  assert.equal(
    applyChatAttentionProjections(state, acceptedRows, 6, chatAttentionProjectionScopeKey("nova")),
    acceptedRows,
  );

  const overlapped = recordChatAttentionClear(
    state,
    "session-1",
    "operation-2",
    chatAttentionProjectionScopeKey("nova"),
    staleEventBaseline,
  );
  assert.deepEqual(overlapped, { recorded: true, reason: "recorded" });
  assert.deepEqual(
    state.get("session-1")?.get("operation-2")?.baseline,
    acceptedCanonical,
    "the last accepted canonical row must beat stale event-carried fallback evidence",
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

test("filtered list absence cannot release pending or persisted clears", () => {
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
  assert.equal(state.has("session-1"), true);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 11, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);
});

test("repeated clears survive absent rows until explicit canonical evidence arrives", () => {
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

test("an unknown-baseline clear survives an empty same-scope poll and releases on failed settlement", () => {
  const state = createChatAttentionProjectionState();
  assert.deepEqual(
    recordChatAttentionClear(
      state,
      "session-1",
      "operation-1",
      chatAttentionProjectionScopeKey("nova"),
      undefined,
    ),
    { recorded: true, reason: "recorded" },
  );

  applyChatAttentionProjections(state, [], 5, chatAttentionProjectionScopeKey("nova"));
  assert.equal(state.get("session-1")?.get("operation-1")?.status, "pending");

  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 6);
  assert.equal(state.has("session-1"), false);
});

test("a no-baseline rejection tombstones the operation id so a late replay cannot recreate an un-settleable projection", () => {
  const state = createChatAttentionProjectionState();
  assert.deepEqual(
    recordChatAttentionClear(
      state,
      "session-1",
      "operation-1",
      chatAttentionProjectionScopeKey("nova"),
      NO_CHAT_ATTENTION,
    ),
    { recorded: false, reason: "no-baseline" },
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);
  const replay = recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    undefined,
    "2026-08-05T00:01:00.000Z",
  );
  assert.deepEqual(replay, { recorded: false, reason: "tombstoned" });
  assert.equal(state.has("session-1"), false);
});

test("a cached canonical none plus a valid watermark records an unknown-baseline clear instead of rejecting it", () => {
  const state = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");
  assert.deepEqual(
    recordChatAttentionClear(
      state,
      "session-1",
      "operation-1",
      scopeKey,
      NO_CHAT_ATTENTION,
      "2026-08-05T00:01:00.000Z",
    ),
    { recorded: true, reason: "recorded" },
  );
  assert.equal(state.get("session-1")?.get("operation-1")?.baseline, null);

  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 6);
  assert.equal(state.has("session-1"), false);
  assert.equal(
    applyChatAttentionProjections(
      state,
      [row({ attention: { state: "awaiting-human", since: "2026-08-05T00:00:59.999Z", reason: "approval" } })],
      7,
      scopeKey,
    )[0]?.attention.state,
    "awaiting-human",
    "failed watermark-backed clears must release immediately instead of staying masked",
  );
});

test("an unknown settlement does not poison a later legitimate first clear for the same session", () => {
  const state = createChatAttentionProjectionState();
  settleChatAttentionClear(state, "session-1", "operation-unknown", "persisted", 6);
  assert.deepEqual(
    recordChatAttentionClear(
      state,
      "session-1",
      "operation-1",
      chatAttentionProjectionScopeKey("nova"),
      NEEDS_ATTENTION,
    ),
    { recorded: true, reason: "recorded" },
  );
  assert.deepEqual(state.get("session-1")?.get("operation-1")?.baseline, NEEDS_ATTENTION);
});

test("an evidence-free persisted compatibility clear retires on the first eligible canonical row even when attention repeats", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    undefined,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const staleCanonical = [row({ attention: { ...NEEDS_ATTENTION } })];
  assert.equal(
    applyChatAttentionProjections(state, staleCanonical, 5, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
    "responses older than the settlement boundary must keep the projection active",
  );
  assert.equal(state.has("session-1"), true);

  assert.equal(
    applyChatAttentionProjections(state, staleCanonical, 6, chatAttentionProjectionScopeKey("nova")),
    staleCanonical,
    "the first eligible canonical row should win immediately instead of being masked indefinitely",
  );
  assert.equal(state.has("session-1"), false);
});

test("an evidence-free persisted compatibility clear also retires on the first eligible canonical none", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    undefined,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, chatAttentionProjectionScopeKey("nova")),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);
});

test("an unknown-baseline persisted clear with a watermark releases when the first canonical row is already newer attention", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    undefined,
    "2026-08-05T00:01:00.000Z",
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const newerRequest = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:01:00.000Z", reason: "approval" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, newerRequest, 6, chatAttentionProjectionScopeKey("nova")),
    newerRequest,
  );
  assert.equal(state.has("session-1"), false);
});

test("an unknown-baseline persisted clear with a watermark keeps the first stale row masked until newer attention appears", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    undefined,
    "2026-08-05T00:02:00.000Z",
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const staleCanonical = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:01:59.999Z", reason: "approval" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, staleCanonical, 6, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.has("session-1"), true);

  const newerRequest = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:02:00.001Z", reason: "approval" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, newerRequest, 7, chatAttentionProjectionScopeKey("nova")),
    newerRequest,
  );
  assert.equal(state.has("session-1"), false);
});

test("a cached canonical none plus a valid watermark keeps stale canonical attention masked until newer evidence arrives", () => {
  const state = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    scopeKey,
    NO_CHAT_ATTENTION,
    "2026-08-05T00:02:00.000Z",
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const staleCanonical = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:01:59.999Z", reason: "approval" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, staleCanonical, 6, scopeKey)[0]?.attention.state,
    "none",
  );
  assert.equal(state.has("session-1"), true);

  const newerCanonical = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:02:00.001Z", reason: "approval" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, newerCanonical, 7, scopeKey),
    newerCanonical,
  );
  assert.equal(state.has("session-1"), false);
});

test("a cached canonical none plus a valid watermark retires on the first eligible canonical none", () => {
  const state = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    scopeKey,
    NO_CHAT_ATTENTION,
    "2026-08-05T00:03:00.000Z",
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, scopeKey),
    canonicalNone,
  );
  assert.equal(state.has("session-1"), false);
});

test("an unknown-baseline persisted clear with a watermark treats equal timestamps as newer evidence", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    undefined,
    "2026-08-05T00:03:00.000Z",
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  const boundaryRequest = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:03:00.000Z", reason: "decision" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, boundaryRequest, 6, chatAttentionProjectionScopeKey("nova")),
    boundaryRequest,
  );
  assert.equal(state.has("session-1"), false);
});

test("an unknown-baseline persisted clear with a watermark stays conservative on malformed first evidence but later valid evidence releases it", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    undefined,
    "2026-08-05T00:04:00.000Z",
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  assert.equal(
    applyChatAttentionProjections(state, [row({
      attention: { state: "awaiting-human", since: "not-an-iso", reason: "approval" },
    })], 6, chatAttentionProjectionScopeKey("nova"))[0]?.attention.state,
    "none",
  );
  assert.equal(state.has("session-1"), true);

  const validNewerRequest = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T00:04:30.000Z", reason: "approval" },
  })];
  assert.equal(
    applyChatAttentionProjections(state, validNewerRequest, 7, chatAttentionProjectionScopeKey("nova")),
    validNewerRequest,
  );
  assert.equal(state.has("session-1"), false);
});

test("an unknown-baseline off-list clear survives filtered list absence", () => {
  const state = createChatAttentionProjectionState();
  recordChatAttentionClear(
    state,
    "session-1",
    "operation-1",
    chatAttentionProjectionScopeKey("nova"),
    undefined,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "persisted", 6);

  applyChatAttentionProjections(state, [], 7, chatAttentionProjectionScopeKey("sage"));
  assert.equal(state.has("session-1"), true);
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

test("canonical none during a pending clear preserves the real baseline for an immediate retry after failure", () => {
  const state = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");
  recordChatAttentionClear(state, "session-1", "operation-1", scopeKey, NEEDS_ATTENTION);

  const canonicalNone = [row({ attention: NO_CHAT_ATTENTION })];
  assert.equal(
    applyChatAttentionProjections(state, canonicalNone, 6, scopeKey),
    canonicalNone,
  );
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 7);

  recordChatAttentionClear(state, "session-1", "operation-2", scopeKey, undefined);
  assert.deepEqual(state.get("session-1")?.get("operation-2")?.baseline, NEEDS_ATTENTION);
  assert.equal(
    applyChatAttentionProjections(state, [row()], 8, scopeKey)[0]?.attention.state,
    "none",
  );
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

test("a canonical none retires the tracked baseline instead of occupying it, so a later clear's real baseline is still tracked", () => {
  const state = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");
  const NEEDS_ATTENTION_B = {
    state: "awaiting-human" as const,
    since: "2026-08-05T00:20:00.000Z",
    reason: "approval" as const,
  };

  // Prime the tracker with a real baseline, then exhaust it with a failed
  // clear so only the tracked fallback survives.
  recordChatAttentionClear(state, "session-1", "operation-1", scopeKey, NEEDS_ATTENTION);
  settleChatAttentionClear(state, "session-1", "operation-1", "failed", 5);

  // Canonical attention genuinely resolves to "none" through some other
  // path (not this failed clear). That must retire the tracked baseline
  // outright rather than retaining "none" itself as if it were still
  // usable retry evidence.
  applyChatAttentionProjections(state, [row({ attention: NO_CHAT_ATTENTION })], 6, scopeKey);

  // Fresh, genuinely new attention now needs a clear; the caller supplies
  // its own known-good canonical snapshot directly, so this clear must
  // record correctly and — critically — must be free to persist that new
  // baseline into the tracker, not find the slot still occupied by the
  // retired "none".
  recordChatAttentionClear(state, "session-1", "operation-2", scopeKey, NEEDS_ATTENTION_B);
  assert.deepEqual(state.get("session-1")?.get("operation-2")?.baseline, NEEDS_ATTENTION_B);
  settleChatAttentionClear(state, "session-1", "operation-2", "failed", 7);

  // An immediate retry with no fresh canonical evidence of its own must now
  // inherit that real tracked baseline, not fall back to an unknown
  // baseline because a stale "none" entry blocked it from ever being
  // recorded.
  recordChatAttentionClear(state, "session-1", "operation-3", scopeKey, undefined);
  assert.deepEqual(state.get("session-1")?.get("operation-3")?.baseline, NEEDS_ATTENTION_B);
});

test("filtered list absence never consumes a failed clear retry baseline", () => {
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
  assert.deepEqual(state.get("session-1")?.get("operation-3")?.baseline, NEEDS_ATTENTION);
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

test("per-session operation bound evicts to exactly 64, tombstones the oldest for replay safety, and leaves live projection intact", () => {
  const state = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");

  // Fill the session to the 64-operation limit; no eviction should occur yet.
  for (let i = 1; i <= 64; i++) {
    const result = recordChatAttentionClear(state, "session-1", `op-${i}`, scopeKey, NEEDS_ATTENTION);
    assert.equal(result.reason, "recorded");
  }
  assert.equal(state.get("session-1")?.size, 64, "64 ops must fit without eviction");

  // Recording op-65 exceeds the limit; the oldest (op-1, all others pending) is evicted and tombstoned.
  recordChatAttentionClear(state, "session-1", "op-65", scopeKey, NEEDS_ATTENTION);
  assert.equal(state.get("session-1")?.size, 64, "session must remain at 64 after op-65");
  assert.equal(state.get("session-1")?.has("op-1"), false, "op-1 must be evicted from live operations");
  assert.equal(state.get("session-1")?.has("op-65"), true, "op-65 (newest) must survive");

  // A late replay of the evicted op is rejected as tombstoned — replay-safe.
  const replay = recordChatAttentionClear(state, "session-1", "op-1", scopeKey, NEEDS_ATTENTION);
  assert.equal(replay.recorded, false);
  assert.equal(replay.reason, "tombstoned");
  assert.equal(state.get("session-1")?.size, 64, "replay must not grow the session beyond the bound");

  // Live projection is correct: the 64 surviving pending ops still mask attention to none.
  const projected = applyChatAttentionProjections(state, [row()], 99, scopeKey);
  assert.equal(projected[0]?.attention.state, "none");

  for (let i = 2; i <= 65; i++) {
    settleChatAttentionClear(state, "session-1", `op-${i}`, "persisted", 100);
  }
  const newerAttention = [row({
    attention: { state: "awaiting-human", since: "2026-08-05T01:00:00.000Z", reason: "decision" },
  })];
  assert.equal(applyChatAttentionProjections(state, newerAttention, 100, scopeKey), newerAttention);
  assert.equal(state.has("session-1"), false, "fresh canonical evidence releases the bounded live state");
});

test("per-session operation eviction prefers oldest settled operation over oldest pending", () => {
  const state = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");

  // Fill to the 64-op limit — all pending.
  for (let i = 1; i <= 64; i++) {
    recordChatAttentionClear(state, "session-1", `op-${i}`, scopeKey, NEEDS_ATTENTION);
  }
  // Settle op-5 (not the oldest); it becomes the oldest non-pending in insertion order.
  settleChatAttentionClear(state, "session-1", "op-5", "persisted", 1);
  assert.equal(state.get("session-1")?.get("op-5")?.status, "persisted");

  // Recording op-65 should evict op-5 (oldest settled), not op-1 (oldest pending).
  recordChatAttentionClear(state, "session-1", "op-65", scopeKey, NEEDS_ATTENTION);
  assert.equal(state.get("session-1")?.size, 64);
  assert.equal(state.get("session-1")?.has("op-5"), false, "settled op-5 must be evicted first");
  assert.equal(state.get("session-1")?.has("op-1"), true, "pending op-1 must survive when a settled op was available");
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
