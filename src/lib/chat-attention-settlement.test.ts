import assert from "node:assert/strict";
import test from "node:test";
import { createChatAttentionSettlementTracker } from "./chat-attention-settlement.ts";

function trackerFixture() {
  const steps: string[] = [];
  const tracker = createChatAttentionSettlementTracker({
    operationId: "operation-1",
    settleProjection: (sessionId, operationId, outcome) => {
      steps.push(`${outcome}:${sessionId}:${operationId}`);
    },
    reconcileCanonicalSessions: () => {
      steps.push("reconcile");
    },
  });
  return { steps, tracker };
}

test("failed settlement releases its operation before one canonical reconciliation", () => {
  const { steps, tracker } = trackerFixture();
  tracker.markAttentionCleared("session-1");
  tracker.reconcileIfNeeded();
  tracker.reconcileIfNeeded();

  assert.deepEqual(steps, ["failed:session-1:operation-1", "reconcile"]);
});

test("successful persistence settles persisted once before one canonical reconciliation", () => {
  const { steps, tracker } = trackerFixture();
  tracker.markAttentionCleared("session-1");
  tracker.markPersistenceConfirmed();
  tracker.reconcileIfNeeded();
  tracker.reconcileIfNeeded();

  assert.deepEqual(steps, ["persisted:session-1:operation-1", "reconcile"]);
});

test("direct reconciliation and finally share one settlement guard", () => {
  const { steps, tracker } = trackerFixture();
  tracker.markAttentionCleared("session-1");
  tracker.markPersistenceConfirmed();
  tracker.reconcileNow();
  tracker.reconcileIfNeeded();

  assert.deepEqual(steps, ["persisted:session-1:operation-1", "reconcile"]);
});

test("repeated clears for one operation settle once", () => {
  const { steps, tracker } = trackerFixture();
  tracker.markAttentionCleared("session-1");
  tracker.markAttentionCleared("session-1");
  tracker.reconcileIfNeeded();

  assert.deepEqual(steps, ["failed:session-1:operation-1", "reconcile"]);
});

test("settlement can read the latest callback through a mutable ref wrapper", () => {
  const seen: string[] = [];
  const callbackRef: { current: () => void } = {
    current: () => {
      seen.push("stale");
    },
  };
  const tracker = createChatAttentionSettlementTracker({
    operationId: "operation-2",
    settleProjection: () => {},
    reconcileCanonicalSessions: () => {
      callbackRef.current();
    },
  });

  tracker.markAttentionCleared("session-2");
  callbackRef.current = () => {
    seen.push("latest");
  };
  tracker.reconcileIfNeeded();

  assert.deepEqual(seen, ["latest"]);
});
