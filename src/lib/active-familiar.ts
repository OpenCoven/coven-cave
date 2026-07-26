import type { Familiar } from "./types.ts";

/**
 * Single-familiar surfaces may only consume a familiar id that is present in
 * the currently loaded, non-archived roster. If a persisted single selection
 * points at a familiar that is still loading, missing, or archived, fall back
 * to the first loaded visible familiar instead.
 */
export function resolveLoadedActiveFamiliarId(
  activeId: string | null,
  familiars: readonly Pick<Familiar, "id">[],
): string | null {
  if (!activeId) return null;
  return familiars.some((familiar) => familiar.id === activeId)
    ? activeId
    : familiars[0]?.id ?? null;
}

/**
 * Workspace boot restores the persisted familiar scope before the async roster
 * has loaded. Keep that requested id intact through the initial empty roster so
 * a valid persisted familiar survives hydration; only once the roster has
 * loaded may the selection heal to the loaded fallback.
 */
export function resolveWorkspaceActiveFamiliarId(
  activeId: string | null,
  familiars: readonly Pick<Familiar, "id">[],
  familiarsLoaded: boolean,
  familiarRosterLoadedSuccessfully: boolean,
): string | null {
  return familiarsLoaded && familiarRosterLoadedSuccessfully
    ? resolveLoadedActiveFamiliarId(activeId, familiars)
    : activeId;
}
