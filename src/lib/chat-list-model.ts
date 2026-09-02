import { filterVisibleChatSessions } from "./chat-projects.ts";
import type { SessionRow } from "./types";

/**
 * The ONE set of chats a surface may show (cave-dkdev).
 *
 * The Sessions list and the workspace sidebar were each composing their own
 * answer to "which chats exist?" — the list ran `chatListCandidates` (merge in
 * archived rows when asked, drop rows whose delete is inside the undo window)
 * and then `filterVisibleChatSessions`; the sidebar ran only the latter. Two
 * compositions of the same intent, so the two surfaces could show different
 * chats and different totals for one workspace, and nothing in either file
 * said they were supposed to agree.
 *
 * This is that agreement, written down once. Callers vary only by the state
 * they actually have: the sidebar holds no archive toggle and no undo window,
 * so it passes neither and gets the plain visible set — the same set the list
 * shows with its toggle off and nothing pending.
 */
export function visibleChatSessions(
  sessions: readonly SessionRow[],
  familiarId: string | null,
  opts?: {
    /** Cave-archived rows to merge in; only consulted when `showArchived`. */
    archivedRows?: readonly SessionRow[];
    /** The list's explicit "Show archived" toggle. */
    showArchived?: boolean;
    /** Rows whose bulk delete is pending in the undo window — still on the
     *  server, restored if the user hits Undo, and hidden meanwhile. */
    pendingDeleteIds?: ReadonlySet<string>;
  },
): SessionRow[] {
  const showArchived = opts?.showArchived ?? false;
  const candidates = chatListCandidates(
    sessions,
    opts?.archivedRows ?? [],
    showArchived,
    opts?.pendingDeleteIds ?? EMPTY_PENDING_DELETE,
  );
  return filterVisibleChatSessions(candidates, familiarId, { includeArchived: showArchived });
}

const EMPTY_PENDING_DELETE: ReadonlySet<string> = new Set<string>();

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
