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
