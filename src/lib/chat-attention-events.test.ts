import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_ATTENTION_CLEAR_EVENT,
  CHAT_ATTENTION_SETTLE_EVENT,
  attentionClearFromEvent,
  attentionSettlementFromEvent,
  emitChatAttentionClear,
  emitChatAttentionSettlement,
} from "./chat-attention-events.ts";
import {
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
  assert.deepEqual(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-1", operationId: "run-1" },
  })), { sessionId: "session-1", operationId: "run-1" });
  assert.deepEqual(attentionSettlementFromEvent(new CustomEvent(CHAT_ATTENTION_SETTLE_EVENT, {
    detail: { sessionId: " session-2 ", operationId: " run-2 ", outcome: "failed" },
  })), { sessionId: "session-2", operationId: "run-2", outcome: "failed" });
});

test("rejects wrong event types and invalid detail payloads", () => {
  assert.equal(attentionClearFromEvent(new Event(CHAT_ATTENTION_CLEAR_EVENT)), null);
  assert.equal(attentionSettlementFromEvent(new Event(CHAT_ATTENTION_SETTLE_EVENT)), null);
  assert.equal(attentionClearFromEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-3" },
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
    emitChatAttentionClear(" session-5 ", " run-5 ");
    emitChatAttentionSettlement(" session-6 ", " run-6 ", "persisted");
    assert.equal(dispatched.length, 2);
    assert.deepEqual(attentionClearFromEvent(dispatched[0]), {
      sessionId: "session-5",
      operationId: "run-5",
    });
    assert.deepEqual(attentionSettlementFromEvent(dispatched[1]), {
      sessionId: "session-6",
      operationId: "run-6",
      outcome: "persisted",
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
