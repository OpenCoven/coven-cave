import assert from "node:assert/strict";
import test from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import type { ChatAttention } from "./chat-attention.ts";
import {
  CHAT_ATTENTION_CLEAR_EVENT,
  attentionClearFromEvent,
  attentionClearedSessionId,
} from "./chat-attention-events.ts";
import {
  applyChatAttentionProjections,
  CHAT_ATTENTION_UNPROVEN_SCOPE,
  chatAttentionProjectionScopeKey,
  clearSessionAttentionRows,
  createChatAttentionProjectionState,
  recordChatAttentionClear,
  settleChatAttentionClear,
} from "./chat-attention-projection.ts";
import type { SessionRow } from "./types.ts";

function row(id: string, overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    project_root: `/repo/${id}`,
    harness: "claude",
    title: `Chat ${id}`,
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
    attention: {
      state: "awaiting-human",
      since: "2026-08-05T00:00:00.000Z",
      reason: "approval",
    },
    ...overrides,
  };
}

function omitAttention(session: SessionRow): Omit<SessionRow, "attention"> {
  const { attention: _attention, ...rest } = session;
  return rest;
}

test("session-only attention clears target one row without creating projection state", () => {
  const projectionState = createChatAttentionProjectionState();
  const baseSessions = [
    row("session-1", { title: "Approve release" }),
    row("session-2", {
      title: "Leave untouched",
      attention: {
        state: "left-hanging",
        since: "2026-08-04T23:00:00.000Z",
        reason: null,
      },
    }),
  ];
  const renderedSessions = [
    row("session-1", { title: "Approve release", updated_at: "2026-08-05T00:01:00.000Z" }),
    row("session-2", {
      title: "Leave untouched",
      attention: {
        state: "left-hanging",
        since: "2026-08-04T23:00:00.000Z",
        reason: null,
      },
      updated_at: "2026-08-05T00:02:00.000Z",
    }),
  ];

  const legacyClear = new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: " session-1 " },
  });
  assert.equal(attentionClearFromEvent(legacyClear), null);
  const sessionId = attentionClearedSessionId(legacyClear);
  assert.equal(sessionId, "session-1");

  const nextBaseSessions = clearSessionAttentionRows(baseSessions, sessionId!);
  const nextRenderedSessions = clearSessionAttentionRows(renderedSessions, sessionId!);

  assert.equal(projectionState.size, 0, "session-only compatibility must not invent projection state");
  assert.notEqual(nextBaseSessions, baseSessions);
  assert.notEqual(nextRenderedSessions, renderedSessions);
  assert.deepEqual(nextBaseSessions[0]?.attention, NO_CHAT_ATTENTION);
  assert.deepEqual(nextRenderedSessions[0]?.attention, NO_CHAT_ATTENTION);
  assert.deepEqual(omitAttention(nextBaseSessions[0]!), omitAttention(baseSessions[0]!));
  assert.deepEqual(omitAttention(nextRenderedSessions[0]!), omitAttention(renderedSessions[0]!));
  assert.equal(nextBaseSessions[1], baseSessions[1], "non-target base rows must keep identity");
  assert.equal(nextRenderedSessions[1], renderedSessions[1], "non-target rendered rows must keep identity");
});

test("operation-aware attention clears still record durable projection state", () => {
  const projectionState = createChatAttentionProjectionState();
  const baseSessions = [row("session-1")];
  const clear = new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-1", operationId: "run-1" },
  });
  const detail = attentionClearFromEvent(clear);
  assert.deepEqual(detail, { sessionId: "session-1", operationId: "run-1" });
  assert.equal(
    attentionClearedSessionId(clear),
    null,
    "operation-aware payloads must not also take the legacy one-shot path",
  );

  const recordResult = recordChatAttentionClear(
    projectionState,
    detail!.sessionId,
    detail!.operationId,
    chatAttentionProjectionScopeKey("nova"),
    baseSessions[0]?.attention ?? NO_CHAT_ATTENTION,
  );

  assert.deepEqual(recordResult, { recorded: true, reason: "recorded" });
  assert.equal(projectionState.get("session-1")?.get("run-1")?.status, "pending");
});

test("invalid attention-clear payloads remain full no-ops", () => {
  const projectionState = createChatAttentionProjectionState();
  const invalidClear = new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "   ", operationId: null },
  });
  assert.equal(attentionClearFromEvent(invalidClear), null);
  assert.equal(attentionClearedSessionId(invalidClear), null);
  assert.equal(projectionState.size, 0);
});

test("legacy one-shot compatibility rejects session-only payloads that also mention modern fields", () => {
  const legacyLookingButModern = new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: {
      sessionId: "session-1",
      baselineAttention: { state: "none", since: undefined, reason: null },
    },
  });
  assert.equal(attentionClearFromEvent(legacyLookingButModern), null);
  assert.equal(attentionClearedSessionId(legacyLookingButModern), null);
});

