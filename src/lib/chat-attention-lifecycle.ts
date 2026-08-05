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
