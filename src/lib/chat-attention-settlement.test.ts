import assert from "node:assert/strict";
import test from "node:test";
import { createChatAttentionSettlementTracker } from "./chat-attention-settlement.ts";

test("clean terminal failure reconciles exactly once without a thrown catch", () => {
  let reconciles = 0;
  const tracker = createChatAttentionSettlementTracker(() => {
    reconciles += 1;
  });

  tracker.markAttentionCleared();
  tracker.reconcileIfNeeded();
  tracker.reconcileIfNeeded();

  assert.equal(reconciles, 1);
});

test("a failed startNewConversation terminal settlement reconciles canonical sessions exactly once", () => {
  let reconciles = 0;
  const tracker = createChatAttentionSettlementTracker(() => {
    reconciles += 1;
  });

  tracker.markAttentionCleared();
  tracker.reconcileNow();
  tracker.reconcileIfNeeded();

  assert.equal(reconciles, 1);
});

test("a successful terminal done settlement suppresses reconciliation", () => {
  let reconciles = 0;
  const tracker = createChatAttentionSettlementTracker(() => {
    reconciles += 1;
  });

  tracker.markAttentionCleared();
  tracker.markPersistenceConfirmed();
  tracker.reconcileIfNeeded();

  assert.equal(reconciles, 0);
});

test("a successful startNewConversation settlement refreshes canonical sessions exactly once", () => {
  let reconciles = 0;
  const tracker = createChatAttentionSettlementTracker(() => {
    reconciles += 1;
  });

  tracker.markAttentionCleared();
  tracker.markPersistenceConfirmed();
  tracker.reconcileNow();
  tracker.reconcileIfNeeded();

  assert.equal(reconciles, 1);
});
