// Pure, framework-free helpers for the Projects hub's persisted selection —
// which project the master-detail view shows on the right. Kept self-contained
// (no React, no localStorage, no value imports) so the resolve/default logic
// can be unit-tested under the strip-types runner; the React glue lives in
// projects-view.tsx.

/** localStorage key holding the selected project id. */
export const PROJECTS_SELECTED_KEY = "cave:projects:selected";

/** Parse the persisted selection blob into a clean id (null on junk/empty). */
export function parseStoredProjectId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A project as the selection logic sees it: id + pre-normalized root key. */
export type SelectableProject = { id: string; rootKey: string };

/**
 * Default selection when nothing (valid) is persisted: the project with the
 * most recent session activity, falling back to the first project (the list is
 * already alphabetical). Null only when there are no projects at all.
 */
export function defaultSelectedProjectId(
  projects: readonly SelectableProject[],
  lastActiveMsByRootKey: ReadonlyMap<string, number>,
): string | null {
  let best: string | null = null;
  let bestMs = 0;
  for (const project of projects) {
    const ms = lastActiveMsByRootKey.get(project.rootKey) ?? 0;
    if (ms > bestMs) {
      bestMs = ms;
      best = project.id;
    }
  }
  return best ?? projects[0]?.id ?? null;
}

/**
 * Resolve the selection for this render: the stored id when it still names a
 * live project (it may have been deleted, or filtered out by a familiar scope
 * change), otherwise the activity-based default.
 */
export function resolveSelectedProjectId(
  stored: string | null,
  projects: readonly SelectableProject[],
  lastActiveMsByRootKey: ReadonlyMap<string, number>,
): string | null {
  if (stored && projects.some((p) => p.id === stored)) return stored;
  return defaultSelectedProjectId(projects, lastActiveMsByRootKey);
}
