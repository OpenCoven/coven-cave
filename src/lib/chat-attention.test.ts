import assert from "node:assert/strict";
import test from "node:test";

import type { SessionRow } from "./types.ts";
import {
  chatAttentionDescription,
  chatAttentionLabel,
  compareChatAttention,
  deriveChatAttention,
  CHAT_ATTENTION_OPERATION_LINEAGE_LIMIT,
  NO_CHAT_ATTENTION,
  normalizeChatAttentionOperationId,
  normalizeChatAttentionOperationLineage,
} from "./chat-attention.ts";

const NOW = Date.parse("2026-08-04T20:00:00.000Z");

test("normalizes only nonempty string attention operation ids", () => {
  assert.equal(normalizeChatAttentionOperationId(" run-1 "), "run-1");
  for (const value of [undefined, null, "", "   ", 42, {}, []]) {
    assert.equal(
      normalizeChatAttentionOperationId(value),
      null,
      `${JSON.stringify(value)} must not become causal attention evidence`,
    );
  }
});

test("normalizes and bounds server-authored attention operation lineage", () => {
  const operations = Array.from(
    { length: CHAT_ATTENTION_OPERATION_LINEAGE_LIMIT + 2 },
    (_, index) => ` operation-${index} `,
  );
  operations.push("operation-2");

  const lineage = normalizeChatAttentionOperationLineage(operations);
  assert.equal(lineage.length, CHAT_ATTENTION_OPERATION_LINEAGE_LIMIT);
  assert.equal(lineage.at(-1), "operation-2", "a repeated operation moves to the newest causal position");
  assert.equal(lineage.includes("operation-0"), false, "the oldest ancestry is discarded");
  assert.deepEqual(normalizeChatAttentionOperationLineage("operation-1"), []);
});

test("derives all four attention states with inclusive boundaries", () => {
  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-03T20:00:00.000Z",
        },
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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

test("clears stale requests for newer user turns, falls back to ordinary left-hanging derivation, and ignores active or archived sessions", () => {
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
        latestUserTurnAt: "2026-08-04T18:00:00.001Z",
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
        latestUserTurnAt: "2026-08-03T17:00:00.000Z",
        request: {
          ...staleRequest,
          requestedAt: "2026-08-03T16:00:00.000Z",
        },
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    {
      state: "left-hanging",
      since: "2026-08-03T18:00:00.000Z",
      reason: null,
    },
  );

  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T19:30:00.000Z",
        },
        latestUserTurnAt: "2026-08-04T19:00:00.000Z",
        request: staleRequest,
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
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-03T18:00:00.000Z",
        },
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: null,
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
        latestUserTurnAt: "not-a-date",
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
        latestUserTurnAt: null,
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

  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-04T18:00:00Z",
        },
        latestUserTurnAt: "2026-08-04T17:00:00.000Z",
        request: {
          sessionId: "s1",
          turnId: "a1",
          requestedAt: "2026-08-04T18:00:00Z",
          reason: "approval",
        },
      },
      status: "completed",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
  );
});

test("treats canonical active waiting status as no attention", () => {
  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-03T18:00:00.000Z",
        },
        latestUserTurnAt: null,
        request: {
          sessionId: "s1",
          turnId: "a1",
          requestedAt: "2026-08-02T20:00:00.000Z",
          reason: "approval",
        },
      },
      status: "waiting",
      archivedAt: null,
      now: NOW,
    }),
    NO_CHAT_ATTENTION,
  );
});

test("treats archived status as no attention even before archivedAt is stamped", () => {
  assert.deepEqual(
    deriveChatAttention({
      evidence: {
        latestCompletedTurn: {
          role: "assistant",
          at: "2026-08-03T18:00:00.000Z",
        },
        latestUserTurnAt: null,
        request: {
          sessionId: "s1",
          turnId: "a1",
          requestedAt: "2026-08-02T20:00:00.000Z",
          reason: "approval",
        },
      },
      status: "archived",
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

test("renders labels and detailed accessible descriptions with state label, reason, and elapsed time", () => {
  assert.equal(chatAttentionLabel("none"), null);
  assert.equal(chatAttentionLabel("left-hanging"), "Left hanging");
  assert.equal(chatAttentionLabel("awaiting-human"), "Awaiting you");
  assert.equal(chatAttentionLabel("overdue-human"), "Still waiting");

  const cases = [
    {
      attention: {
        state: "left-hanging",
        since: "2026-08-03T20:00:00.000Z",
        reason: null,
      } as const,
      expected: "Left hanging since 1 day ago.",
    },
    {
      attention: {
        state: "awaiting-human",
        since: "2026-08-04T19:00:00.000Z",
        reason: "input",
      } as const,
      expected: "Awaiting you for input since 1 hour ago.",
    },
    {
      attention: {
        state: "awaiting-human",
        since: "2026-08-04T19:00:00.000Z",
        reason: "approval",
      } as const,
      expected: "Awaiting you for approval since 1 hour ago.",
    },
    {
      attention: {
        state: "awaiting-human",
        since: "2026-08-04T19:00:00.000Z",
        reason: "credentials",
      } as const,
      expected: "Awaiting you for credentials since 1 hour ago.",
    },
    {
      attention: {
        state: "awaiting-human",
        since: "2026-08-04T19:00:00.000Z",
        reason: "decision",
      } as const,
      expected: "Awaiting you for a decision since 1 hour ago.",
    },
    {
      attention: {
        state: "overdue-human",
        since: "2026-08-02T20:00:00.000Z",
        reason: "input",
      } as const,
      expected: "Still waiting for input since 2 days ago.",
    },
    {
      attention: {
        state: "overdue-human",
        since: "2026-08-02T20:00:00.000Z",
        reason: "approval",
      } as const,
      expected: "Still waiting for approval since 2 days ago.",
    },
    {
      attention: {
        state: "overdue-human",
        since: "2026-08-02T20:00:00.000Z",
        reason: "credentials",
      } as const,
      expected: "Still waiting for credentials since 2 days ago.",
    },
    {
      attention: {
        state: "overdue-human",
        since: "2026-08-02T20:00:00.000Z",
        reason: "decision",
      } as const,
      expected: "Still waiting for a decision since 2 days ago.",
    },
  ];

  for (const { attention, expected } of cases) {
    assert.equal(chatAttentionDescription(attention, NOW), expected);
  }
});
