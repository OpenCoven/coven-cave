export type ChatAttentionSettlementTracker = {
  markAttentionCleared: () => void;
  markPersistenceConfirmed: () => void;
  reconcileNow: () => void;
  reconcileIfNeeded: () => void;
};

export function createChatAttentionSettlementTracker(
  reconcileCanonicalSessions: () => void,
): ChatAttentionSettlementTracker {
  let attentionNeedsReconcile = false;
  let persistenceConfirmed = false;
  let reconciled = false;
  const reconcileNow = () => {
    if (reconciled) return;
    reconciled = true;
    attentionNeedsReconcile = false;
    reconcileCanonicalSessions();
  };

  return {
    markAttentionCleared() {
      attentionNeedsReconcile = true;
    },
    markPersistenceConfirmed() {
      persistenceConfirmed = true;
      attentionNeedsReconcile = false;
    },
    reconcileNow,
    reconcileIfNeeded() {
      if (reconciled || !attentionNeedsReconcile || persistenceConfirmed) return;
      reconcileNow();
    },
  };
}
