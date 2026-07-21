import type { ChatProjectGroup } from "@/lib/chat-projects";

/** "all" = all projects, "none" = the null-project group, otherwise a project id.
 *  Unknown non-null roots fall back to a root-scoped key so they remain
 *  selectable without colliding with the "none" bucket. */
export type ProjectSelection = "all" | "none" | string;

export const PROJECT_SIDEBAR_KEYS = {
  open: "cave:chat:project-sidebar-open",
  expanded: "cave:chat:project-sidebar-expanded",
  selected: "cave:chat:project-selected",
} as const;

export function selectionKey(projectId: string | null, projectRoot?: string | null): string {
  if (projectId) return projectId;
  if (projectRoot) return `root:${projectRoot}`;
  return "none";
}

export function projectSelectionKeys(groups: ChatProjectGroup[]): string[] {
  return groups.map((group) => selectionKey(group.projectId, group.projectRoot));
}

/** "all" → groups unchanged (same reference, lets memoized consumers bail);
 *  otherwise the single matching group, or [] when the selection is stale. */
export function applyProjectScope(
  groups: ChatProjectGroup[],
  selection: ProjectSelection,
): ChatProjectGroup[] {
  if (selection === "all") return groups;
  const match = groups.find((g) => selectionKey(g.projectId, g.projectRoot) === selection);
  return match ? [match] : [];
}

/** Falls back to "all" when the selected project no longer exists
 *  (sessions archived, familiar switched). */
export function normalizeSelection(
  selection: ProjectSelection,
  groups: ChatProjectGroup[],
): ProjectSelection {
  if (selection === "all") return "all";
  return groups.some((g) => selectionKey(g.projectId, g.projectRoot) === selection) ? selection : "all";
}

/** Group keys that should auto-expand after a sessions refresh (cave-mllp).
 *
 *  Once the user has ANY persisted expanded-keys, groups render collapsed
 *  unless stored — so the first chat in a fresh project folder lands inside a
 *  collapsed group and reads as "my new chat never showed up". A key
 *  qualifies when its group gained a session id missing from the baseline
 *  (`knownSessionIds`, captured from the UNFILTERED session list at hydration
 *  and grown per refresh) and either:
 *  - the group key itself is new (`knownGroupKeys`) AND the fresh session was
 *    created at/after `newSinceMs` — a brand-new project folder whose content
 *    is a genuinely new chat, or
 *  - the fresh session is the active one — the chat this surface just
 *    started or is watching (no recency gate: end-of-stream persistence can
 *    land the active chat's row minutes after it began).
 *  The recency gate is what keeps "first seen by this client" from being
 *  confused with "new" (cave-a9w9): a failed/partial first load poisons the
 *  baseline, and error recovery, daemon backfill, or a familiar switch to a
 *  differently-granted scope then delivers OLD chats under unseen keys —
 *  those must not mass-expand (and persist over) the user's collapsed
 *  folders. Background sessions landing in existing collapsed folders don't
 *  force them open either, however recent. */
export function autoExpandKeysForNewSessions(args: {
  groups: ChatProjectGroup[];
  knownSessionIds: ReadonlySet<string>;
  knownGroupKeys: ReadonlySet<string>;
  activeSessionId: string | null;
  /** Only sessions created at/after this instant count as "new chats" for
   *  the new-folder path; missing/unparsable created_at fails closed. */
  newSinceMs: number;
}): string[] {
  const keys: string[] = [];
  for (const group of args.groups) {
    const key = selectionKey(group.projectId, group.projectRoot);
    const fresh = group.sessions.filter((s) => !args.knownSessionIds.has(s.id));
    if (fresh.length === 0) continue;
    const hasRecentFresh = fresh.some((s) => {
      const createdMs = Date.parse(s.created_at ?? "");
      return Number.isFinite(createdMs) && createdMs >= args.newSinceMs;
    });
    const newGroup = !args.knownGroupKeys.has(key) && hasRecentFresh;
    const activeIsFresh =
      args.activeSessionId !== null && fresh.some((s) => s.id === args.activeSessionId);
    if (newGroup || activeIsFresh) keys.push(key);
  }
  return keys;
}

/** localStorage JSON read that survives SSR (no window) and corrupt values. */
export function readPersisted<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
