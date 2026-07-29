/**
 * access-views.ts — pure derivations for the Projects.dc.html refresh of the
 * Chat → Projects "Project access" page.
 *
 * The page grew three ways of looking at the same access map (cards, a dense
 * table, a by-level audit), a proportional ledger instead of three loose
 * numbers, and section headers that keep reporting state while collapsed.
 * All of that is arithmetic over the row states, so it lives here and the
 * component stays wiring.
 *
 * Pure and client-safe — no `node:` imports.
 */

import type { AccessState } from "./access-page.ts";
import { accessStateMeta } from "./access-page.ts";
import { classifyProjectSection } from "./access-page.ts";

/** Levels in ledger/audit order: strongest first, matching the design. */
export const ACCESS_ORDER: readonly AccessState[] = ["write", "read", "none"];

export type ProjectViewMode = "grid" | "rows" | "tree";

export const VIEW_MODES: readonly ProjectViewMode[] = ["grid", "rows", "tree"];

export function isViewMode(value: string | null | undefined): value is ProjectViewMode {
  return value === "grid" || value === "rows" || value === "tree";
}

/**
 * The header ledger: one proportional segment per level.
 *
 * Percentages are computed from the whole map, so the bar is a picture of the
 * familiar's reach rather than of whatever the search box currently shows. An
 * empty map yields zero-width segments rather than NaN.
 */
export type LedgerSegment = {
  state: AccessState;
  label: string;
  count: number;
  /** CSS width, e.g. "42.9%". */
  width: string;
};

export function accessLedger(counts: Record<AccessState, number>): LedgerSegment[] {
  const total = ACCESS_ORDER.reduce((sum, state) => sum + (counts[state] ?? 0), 0);
  return ACCESS_ORDER.map((state) => {
    const count = counts[state] ?? 0;
    return {
      state,
      label: accessStateMeta(state).label,
      count,
      width: total === 0 ? "0%" : `${((count / total) * 100).toFixed(1)}%`,
    };
  });
}

/**
 * Collapsed-section summary: the access mix, strongest level first, with
 * zero-count levels dropped. Folding a section must never hide the fact that
 * something in it is granted.
 */
export type MixChip = { state: AccessState; label: string; count: number };

export function sectionMix(states: Iterable<AccessState>): MixChip[] {
  const counts: Record<AccessState, number> = { none: 0, read: 0, write: 0 };
  for (const state of states) counts[state] += 1;
  return ACCESS_ORDER.filter((state) => counts[state] > 0).map((state) => ({
    state,
    label: accessStateMeta(state).label,
    count: counts[state],
  }));
}

/** Collapsed-section name peek: "Coven, Coven Cave, Coven Docs +17". */
export function sectionPeek(names: readonly string[], shown = 3): string {
  if (names.length === 0) return "";
  const head = names.slice(0, shown).join(", ");
  return names.length > shown ? `${head} +${names.length - shown}` : head;
}

/**
 * What a level actually permits, spelled out. The card's expanded face lists
 * these so "Read" and "Full" stop being opaque labels — read grants file
 * reads only; full adds writes, shell, and network.
 */
export const GRANT_CAPABILITIES = [
  "read files",
  "write files",
  "run shell",
  "network",
] as const;

export type GrantChip = { label: string; on: boolean };

export function grantChips(state: AccessState): GrantChip[] {
  return GRANT_CAPABILITIES.map((label, index) => ({
    label,
    on: state === "write" || (state === "read" && index === 0),
  }));
}

/** Which glyph/kind a project reads as — a familiar workspace or a repository. */
export type ProjectKind = "workspace" | "repo";

export function projectKind(root: string): ProjectKind {
  return classifyProjectSection(root) === "workspaces" ? "workspace" : "repo";
}

/**
 * Rows view ordering: strongest access first, then name. A dense audit list is
 * most useful when everything granted floats to the top.
 */
export function sortByAccessThenName<T extends { name: string; state: AccessState }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const byAccess = ACCESS_ORDER.indexOf(a.state) - ACCESS_ORDER.indexOf(b.state);
    if (byAccess !== 0) return byAccess;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}

/**
 * Tree view: group by access level rather than by project type — the shape a
 * power user audits in ("what does this familiar have full access to?").
 * Empty levels are kept so the absence is visible.
 */
export type TreeGroup<T> = {
  state: AccessState;
  label: string;
  /** "3 projects" / "1 project" / "nothing at this level". */
  countLabel: string;
  items: T[];
};

export function treeGroups<T extends { state: AccessState }>(
  rows: readonly T[],
): TreeGroup<T>[] {
  return ACCESS_ORDER.map((state) => {
    const items = rows.filter((row) => row.state === state);
    return {
      state,
      label: accessStateMeta(state).label,
      countLabel:
        items.length === 0
          ? "nothing at this level"
          : `${items.length} ${items.length === 1 ? "project" : "projects"}`,
      items,
    };
  });
}

/** Bulk-band summary: "3 selected" / "1 selected". */
export function selectionLabel(count: number): string {
  return `${count} selected`;
}
