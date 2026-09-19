"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import { reloadProjectCrew, subscribeProjectCrew, type ProjectCrewResult } from "./project-crew-requests.ts";

const EMPTY_FAMILIARS: Familiar[] = [];
const EMPTY_RESULTS: ReadonlyMap<string, ProjectCrewResult> = new Map();

export type ProjectFamiliarsState = {
  familiars: Familiar[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  loadedSuccessfully: boolean;
};

export type ProjectFamiliarsByProjectState = {
  familiarsByProject: ReadonlyMap<string, Familiar[]>;
  loadingProjectIds: ReadonlySet<string>;
  loadedProjectIds: ReadonlySet<string>;
};

function useProjectCrewResults(projectIdsKey: string, enabled: boolean) {
  // Project id alone is insufficient for A → B → A or disable → re-enable:
  // every selection must hide the previous load before passive effects run.
  const identity = useMemo(() => ({
    ids: projectIdsKey ? JSON.parse(projectIdsKey) as string[] : [],
    enabled,
  }), [projectIdsKey, enabled]);
  const [state, setState] = useState<{
    identity: typeof identity;
    results: ReadonlyMap<string, ProjectCrewResult>;
  } | null>(null);

  useEffect(() => {
    if (!identity.enabled || identity.ids.length === 0) return;
    return subscribeProjectCrew(identity.ids, (projectId, result) => {
      setState((previous) => {
        const results = new Map(previous?.identity === identity ? previous.results : EMPTY_RESULTS);
        results.set(projectId, result);
        return { identity, results };
      });
    });
  }, [identity]);

  return {
    ids: identity.enabled ? identity.ids : [],
    results: identity.enabled && state?.identity === identity ? state.results : EMPTY_RESULTS,
  };
}

/** Loads only the current, authorized crew; pending membership stays hidden. */
export function useProjectFamiliars({
  projectId,
  enabled = true,
}: {
  projectId: string | null;
  enabled?: boolean;
}): ProjectFamiliarsState {
  const normalizedProjectId = projectId?.trim() || null;
  const { results } = useProjectCrewResults(
    normalizedProjectId ? JSON.stringify([normalizedProjectId]) : "",
    enabled,
  );
  const result = normalizedProjectId ? results.get(normalizedProjectId) : undefined;
  const reload = useCallback(() => {
    if (enabled && normalizedProjectId) reloadProjectCrew(normalizedProjectId);
  }, [enabled, normalizedProjectId]);

  return {
    familiars: result?.status === "loaded" ? result.familiars : EMPTY_FAMILIARS,
    loading: enabled && normalizedProjectId !== null && (!result || result.status === "loading"),
    error: result?.status === "error" ? "Couldn't load project crew" : null,
    reload,
    loadedSuccessfully: result?.status === "loaded",
  };
}

/** Shares project reads with single-project pickers without unscoping a batch. */
export function useProjectFamiliarsByProject({
  projectIds,
  enabled = true,
}: {
  projectIds: readonly string[];
  enabled?: boolean;
}): ProjectFamiliarsByProjectState {
  const projectIdsKey = JSON.stringify([...new Set(projectIds.map((id) => id.trim()).filter(Boolean))].sort());
  const { ids, results } = useProjectCrewResults(projectIdsKey, enabled);

  return useMemo(() => {
    const familiarsByProject = new Map<string, Familiar[]>();
    const loadingProjectIds = new Set<string>();
    const loadedProjectIds = new Set<string>();
    for (const projectId of ids) {
      const result = results.get(projectId);
      if (result?.status === "loaded") {
        familiarsByProject.set(projectId, result.familiars);
        loadedProjectIds.add(projectId);
      } else if (!result || result.status === "loading") {
        loadingProjectIds.add(projectId);
      }
    }
    return { familiarsByProject, loadingProjectIds, loadedProjectIds };
  }, [ids, results]);
}
