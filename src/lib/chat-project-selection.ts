import type { ChatProjectGroup } from "@/lib/chat-projects";

/** "all" = no scope, "none" = the null-projectRoot group, otherwise a projectRoot path.
 *  Roots are absolute paths, so the sentinels can't collide with real values. */
export type ProjectSelection = "all" | "none" | string;

export const PROJECT_SIDEBAR_KEYS = {
  open: "cave:chat:project-sidebar-open",
  expanded: "cave:chat:project-sidebar-expanded",
  selected: "cave:chat:project-selected",
} as const;

export function selectionKey(projectRoot: string | null): string {
  return projectRoot === null ? "none" : projectRoot;
}

/** "all" → groups unchanged (same reference, lets memoized consumers bail);
 *  otherwise the single matching group, or [] when the selection is stale. */
export function applyProjectScope(
  groups: ChatProjectGroup[],
  selection: ProjectSelection,
): ChatProjectGroup[] {
  if (selection === "all") return groups;
  const match = groups.find((g) => selectionKey(g.projectRoot) === selection);
  return match ? [match] : [];
}

/** Falls back to "all" when the selected project no longer exists
 *  (sessions archived, familiar switched). */
export function normalizeSelection(
  selection: ProjectSelection,
  groups: ChatProjectGroup[],
): ProjectSelection {
  if (selection === "all") return "all";
  return groups.some((g) => selectionKey(g.projectRoot) === selection) ? selection : "all";
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
