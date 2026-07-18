import type { SessionRow } from "@/lib/types";

export function filterDeletedSessions(
  sessions: SessionRow[],
  deletedIds: ReadonlySet<string>,
): SessionRow[] {
  if (deletedIds.size === 0) return sessions;
  return sessions.filter((session) => !deletedIds.has(session.id));
}

/**
 * Record the ids a DELETE request confirmed before any follow-up list response
 * can be applied. Returns the unique, non-empty ids recorded by this call.
 */
export function recordDeletedSessionIds(
  deletedIds: Set<string>,
  sessionIds: readonly string[],
): string[] {
  const recorded: string[] = [];
  const seen = new Set<string>();
  for (const sessionId of sessionIds) {
    if (!sessionId || seen.has(sessionId) || deletedIds.has(sessionId)) continue;
    seen.add(sessionId);
    deletedIds.add(sessionId);
    recorded.push(sessionId);
  }
  return recorded;
}

/** Pair bulk mutation results back to their input ids without hiding failures. */
export function successfulSessionIds(
  sessionIds: readonly string[],
  succeeded: readonly boolean[],
): string[] {
  return sessionIds.filter((sessionId, index) => Boolean(sessionId) && succeeded[index] === true);
}
