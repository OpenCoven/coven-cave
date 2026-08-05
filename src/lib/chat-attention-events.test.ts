import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_ATTENTION_CLEAR_EVENT,
  CHAT_ATTENTION_SETTLE_EVENT,
  attentionClearFromEvent,
  attentionClearedSessionId,
  attentionSettlementFromEvent,
  emitChatAttentionClear,
  emitChatAttentionSettlement,
} from "./chat-attention-events.ts";
import {
  type ChatAttention,
} from "./chat-attention.ts";
import {
  applyChatAttentionProjections,
  chatAttentionProjectionScopeKey,
  createChatAttentionProjectionState,
  recordChatAttentionClear,
  settleChatAttentionClear,
} from "./chat-attention-projection.ts";
import {
  createAdoptedAttentionSettlementRegistry,
  createChatAttentionSettlementTracker,
  createChatAttentionAdoptionTracker,
  createExternallySettledGenerationRegistry,
} from "./chat-attention-lifecycle.ts";

async function withMockWindow(run: (dispatched: Event[]) => void | Promise<void>) {
  const dispatched: Event[] = [];
  const mockWindow = {
    dispatchEvent(event: Event) {
      dispatched.push(event);
      return true;
    },
  };
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  (globalThis as { window?: unknown }).window = mockWindow;
  try {
    await run(dispatched);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
}

test("validates session-scoped clear and settlement events", () => {
  assert.equal(CHAT_ATTENTION_CLEAR_EVENT, "cave:chat-attention-clear");
  assert.equal(CHAT_ATTENTION_SETTLE_EVENT, "cave:chat-attention-settle");
  const legacyClear = new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: " session-0 " },
  });
  assert.equal(attentionClearedSessionId(legacyClear), "session-0");
  assert.equal(attentionClearFromEvent(legacyClear), null);
  assert.deepEqual(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-1", operationId: "run-1" },
  })), { sessionId: "session-1", operationId: "run-1" });
  assert.deepEqual(attentionSettlementFromEvent(new CustomEvent(CHAT_ATTENTION_SETTLE_EVENT, {
    detail: { sessionId: " session-2 ", operationId: " run-2 ", outcome: "failed" },
  })), { sessionId: "session-2", operationId: "run-2", outcome: "failed" });
});

test("preserves optional scope and baseline attention evidence on clear events", () => {
  assert.deepEqual(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: {
      sessionId: " session-3 ",
      operationId: " run-3 ",
      clearWatermark: " 2026-08-05T00:00:00.000Z ",
      scopeKey: " familiar:nova ",
      baselineAttention: {
        state: "awaiting-human",
        since: "2026-08-05T00:00:00.000Z",
        reason: "approval",
      },
    },
  })), {
    sessionId: "session-3",
    operationId: "run-3",
    clearWatermark: "2026-08-05T00:00:00.000Z",
    scopeKey: "familiar:nova",
    baselineAttention: {
      state: "awaiting-human",
      since: "2026-08-05T00:00:00.000Z",
      reason: "approval",
    },
  });
});

function clearWithBaseline(baselineAttention: unknown) {
  return attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-3", operationId: "run-3", baselineAttention },
  }));
}

test("accepts every canonical BaselineAttention combo", () => {
  assert.deepEqual(clearWithBaseline({ state: "none", since: null, reason: null }), {
    sessionId: "session-3",
    operationId: "run-3",
    baselineAttention: { state: "none", since: null, reason: null },
  });
  assert.deepEqual(clearWithBaseline({
    state: "left-hanging",
    since: "2026-08-05T00:00:00.000Z",
    reason: null,
  }), {
    sessionId: "session-3",
    operationId: "run-3",
    baselineAttention: { state: "left-hanging", since: "2026-08-05T00:00:00.000Z", reason: null },
  });
  for (const state of ["awaiting-human", "overdue-human"] as const) {
    for (const reason of ["input", "approval", "credentials", "decision"] as const) {
      assert.deepEqual(clearWithBaseline({ state, since: "2026-08-05T00:00:00.000Z", reason }), {
        sessionId: "session-3",
        operationId: "run-3",
        baselineAttention: { state, since: "2026-08-05T00:00:00.000Z", reason },
      });
    }
  }
});

