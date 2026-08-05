export type ChatAttentionSettlementTracker = {
  markAttentionCleared: () => void;
  markPersistenceConfirmed: () => void;
  reconcileIfNeeded: () => void;
};

export function createChatAttentionSettlementTracker(
  reconcileCanonicalSessions: () => void,
): ChatAttentionSettlementTracker {
  let attentionNeedsReconcile = false;
  let persistenceConfirmed = false;
  let reconciled = false;

  return {
    markAttentionCleared() {
      attentionNeedsReconcile = true;
    },
    markPersistenceConfirmed() {
      persistenceConfirmed = true;
      attentionNeedsReconcile = false;
    },
    reconcileIfNeeded() {
      if (reconciled || !attentionNeedsReconcile || persistenceConfirmed) return;
      reconciled = true;
      reconcileCanonicalSessions();
    },
  };
}
