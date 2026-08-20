import type { Familiar } from "./types.ts";

/**
 * Single-familiar surfaces may only consume a familiar id that is present in
 * the currently loaded, non-archived roster. If a persisted single selection
 * points at a familiar that is missing or archived, clear the single-familiar
 * owner rather than silently substituting another actor.
 */
export function resolveLoadedActiveFamiliarId(
  activeId: string | null,
  familiars: readonly Pick<Familiar, "id">[],
): string | null {
  if (!activeId) return null;
  return familiars.some((familiar) => familiar.id === activeId)
    ? activeId
    : null;
}

/**
 * Workspace boot restores the persisted familiar scope before the async roster
 * has loaded. Keep that requested id intact through the initial empty roster so
 * a valid persisted familiar survives hydration; only once the roster has
 * loaded may the selection clear if the requested familiar is unavailable.
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