test("rejects impossible BaselineAttention combos and non-canonical timestamps", () => {
  // Malformed baseline evidence must not invalidate the whole clear event —
  // it is dropped like a malformed clearWatermark/scopeKey, leaving a valid
  // event with no baselineAttention field, never a fabricated snapshot.
  function rejectsBaseline(baselineAttention: unknown) {
    assert.deepEqual(clearWithBaseline(baselineAttention), { sessionId: "session-3", operationId: "run-3" });
  }
  // "none" must carry neither a timestamp nor a reason.
  rejectsBaseline({ state: "none", since: "2026-08-05T00:00:00.000Z", reason: null });
  rejectsBaseline({ state: "none", since: null, reason: "approval" });
  // "left-hanging" requires a canonical since and forbids a reason.
  rejectsBaseline({ state: "left-hanging", since: null, reason: null });
  rejectsBaseline({ state: "left-hanging", since: "not-a-date", reason: null });
  rejectsBaseline({ state: "left-hanging", since: "2026-08-05T00:00:00.000Z", reason: "approval" });
  // "awaiting-human"/"overdue-human" require both a canonical since and a
  // recognized reason — missing, unrecognized, or non-canonical is rejected.
  for (const state of ["awaiting-human", "overdue-human"] as const) {
    rejectsBaseline({ state, since: "2026-08-05T00:00:00.000Z", reason: null });
    rejectsBaseline({ state, since: "2026-08-05T00:00:00.000Z", reason: "not-a-reason" });
    rejectsBaseline({ state, since: null, reason: "approval" });
    rejectsBaseline({ state, since: "not-a-date", reason: "approval" });
    // A non-canonical (non-round-tripping) timestamp string must be rejected
    // even though it parses — canonical-instant reuse, not raw Date.parse.
    rejectsBaseline({ state, since: "2026-08-05T00:00:00Z", reason: "approval" });
  }
  // An unrecognized state is rejected outright.
  rejectsBaseline({ state: "waiting-forever", since: null, reason: null });
});

test("rejects wrong event types and invalid detail payloads", () => {
  assert.equal(attentionClearedSessionId(new Event(CHAT_ATTENTION_CLEAR_EVENT)), null);
  assert.equal(attentionClearFromEvent(new Event(CHAT_ATTENTION_CLEAR_EVENT)), null);
  assert.equal(attentionSettlementFromEvent(new Event(CHAT_ATTENTION_SETTLE_EVENT)), null);
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "   " },
  })), null);
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: 42 },
  })), null);
  assert.equal(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-3" },
  })), null);
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: null,
  })), null);
  assert.equal(attentionSettlementFromEvent(new CustomEvent(CHAT_ATTENTION_SETTLE_EVENT, {
    detail: { sessionId: "session-4", operationId: "run-4", outcome: "weird" },
  })), null);
});

test("rejects non-string and blank/whitespace-only detail fields", () => {
  assert.equal(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: 42, operationId: "run-5" },
  })), null, "a numeric sessionId must not be treated as a valid session id");
  assert.equal(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "   ", operationId: "run-6" },
  })), null, "a whitespace-only sessionId must not be treated as a valid session id");
  assert.equal(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-7", operationId: null },
  })), null, "a non-string operationId must not be treated as a valid operation id");
  assert.equal(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: null,
  })), null, "a missing detail payload must not throw");
});

await test("emits dispatchable clear and settlement events with trimmed ids", async () => {
  await withMockWindow((dispatched) => {
    emitChatAttentionClear(" session-5 ", " run-5 ", {
      clearWatermark: " 2026-08-05T00:00:01.000Z ",
      scopeKey: " familiar:sage ",
      baselineAttention: {
        state: "left-hanging",
        since: "2026-08-04T00:00:00.000Z",
        reason: null,
      },
    });
    emitChatAttentionSettlement(" session-6 ", " run-6 ", "persisted");
    assert.equal(dispatched.length, 2);
    assert.deepEqual(attentionClearFromEvent(dispatched[0]), {
      sessionId: "session-5",
      operationId: "run-5",
      clearWatermark: "2026-08-05T00:00:01.000Z",
      scopeKey: "familiar:sage",
      baselineAttention: {
        state: "left-hanging",
        since: "2026-08-04T00:00:00.000Z",
        reason: null,
      },
    });
    assert.deepEqual(attentionSettlementFromEvent(dispatched[1]), {
      sessionId: "session-6",
      operationId: "run-6",
      outcome: "persisted",
    });
  });

  test("operation-aware events stay backward compatible when the watermark is omitted or malformed", () => {
    assert.deepEqual(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
      detail: { sessionId: "session-10", operationId: "run-10" },
    })), {
      sessionId: "session-10",
      operationId: "run-10",
    });
    assert.deepEqual(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
      detail: { sessionId: "session-11", operationId: "run-11", clearWatermark: "later maybe" },
    })), {
      sessionId: "session-11",
      operationId: "run-11",
    });
  });
});

