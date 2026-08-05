import type { ChatAttentionSettlementOutcome } from "./chat-attention-projection.ts";

export type ChatAttentionAdoptionTracker = {
  shouldEmit(sessionId: string | null | undefined, runId: string | null | undefined): boolean;
};

export function createChatAttentionAdoptionTracker(): ChatAttentionAdoptionTracker {
  const adoptedRunIdBySessionId = new Map<string, string>();
  return {
    shouldEmit(sessionId, runId) {
      const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
      const normalizedRunId = typeof runId === "string" ? runId.trim() : "";
      if (!normalizedSessionId || !normalizedRunId) return false;
      if (adoptedRunIdBySessionId.get(normalizedSessionId) === normalizedRunId) return false;
      adoptedRunIdBySessionId.set(normalizedSessionId, normalizedRunId);
      return true;
    },
  };
}

export type ExternallySettledGenerationRegistry = {
  mark(controller: AbortController, sessionId: string, operationId: string): void;
  consume(controller: AbortController, sessionId: string, operationId: string): boolean;
};

export function createExternallySettledGenerationRegistry(): ExternallySettledGenerationRegistry {
  const externallySettledControllers = new WeakMap<AbortController, Set<string>>();
  const keyFor = (sessionId: string, operationId: string) => `${sessionId.length}:${sessionId}${operationId}`;
  return {
    mark(controller, sessionId, operationId) {
      let settlements = externallySettledControllers.get(controller);
      if (!settlements) {
        settlements = new Set<string>();
        externallySettledControllers.set(controller, settlements);
      }
      settlements.add(keyFor(sessionId, operationId));
    },
    consume(controller, sessionId, operationId) {
      const settlements = externallySettledControllers.get(controller);
      if (!settlements) return false;
      const consumed = settlements.delete(keyFor(sessionId, operationId));
      if (settlements.size === 0) externallySettledControllers.delete(controller);
      return consumed;
    },
  };
}

export type ChatAttentionSettlementTracker = {
  markAttentionCleared: (sessionId: string) => void;
  markPersistenceConfirmed: () => void;
  reconcileNow: () => void;
  reconcileIfNeeded: () => void;
};

export function createChatAttentionSettlementTracker(args: {
  operationId: string;
  operationController: AbortController;
  settleProjection: (
    sessionId: string,
    operationId: string,
    outcome: ChatAttentionSettlementOutcome,
  ) => void;
  reconcileCanonicalSessions: () => void;
  externalSettlements?: ExternallySettledGenerationRegistry;
}): ChatAttentionSettlementTracker {
  const clearedSessionIds = new Set<string>();
  let persistenceConfirmed = false;
  let reconciled = false;

  const reconcileNow = () => {
    if (reconciled) return;
    if (clearedSessionIds.size === 0) return;
    reconciled = true;
    const outcome = persistenceConfirmed ? "persisted" : "failed";
    const unsettledSessionIds = [...clearedSessionIds].filter((sessionId) => !args.externalSettlements?.consume(
      args.operationController,
      sessionId,
      args.operationId,
    ));
    if (unsettledSessionIds.length === 0) return;
    for (const sessionId of unsettledSessionIds) {
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

export type AdoptedAttentionSettlementRegistry = {
  register(controller: AbortController, tracker: ChatAttentionSettlementTracker): void;
  markAttentionCleared(controller: AbortController, sessionId: string): boolean;
};

export function createAdoptedAttentionSettlementRegistry(): AdoptedAttentionSettlementRegistry {
  const settlementTrackers = new WeakMap<AbortController, ChatAttentionSettlementTracker>();
  return {
    register(controller, tracker) {
      settlementTrackers.set(controller, tracker);
    },
    markAttentionCleared(controller, sessionId) {
      const tracker = settlementTrackers.get(controller);
      if (!tracker) return false;
      tracker.markAttentionCleared(sessionId);
      return true;
    },
  };
}
