import type { SessionRow } from "@/lib/types";

export function filterDeletedSessions(
  sessions: SessionRow[],
  deletedIds: ReadonlySet<string>,
): SessionRow[] {
  if (deletedIds.size === 0) return sessions;
  return sessions.filter((session) => !deletedIds.has(session.id));
}