await test("adopted pending generations clear attention once per session/run and again for a new run", async () => {
  const tracker = createChatAttentionAdoptionTracker();
  await withMockWindow((dispatched) => {
    for (let index = 0; index < 3; index += 1) {
      if (tracker.shouldEmit("session-1", "run-1")) emitChatAttentionClear("session-1", "run-1");
    }
    if (tracker.shouldEmit("session-1", "run-2")) emitChatAttentionClear("session-1", "run-2");
    if (tracker.shouldEmit("session-1", "run-2")) emitChatAttentionClear("session-1", "run-2");
    assert.equal(tracker.shouldEmit("session-1", ""), false, "opening without a live run must not clear attention");
    assert.equal(dispatched.length, 2);
    assert.deepEqual(attentionClearFromEvent(dispatched[0]), {
      sessionId: "session-1",
      operationId: "run-1",
    });
    assert.deepEqual(attentionClearFromEvent(dispatched[1]), {
      sessionId: "session-1",
      operationId: "run-2",
    });
  });
});

await test("a remounted adopter can clear the same pending run once for its own lifecycle", async () => {
  const firstLifecycle = createChatAttentionAdoptionTracker();
  const secondLifecycle = createChatAttentionAdoptionTracker();
  await withMockWindow((dispatched) => {
    if (firstLifecycle.shouldEmit("session-2", "run-9")) emitChatAttentionClear("session-2", "run-9");
    if (firstLifecycle.shouldEmit("session-2", "run-9")) emitChatAttentionClear("session-2", "run-9");
    if (secondLifecycle.shouldEmit("session-2", "run-9")) emitChatAttentionClear("session-2", "run-9");
    assert.equal(dispatched.length, 2);
  });
});

test("external stale-settlement suppression is keyed by controller identity and consumes once", () => {
  const registry = createExternallySettledGenerationRegistry();
  const orphanedController = new AbortController();
  const unrelatedController = new AbortController();

  registry.mark(orphanedController);

  assert.equal(
    registry.consume(unrelatedController),
    false,
    "an unrelated generation must not suppress settlement for this orphan",
  );
  assert.equal(
    registry.consume(orphanedController),
    true,
    "the late owner settlement for the same controller should be suppressed once",
  );
  assert.equal(
    registry.consume(orphanedController),
    false,
    "once consumed, the suppression marker should not affect later generations",
  );
});

function row(attention: ChatAttention) {
  return {
    id: "session-1",
    title: "Session 1",
    harness: "claude",
    status: "idle",
    created_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
    archived_at: null,
    exit_code: null,
    project_root: "/repo",
    attention,
  };
}

await test("brand-new adopted clears settle persisted once and reveal the first genuinely newer attention", async () => {
  const projection = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");
  const adoptedSettlements = createAdoptedAttentionSettlementRegistry();
  const externalSettlements = createExternallySettledGenerationRegistry();
  const controller = new AbortController();
  let canonicalReconciles = 0;
  const tracker = createChatAttentionSettlementTracker({
    operationId: "run-20",
    operationController: controller,
    externalSettlements,
    settleProjection: (sessionId, operationId, outcome) => {
      settleChatAttentionClear(projection, sessionId, operationId, outcome, 6);
      emitChatAttentionSettlement(sessionId, operationId, outcome);
    },
    reconcileCanonicalSessions: () => {
      canonicalReconciles += 1;
    },
  });
  adoptedSettlements.register(controller, tracker);

  await withMockWindow((dispatched) => {
    emitChatAttentionClear("session-1", "run-20", {
      clearWatermark: "2026-08-05T00:01:00.000Z",
      scopeKey,
      baselineAttention: null,
    });
    assert.deepEqual(
      recordChatAttentionClear(
        projection,
        "session-1",
        "run-20",
        scopeKey,
        undefined,
        "2026-08-05T00:01:00.000Z",
      ),
      { recorded: true, reason: "recorded" },
    );
    adoptedSettlements.markAttentionCleared(controller, "session-1");
    tracker.markPersistenceConfirmed();
    tracker.reconcileIfNeeded();
    tracker.reconcileIfNeeded();

    assert.equal(dispatched.filter((event) => event.type === CHAT_ATTENTION_CLEAR_EVENT).length, 1);
    assert.equal(dispatched.filter((event) => event.type === CHAT_ATTENTION_SETTLE_EVENT).length, 1);
    assert.deepEqual(attentionSettlementFromEvent(dispatched[1]), {
      sessionId: "session-1",
      operationId: "run-20",
      outcome: "persisted",
    });
  });

  assert.equal(canonicalReconciles, 1);
  assert.equal(
    applyChatAttentionProjections(projection, [], 6, scopeKey).length,
    0,
    "the adopted clear stays active across the first empty poll until canonical evidence arrives",
  );
  const firstRealAttention = [row({
    state: "awaiting-human",
    since: "2026-08-05T00:01:00.000Z",
    reason: "approval",
  })];
  assert.equal(
    applyChatAttentionProjections(projection, firstRealAttention, 7, scopeKey),
    firstRealAttention,
    "the first canonical attention at-or-after the clear watermark must surface",
  );
  assert.equal(projection.has("session-1"), false);
});

