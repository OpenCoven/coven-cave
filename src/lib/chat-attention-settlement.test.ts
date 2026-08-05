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

test("an early session id followed by failure still reconciles canonical sessions", () => {
  let reconciles = 0;
  const tracker = createChatAttentionSettlementTracker(() => {
    reconciles += 1;
  });

  tracker.markAttentionCleared();
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
