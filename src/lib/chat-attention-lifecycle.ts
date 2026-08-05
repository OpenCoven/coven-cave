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
  mark(controller: AbortController): void;
  consume(controller: AbortController): boolean;
};

export function createExternallySettledGenerationRegistry(): ExternallySettledGenerationRegistry {
  const externallySettledControllers = new WeakSet<AbortController>();
  return {
    mark(controller) {
      externallySettledControllers.add(controller);
    },
    consume(controller) {
      return externallySettledControllers.delete(controller);
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
    if (args.externalSettlements?.consume(args.operationController)) {
      reconciled = true;
      return;
    }
    if (clearedSessionIds.size === 0) return;
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
