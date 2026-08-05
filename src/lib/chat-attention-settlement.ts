import type { ChatAttentionSettlementOutcome } from "./chat-attention-projection.ts";

export type ChatAttentionSettlementTracker = {
  markAttentionCleared: (sessionId: string) => void;
  markPersistenceConfirmed: () => void;
  reconcileNow: () => void;
  reconcileIfNeeded: () => void;
};

export function createChatAttentionSettlementTracker(args: {
  operationId: string;
  settleProjection: (
    sessionId: string,
    operationId: string,
    outcome: ChatAttentionSettlementOutcome,
  ) => void;
  reconcileCanonicalSessions: () => void;
}): ChatAttentionSettlementTracker {
  const clearedSessionIds = new Set<string>();
  let persistenceConfirmed = false;
  let reconciled = false;

  const reconcileNow = () => {
    if (reconciled || clearedSessionIds.size === 0) return;
    reconciled = true;
    const outcome = persistenceConfirmed ? "persisted" : "failed";
    for (const sessionId of clearedSessionIds) {
      args.settleProjection(sessionId, args.operationId, outcome);
    }
    args.reconcileCanonicalSessions();
  };

  return {
    markAttentionCleared(sessionId) {
      clearedSessionIds.add(sessionId);
    },
    markPersistenceConfirmed() {
      persistenceConfirmed = true;
    },
    reconcileNow,
    reconcileIfNeeded() {
      reconcileNow();
    },
  };
}
