/** In-window invalidation of already admitted chat data. This does not grant
 * access: a later read/send must still pass the server's current policy. */
export type ChatAccessInvalidation = {
  sessionId?: string;
  reason: "denied" | "policy" | "missing";
};

type Listener = (change: ChatAccessInvalidation) => void;
const listeners = new Set<Listener>();

export function subscribeChatAccessInvalidation(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function invalidateChatAccess(change: ChatAccessInvalidation): void {
  for (const listener of listeners) listener(change);
}

export function invalidatesChatSession(change: ChatAccessInvalidation, sessionId: string): boolean {
  return change.sessionId === undefined || change.sessionId === sessionId;
}

/** A stream can acquire a server-assigned ID after dispatch. Consult its live
 * alias set on each invalidation, and never infer a tool outcome from abort. */
export function createChatStreamAccessGuard(
  controller: AbortController,
  readAliases: () => ReadonlySet<string>,
): { revoked: () => boolean; dispose: () => void } {
  let revoked = false;
  const dispose = subscribeChatAccessInvalidation((change) => {
    if (revoked || (change.sessionId !== undefined && !readAliases().has(change.sessionId))) return;
    revoked = true;
    if (change.sessionId !== undefined) {
      for (const sessionId of readAliases()) {
        if (sessionId !== change.sessionId) invalidateChatAccess({ ...change, sessionId });
      }
    }
    controller.abort();
  });
  return { revoked: () => revoked, dispose };
}
