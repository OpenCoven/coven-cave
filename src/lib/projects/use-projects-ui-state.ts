import { useCallback, useEffect, useState } from "react";

import {
  PROJECTS_DENSITY_KEY,
  PROJECTS_EXPANDED_KEY,
  normalizeDensity,
  parseExpandedIds,
  serializeExpandedIds,
  toggleExpandedId,
  type ProjectsDensity,
} from "./projects-ui-state";

export type ProjectsUiState = {
  /** Current list density ("comfortable" | "compact"). */
  density: ProjectsDensity;
  /** Persist + apply a new density. */
  setDensity: (density: ProjectsDensity) => void;
  /** Whether a project card (keyed by project id) is expanded. */
  isExpanded: (id: string) => boolean;
  /** Persist + apply an expanded/collapsed state for one project card. */
  setExpanded: (id: string, next: boolean) => void;
};

/**
 * Persisted UI state for the Projects tab: which cards are expanded and the list
 * density. Both survive reloads (localStorage) so the surface "remembers how you
 * left it" — native-app behavior rather than resetting to a flat collapsed list
 * every visit.
 *
 * State initializes to defaults and hydrates from localStorage in an effect (not
 * the useState initializer) so server and first client render agree — the same
 * approach the session-order state already uses to dodge hydration mismatch.
 */
export function useProjectsUiState(): ProjectsUiState {
  const [density, setDensityState] = useState<ProjectsDensity>("comfortable");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDensityState(normalizeDensity(window.localStorage.getItem(PROJECTS_DENSITY_KEY)));
    setExpandedIds(new Set(parseExpandedIds(window.localStorage.getItem(PROJECTS_EXPANDED_KEY))));
  }, []);

  const setDensity = useCallback((next: ProjectsDensity) => {
    setDensityState(next);
    try {
      window.localStorage.setItem(PROJECTS_DENSITY_KEY, next);
    } catch {
      // Storage unavailable (private mode / quota) — keep the in-memory value.
    }
  }, []);

  const isExpanded = useCallback((id: string) => expandedIds.has(id), [expandedIds]);

  const setExpanded = useCallback((id: string, next: boolean) => {
    setExpandedIds((prev) => {
      const nextIds = toggleExpandedId(prev, id, next);
      try {
        window.localStorage.setItem(PROJECTS_EXPANDED_KEY, serializeExpandedIds(nextIds));
      } catch {
        // Storage unavailable — keep the in-memory value.
      }
      return new Set(nextIds);
    });
  }, []);

  return { density, setDensity, isExpanded, setExpanded };
}
