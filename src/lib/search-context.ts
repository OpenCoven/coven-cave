/**
 * search-context — implicit scope derivation from active workspace state
 * (cave-ychtl.6).
 *
 * Global search opens with the current project, familiar, session, and runtime
 * as visible hard-constraint chips. Those scopes are DERIVED, not typed: the
 * surface asks where the user actually is and renders it, so the current
 * context is never silently guessed and never carried by placeholder text.
 *
 * The derivation is deliberately small and deterministic. Every source is an
 * id plus (where the caller has it) a human label; a missing label degrades
 * to the id so a chip is still renderable. Nothing here reads storage or
 * touches React — callers (the palette, tests) pass what they know.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 */

import type { SearchScope, SearchScopeDimension } from "./search-filters.ts";

export type ImplicitScopeSource = {
  /** The familiar the surface is currently scoped to, if any. */
  activeFamiliarId: string | null;
  /** Roster used only to turn the familiar id into a display label. */
  familiars?: readonly {
    id: string;
    display_name?: string | null;
    name?: string | null;
  }[];
  /** The project the surface is currently working in, if any. */
  activeProjectId?: string | null;
  /** Human label for the active project; falls back to the id. */
  activeProjectName?: string | null;
  /** The session the surface is currently attached to, if any. */
  activeSessionId?: string | null;
  /** Runtime/harness label for the active session, if any. */
  runtime?: string | null;
};

/** Derivation order — project, then familiar, then session, then runtime. */
const DIMENSION_ORDER: readonly SearchScopeDimension[] = [
  "project",
  "familiar",
  "session",
  "runtime",
];

function familiarLabel(
  source: ImplicitScopeSource,
  familiarId: string,
): string {
  const familiar = source.familiars?.find((candidate) => candidate.id === familiarId);
  return familiar?.display_name ?? familiar?.name ?? familiarId;
}

/**
 * Derive the implicit (context) scopes for the active workspace state.
 *
 * Each returned scope carries `implicit: true`, which is what makes it
 * removable in one gesture: Command/Control+Enter (and the chip remove
 * buttons) drop implicit scopes while explicit filters survive.
 */
export function deriveImplicitScopes(source: ImplicitScopeSource): SearchScope[] {
  const scopes: SearchScope[] = [];

  if (source.activeProjectId) {
    scopes.push({
      dimension: "project",
      id: source.activeProjectId,
      label: source.activeProjectName ?? source.activeProjectId,
      implicit: true,
    });
  }

  if (source.activeFamiliarId) {
    scopes.push({
      dimension: "familiar",
      id: source.activeFamiliarId,
      label: familiarLabel(source, source.activeFamiliarId),
      implicit: true,
    });
  }

  if (source.activeSessionId) {
    scopes.push({
      dimension: "session",
      id: source.activeSessionId,
      label: source.activeSessionId,
      implicit: true,
    });
  }

  if (source.runtime) {
    scopes.push({
      dimension: "runtime",
      id: source.runtime,
      label: source.runtime,
      implicit: true,
    });
  }

  return scopes.sort(
    (a, b) => DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension),
  );
}

/** Whether any scope in a set is context-derived. */
export function hasImplicitScopes(scopes: readonly SearchScope[]): boolean {
  return scopes.some((scope) => scope.implicit);
}
