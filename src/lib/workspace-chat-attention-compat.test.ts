import assert from "node:assert/strict";
import test from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import {
  CHAT_ATTENTION_CLEAR_EVENT,
  attentionClearFromEvent,
  attentionClearedSessionId,
} from "./chat-attention-events.ts";
import {
  chatAttentionProjectionScopeKey,
  clearSessionAttentionRows,
  createChatAttentionProjectionState,
  recordChatAttentionClear,
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
  assert.equal(attentionClearedSessionId(clear), "session-1");

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

console.log("workspace-chat-attention-compat.test.ts: ok");
