import assert from "node:assert/strict";
import test from "node:test";

import type { SessionRow } from "./types.ts";
import {
  chatAttentionDescription,
  chatAttentionLabel,
  compareChatAttention,
  deriveChatAttention,
  NO_CHAT_ATTENTION,
} from "./chat-attention.ts";

const NOW = Date.parse("2026-08-04T20:00:00.000Z");

test("derives all four attention states with inclusive boundaries", () => {
  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-03T20:00:00.000Z",
        },
        request: null,
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "left-hanging",
      since: "2026-08-03T20:00:00.000Z",
      reason: null,
    },
  );

  assert.equal(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-03T20:00:00.001Z",
        },
        request: null,
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }).state,
    "none",
  );

  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T19:59:00.000Z",
        },
        request: {
          sessionId: "s1",
          turnId: "a1",
          requestedAt: "2026-08-03T20:00:00.000Z",
          reason: "approval",
        },
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "awaiting-human",
      since: "2026-08-03T20:00:00.000Z",
      reason: "approval",
    },
  );

  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T19:59:00.000Z",
        },
        request: {
          sessionId: "s1",
          turnId: "a1",
          requestedAt: "2026-08-02T20:00:00.000Z",
          reason: "approval",
        },
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "overdue-human",
      since: "2026-08-02T20:00:00.000Z",
      reason: "approval",
    },
  );

  assert.equal(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T19:59:00.000Z",
        },
        request: {
          sessionId: "s1",
          turnId: "a1",
          requestedAt: "2026-08-02T20:00:00.001Z",
          reason: "approval",
        },
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }).state,
    "awaiting-human",
  );

  assert.deepEqual(NO_CHAT_ATTENTION, {
    state: "none",
    since: null,
    reason: null,
  });
});

test("clears stale requests for newer user turns and active or archived sessions", () => {
  const staleRequest = {
    sessionId: "s1",
    turnId: "a1",
    requestedAt: "2026-08-04T18:00:00.000Z",
    reason: "input" as const,
  };

  assert.equal(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "user",
          at: "2026-08-04T18:00:00.001Z",
        },
        request: staleRequest,
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }).state,
    "none",
  );

  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-03T18:00:00.000Z",
        },
        request: staleRequest,
      },
      status: "running",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
  );

  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-03T18:00:00.000Z",
        },
        request: staleRequest,
      },
      status: "completed",
      archivedAt: "2026-08-04T19:00:00.000Z",
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
  );
});

test("retains valid explicit attention for paused and failed sessions without inventing requests", () => {
  const explicit = {
    sessionId: "s1",
    turnId: "a1",
    requestedAt: "2026-08-04T18:00:00.000Z",
    reason: "credentials" as const,
  };

  assert.equal(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T18:00:00.000Z",
        },
        request: explicit,
      },
      status: "paused",
      archivedAt: null,
      now: NOW,
    }).state,
    "awaiting-human",
  );

  assert.equal(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T18:00:00.000Z",
        },
        request: explicit,
      },
      status: "failed",
      archivedAt: null,
      now: NOW,
    }).state,
    "awaiting-human",
  );

  assert.equal(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T18:00:00.000Z",
        },
        request: null,
      },
      status: "paused",
      archivedAt: null,
      now: NOW,
    }).state,
    "none",
  );
});

test("fails quiet for malformed evidence", () => {
  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "not-a-date",
        },
        request: null,
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
  );

  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: null,
        request: {
          sessionId: "s1",
          turnId: "a1",
          requestedAt: "not-a-date",
          reason: "input",
        },
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
  );

  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: null,
        request: {
          sessionId: "s1",
          turnId: "a1",
          requestedAt: "2026-08-04T18:00:00.000Z",
          reason: "urgent" as "input",
        },
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
  );
});

test("orders attention rows by urgency and oldest first within a tier", () => {
  const rows: Array<Pick<SessionRow, "attention"> & { id: string }> = [
    { id: "left-newer", attention: { state: "left-hanging", since: "2026-08-04T18:00:00.000Z", reason: null } },
    { id: "awaiting-newer", attention: { state: "awaiting-human", since: "2026-08-04T17:00:00.000Z", reason: "input" as const } },
    { id: "overdue-newer", attention: { state: "overdue-human", since: "2026-08-03T18:00:00.000Z", reason: "decision" as const } },
    { id: "left-older", attention: { state: "left-hanging", since: "2026-08-03T18:00:00.000Z", reason: null } },
    { id: "awaiting-older", attention: { state: "awaiting-human", since: "2026-08-03T17:00:00.000Z", reason: "approval" as const } },
    { id: "overdue-older", attention: { state: "overdue-human", since: "2026-08-02T18:00:00.000Z", reason: "credentials" as const } },
    { id: "none", attention: NO_CHAT_ATTENTION },
  ];

  rows.sort(compareChatAttention);

  assert.deepEqual(rows.map((row) => row.id), [
    "overdue-older",
    "overdue-newer",
    "awaiting-older",
    "awaiting-newer",
    "left-older",
    "left-newer",
    "none",
  ]);
});

test("renders labels and accessible descriptions with state, reason, and elapsed time", () => {
  assert.equal(chatAttentionLabel("none"), null);
  assert.equal(chatAttentionLabel("left-hanging"), "Left hanging");
  assert.equal(chatAttentionLabel("awaiting-human"), "Awaiting you");
  assert.equal(chatAttentionLabel("overdue-human"), "Still waiting");

  assert.equal(
    chatAttentionDescription(
      {
        state: "left-hanging",
        since: "2026-08-03T20:00:00.000Z",
        reason: null,
      },
      NOW,
    ),
    "Left hanging since 1 day ago.",
  );

  assert.equal(
    chatAttentionDescription(
      {
        state: "awaiting-human",
        since: "2026-08-04T19:00:00.000Z",
        reason: "approval",
      },
      NOW,
    ),
    "Awaiting you for approval since 1 hour ago.",
  );

  assert.equal(
    chatAttentionDescription(
      {
        state: "overdue-human",
        since: "2026-08-02T20:00:00.000Z",
        reason: "decision",
      },
      NOW,
    ),
    "Still waiting for a decision since 2 days ago.",
  );
});
