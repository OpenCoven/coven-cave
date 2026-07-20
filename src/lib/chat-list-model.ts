import type { SessionRow } from "./types";

/** Merge the opt-in archive response and hide rows in the deferred-delete window. */
export function chatListCandidates(
  sessions: readonly SessionRow[],
  archivedRows: readonly SessionRow[],
  showArchived: boolean,
  pendingDeleteIds: ReadonlySet<string>,
): SessionRow[] {
  let rows: readonly SessionRow[] = sessions;
  if (showArchived && archivedRows.length > 0) {
    const seen = new Set(sessions.map((session) => session.id));
    rows = [...sessions, ...archivedRows.filter((session) => !seen.has(session.id))];
  }
  return pendingDeleteIds.size ? rows.filter((session) => !pendingDeleteIds.has(session.id)) : [...rows];
}

/** Apply title/project search and the active-only filter without mutating source rows. */
export function filterChatListRows(rows: readonly SessionRow[], search: string, activeOnly: boolean): SessionRow[] {
  let filtered: readonly SessionRow[] = rows;
  if (activeOnly) filtered = filtered.filter((session) => session.status === "running");
  const query = search.trim().toLowerCase();
  if (!query) return [...filtered];
  return filtered.filter(
    (session) =>
      (session.title ?? "").toLowerCase().includes(query) ||
      (session.project_root ?? "").toLowerCase().includes(query),
  );
}

/** Restore global most-recent-first order after flattening project groups. */
export function sortChatRowsByRecency(rows: readonly SessionRow[]): SessionRow[] {
  return [...rows].sort((a, b) => {
    const at = Date.parse(a.updated_at || a.created_at) || 0;
    const bt = Date.parse(b.updated_at || b.created_at) || 0;
    return bt - at;
  });
}
