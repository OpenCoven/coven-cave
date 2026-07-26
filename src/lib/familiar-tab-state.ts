import type { Familiar } from "./types.ts";

type RosterBackedState<T extends Familiar> = {
  familiars: T[];
  /** A failed refresh may coexist with a last-known-good roster. */
  rosterWarning: string | null;
};

export type FamiliarTabState<T extends Familiar = Familiar> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | ({ kind: "all" } & RosterBackedState<T>)
  | ({ kind: "subset"; selectedIds: string[]; missingIds: string[] } & RosterBackedState<T>)
  | { kind: "single"; familiar: T; rosterWarning: string | null }
  | { kind: "unavailable"; selectedIds: string[]; rosterWarning: string | null };

type FamiliarTabStateInput<T extends Familiar> = {
  /** The active, user-selectable roster. Archived familiars are excluded. */
  familiars: readonly T[];
  selectedIds: ReadonlySet<string>;
  loaded: boolean;
  error?: string | null;
  /** Allows an already-selected archived familiar to retain its detail view. */
  selectedFamiliar?: T | null;
};

/**
 * Converts roster lifecycle + explicit familiar scope into one truthful view
 * state. In particular, an empty selection means `all`; it never means none.
 */
export function deriveFamiliarTabState<T extends Familiar>({
  familiars,
  selectedIds,
  loaded,
  error = null,
  selectedFamiliar = null,
}: FamiliarTabStateInput<T>): FamiliarTabState<T> {
  if (!loaded && familiars.length === 0 && !selectedFamiliar) return { kind: "loading" };
  if (selectedIds.size === 1 && selectedFamiliar) {
    return { kind: "single", familiar: selectedFamiliar, rosterWarning: error || null };
  }
  if (familiars.length === 0) {
    if (error) return { kind: "error", message: error };
    if (selectedIds.size > 0) return { kind: "unavailable", selectedIds: [...selectedIds], rosterWarning: null };
    return { kind: "empty" };
  }

  const rosterWarning = error || null;
  if (selectedIds.size === 0) {
    return { kind: "all", familiars: [...familiars], rosterWarning };
  }

  const ids = [...selectedIds];
  if (ids.length === 1) {
    const familiar = familiars.find((item) => item.id === ids[0]);
    if (familiar) return { kind: "single", familiar, rosterWarning };
    return { kind: "unavailable", selectedIds: ids, rosterWarning };
  }

  const scoped = familiars.filter((item) => selectedIds.has(item.id));
  const visibleIds = new Set(scoped.map((item) => item.id));
  const missingIds = ids.filter((id) => !visibleIds.has(id));
  if (scoped.length === 0) {
    return { kind: "unavailable", selectedIds: ids, rosterWarning };
  }
  return {
    kind: "subset",
    familiars: scoped,
    selectedIds: ids,
    missingIds,
    rosterWarning,
  };
}