await test("failed adopted clears release their projection and never fabricate persistence", async () => {
  const projection = createChatAttentionProjectionState();
  const scopeKey = chatAttentionProjectionScopeKey("nova");
  const adoptedSettlements = createAdoptedAttentionSettlementRegistry();
  const controller = new AbortController();
  const tracker = createChatAttentionSettlementTracker({
    operationId: "run-21",
    operationController: controller,
    settleProjection: (sessionId, operationId, outcome) => {
      settleChatAttentionClear(projection, sessionId, operationId, outcome, 6);
      emitChatAttentionSettlement(sessionId, operationId, outcome);
    },
    reconcileCanonicalSessions: () => undefined,
  });
  adoptedSettlements.register(controller, tracker);

  await withMockWindow((dispatched) => {
    emitChatAttentionClear("session-1", "run-21", { scopeKey });
    recordChatAttentionClear(projection, "session-1", "run-21", scopeKey, undefined);
    adoptedSettlements.markAttentionCleared(controller, "session-1");
    tracker.reconcileIfNeeded();

    assert.equal(dispatched.filter((event) => event.type === CHAT_ATTENTION_CLEAR_EVENT).length, 1);
    assert.deepEqual(attentionSettlementFromEvent(dispatched[1]), {
      sessionId: "session-1",
      operationId: "run-21",
      outcome: "failed",
    });
  });

  assert.equal(projection.has("session-1"), false);
  const canonicalAttention = [row({
    state: "awaiting-human",
    since: "2026-08-05T00:10:00.000Z",
    reason: "decision",
  })];
  assert.equal(applyChatAttentionProjections(projection, canonicalAttention, 7, scopeKey), canonicalAttention);
});

await test("repeated adoption updates stay deduped while the original owner can safely settle the same clear", async () => {
  const adoption = createChatAttentionAdoptionTracker();
  const adoptedSettlements = createAdoptedAttentionSettlementRegistry();
  const controller = new AbortController();
  const tracker = createChatAttentionSettlementTracker({
    operationId: "run-22",
    operationController: controller,
    settleProjection: (sessionId, operationId, outcome) => {
      emitChatAttentionSettlement(sessionId, operationId, outcome);
    },
    reconcileCanonicalSessions: () => undefined,
  });
  adoptedSettlements.register(controller, tracker);

  await withMockWindow((dispatched) => {
    for (let index = 0; index < 3; index += 1) {
      if (!adoption.shouldEmit("session-1", "run-22")) continue;
      emitChatAttentionClear("session-1", "run-22");
      adoptedSettlements.markAttentionCleared(controller, "session-1");
    }
    tracker.markPersistenceConfirmed();
    tracker.reconcileIfNeeded();
    tracker.reconcileIfNeeded();

    assert.equal(dispatched.filter((event) => event.type === CHAT_ATTENTION_CLEAR_EVENT).length, 1);
    assert.equal(dispatched.filter((event) => event.type === CHAT_ATTENTION_SETTLE_EVENT).length, 1);
  });
});

await test("a lifecycle with no emitted clear does not fabricate settlement", async () => {
  const controller = new AbortController();
  const externalSettlements = createExternallySettledGenerationRegistry();
  let settles = 0;
  let reconciles = 0;
  const tracker = createChatAttentionSettlementTracker({
    operationId: "run-23",
    operationController: controller,
    externalSettlements,
    settleProjection: () => {
      settles += 1;
    },
    reconcileCanonicalSessions: () => {
      reconciles += 1;
    },
  });

  await withMockWindow((dispatched) => {
    tracker.markPersistenceConfirmed();
    tracker.reconcileIfNeeded();
    assert.equal(dispatched.length, 0);
  });

  assert.equal(settles, 0);
  assert.equal(reconciles, 0);
});

await test("does not dispatch invalid attention events", async () => {
  await withMockWindow((dispatched) => {
    emitChatAttentionClear("", "run-7");
    emitChatAttentionClear("session-7", "");
    emitChatAttentionClear(42 as never, "run-7b");
    emitChatAttentionClear("   ", "run-7c");
    emitChatAttentionSettlement("session-8", "run-8", "oops" as never);
    assert.equal(dispatched.length, 0);
  });
});

test("no-ops server-side without a window global", () => {
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  assert.doesNotThrow(() => emitChatAttentionClear("session-9", "run-9"));
  assert.doesNotThrow(() => emitChatAttentionSettlement("session-10", "run-10", "failed"));
});

console.log("chat-attention-events.test.ts: ok");