test("an accepted canonical row wins over a stale event-carried baseline (clear-time precedence race)", () => {
  // Mirrors workspace.tsx's onChatAttentionClear precedence (regex-pinned in
  // chat-sidebar-wiring.test.ts): Workspace's own accepted /api/sessions/list
  // row already sitting in baseSessionsRef is fresher authority than whatever
  // baseline the clearing ChatView captured at emit time. Race: an accepted
  // poll resolves real attention B ("awaiting-human") for session-1 into
  // baseSessionsRef; a moment later a clear event for session-1 arrives whose
  // payload still carries a stale pre-poll snapshot A ("none", captured
  // before ChatView ever learned about B).
  const projectionState = createChatAttentionProjectionState();
  const acceptedCanonicalB: ChatAttention = {
    state: "awaiting-human",
    since: "2026-08-05T00:00:00.000Z",
    reason: "approval",
  };
  const baseSessions = [row("session-1", { attention: acceptedCanonicalB })];
  const staleEventBaselineA: ChatAttention = NO_CHAT_ATTENTION;

  function resolveClearBaseline(sessionId: string, eventBaseline: ChatAttention | null | undefined) {
    const acceptedRow = baseSessions.find((session) => session.id === sessionId);
    const acceptedCanonical = acceptedRow && acceptedRow.attention.state !== "none"
      ? acceptedRow.attention
      : null;
    return acceptedCanonical ?? eventBaseline ?? acceptedRow?.attention;
  }

  const baseline = resolveClearBaseline("session-1", staleEventBaselineA);
  assert.deepEqual(baseline, acceptedCanonicalB, "the accepted non-none row must win over the stale none event baseline");

  const recordResult = recordChatAttentionClear(
    projectionState,
    "session-1",
    "run-1",
    chatAttentionProjectionScopeKey("nova"),
    baseline,
  );
  assert.deepEqual(recordResult, { recorded: true, reason: "recorded" });
  assert.deepEqual(
    projectionState.get("session-1")?.get("run-1")?.baseline,
    acceptedCanonicalB,
    "the recorded operation baseline must be B, not the stale none event payload",
  );

  // "...and projects correctly": once persisted, a canonical response still
  // showing exactly B (the server hasn't caught up with the clear yet) must
  // keep masking it — a wrong (none/null) baseline would instead have treated
  // any non-none row as unconditionally new and released immediately.
  settleChatAttentionClear(projectionState, "session-1", "run-1", "persisted", 1);
  const stillMasked = applyChatAttentionProjections(
    projectionState,
    [row("session-1", { attention: acceptedCanonicalB })],
    2,
    chatAttentionProjectionScopeKey("nova"),
  );
  assert.deepEqual(stillMasked[0]?.attention, NO_CHAT_ATTENTION, "an unchanged canonical row must stay masked against the correct B baseline");

  // A genuinely new request (different since) proves progress and releases.
  const released = applyChatAttentionProjections(
    projectionState,
    [row("session-1", {
      attention: { state: "awaiting-human", since: "2026-08-05T01:00:00.000Z", reason: "approval" },
    })],
    3,
    chatAttentionProjectionScopeKey("nova"),
  );
  assert.deepEqual(
    released[0]?.attention,
    { state: "awaiting-human", since: "2026-08-05T01:00:00.000Z", reason: "approval" },
    "a genuinely new request must surface once it diverges from the correctly-recorded B baseline",
  );
});

test("a cached row keeps the scope of the accepted request rather than its familiar identity", () => {
  const projectionState = createChatAttentionProjectionState();
  const novaAttention: ChatAttention = {
    state: "awaiting-human",
    since: "2026-08-05T00:00:00.000Z",
    reason: "approval",
  };
  const acceptedNovaRow = row("session-nova-1", {
    familiarId: "nova",
    attention: novaAttention,
  });
  const capturedScopeKey = chatAttentionProjectionScopeKey(null);
  const acceptedScopeKeyBySessionId = new Map<string, string>([
    ["session-nova-1", capturedScopeKey],
  ]);
  const sageScopeKey = chatAttentionProjectionScopeKey("sage");
  const novaScopeKey = chatAttentionProjectionScopeKey("nova");

  const acceptedCanonical = acceptedNovaRow.attention.state !== "none" ? acceptedNovaRow.attention : null;
  const recordedScopeKey = acceptedScopeKeyBySessionId.get("session-nova-1") ?? CHAT_ATTENTION_UNPROVEN_SCOPE;
  assert.equal(
    recordedScopeKey,
    capturedScopeKey,
    "the accepted all-familiars request scope must beat the row's Nova identity",
  );

  const recordResult = recordChatAttentionClear(
    projectionState,
    "session-nova-1",
    "run-2",
    recordedScopeKey,
    acceptedCanonical,
  );
  assert.deepEqual(recordResult, { recorded: true, reason: "recorded" });
  settleChatAttentionClear(projectionState, "session-nova-1", "run-2", "persisted", 1);

  applyChatAttentionProjections(projectionState, [], 2, sageScopeKey);
  assert.equal(
    projectionState.has("session-nova-1"),
    true,
    "an empty response from any filtered list must not retire the clear",
  );

  const staleNovaResponse = applyChatAttentionProjections(
    projectionState,
    [row("session-nova-1", { familiarId: "nova", attention: novaAttention })],
    3,
    novaScopeKey,
  );
  assert.deepEqual(
    staleNovaResponse[0]?.attention,
    NO_CHAT_ATTENTION,
    "the correctly scoped Nova response should still mask the unchanged canonical baseline",
  );
  assert.equal(projectionState.has("session-nova-1"), true);

  const releasedNovaResponse = applyChatAttentionProjections(
    projectionState,
    [row("session-nova-1", {
      familiarId: "nova",
      attention: {
        state: "awaiting-human",
        since: "2026-08-05T01:00:00.000Z",
        reason: "approval",
      },
    })],
    4,
    novaScopeKey,
  );
  assert.deepEqual(
    releasedNovaResponse[0]?.attention,
    {
      state: "awaiting-human",
      since: "2026-08-05T01:00:00.000Z",
      reason: "approval",
    },
    "a correctly scoped Nova response carrying newer canonical evidence must release the projection",
  );
  assert.equal(projectionState.has("session-nova-1"), false);
});

console.log("workspace-chat-attention-compat.test.ts: ok");
