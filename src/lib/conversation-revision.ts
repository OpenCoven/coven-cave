type ConversationRevision = {
  activeLeafId?: unknown;
  turns?: unknown;
  updatedAt?: unknown;
};

/**
 * Compare the persisted revision fields that change whenever Cave writes a
 * conversation. Missing timestamps fail open so legacy payloads still refresh.
 */
export function sameConversationRevision(
  left: ConversationRevision | null | undefined,
  right: ConversationRevision | null | undefined,
): boolean {
  if (
    typeof left?.updatedAt !== "string"
    || left.updatedAt.length === 0
    || typeof right?.updatedAt !== "string"
    || right.updatedAt.length === 0
  ) {
    return false;
  }
  return (
    left.updatedAt === right.updatedAt
    && left.activeLeafId === right.activeLeafId
    && Array.isArray(left.turns)
    && Array.isArray(right.turns)
    && left.turns.length === right.turns.length
  );
}
