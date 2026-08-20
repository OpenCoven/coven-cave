"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import {
  PROJECT_ACCESS_CHANGED_EVENT,
  projectAccessChangedId,
} from "./project-access-events.ts";

const EMPTY_FAMILIARS: Familiar[] = [];

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

/**
 * Loads only familiars that may launch a session in the selected project.
 * Clearing the prior result before each fetch prevents a picker from briefly
 * offering a familiar authorized for the previously selected project.
 */
export function useProjectFamiliars({
  projectId,
  enabled = true,
}: {
  projectId: string | null;
  enabled?: boolean;
}): ProjectFamiliarsState {
  const [familiars, setFamiliars] = useState<Familiar[]>(EMPTY_FAMILIARS);
  const [loading, setLoading] = useState(false);
  // Keep the result tied to the project that produced it. Effects run after
  // render, so clearing state inside the effect alone would briefly expose
  // the previous project's roster after projectId changes.
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [errorProjectId, setErrorProjectId] = useState<string | null>(null);
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const generationRef = useRef(0);
  // Synchronously invalidate any in-flight generation, clear stale UI state,
  // and establish loading before the effect re-fires. The identity is stable
  // unless enabled or projectId changes so callers may memoize it.
  const reload = useCallback(() => {
    generationRef.current += 1;
    setFamiliars(EMPTY_FAMILIARS);
    setLoadedProjectId(null);
    setErrorProjectId(null);
    setLoading(enabled && projectId !== null);
    setReloadEpoch((epoch) => epoch + 1);
  }, [enabled, projectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onProjectAccessChanged = (event: Event) => {
      if (projectAccessChangedId(event) === projectId) reload();
    };
    window.addEventListener(PROJECT_ACCESS_CHANGED_EVENT, onProjectAccessChanged);
    return () => window.removeEventListener(PROJECT_ACCESS_CHANGED_EVENT, onProjectAccessChanged);
  }, [projectId, reload]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!enabled || !projectId) {
      setFamiliars(EMPTY_FAMILIARS);
      setLoading(false);
      setLoadedProjectId(null);
      setErrorProjectId(null);
      return;
    }

    setFamiliars(EMPTY_FAMILIARS);
    setLoading(true);
    setLoadedProjectId(null);
    setErrorProjectId(null);
    void (async () => {
      try {
        const response = await fetch(`/api/familiars?projectId=${encodeURIComponent(projectId)}`, {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; familiars?: Familiar[] } | null;
        if (generationRef.current !== generation) return;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.familiars)) {
          setErrorProjectId(projectId);
          return;
        }
        setFamiliars(payload.familiars);
        setLoadedProjectId(projectId);
      } catch {
        if (generationRef.current === generation) {
          setErrorProjectId(projectId);
        }
      } finally {
        if (generationRef.current === generation) setLoading(false);
      }
    })();
  }, [enabled, projectId, reloadEpoch]);

  const currentError = enabled && projectId !== null && errorProjectId === projectId ? "Couldn't load project crew" : null;
  const currentFamiliars = enabled && projectId !== null && loadedProjectId === projectId ? familiars : EMPTY_FAMILIARS;
  const currentLoading = Boolean(
    enabled && projectId !== null && currentError === null && (loading || loadedProjectId !== projectId),
  );

  return {
    familiars: currentFamiliars,
    loading: currentLoading,
    error: currentError,
    reload,
    loadedSuccessfully: enabled && projectId !== null && loadedProjectId === projectId && currentError === null,
  };
}

/**
 * Fetches the authorized roster once per distinct project. Table mode exposes
 * an inline familiar picker for many cards at once, so sharing this lookup
 * keeps project-backed cards constrained without hiding the complete roster
 * for intentionally unscoped tasks.
 */
export function useProjectFamiliarsByProject({
  projectIds,
  enabled = true,
}: {
  projectIds: readonly string[];
  enabled?: boolean;
}): ProjectFamiliarsByProjectState {
  const [familiarsByProject, setFamiliarsByProject] = useState<Map<string, Familiar[]>>(() => new Map());
  const [loadingProjectIds, setLoadingProjectIds] = useState<Set<string>>(() => new Set());
  const [loadedProjectIds, setLoadedProjectIds] = useState<Set<string>>(() => new Set());
  const generationRef = useRef(0);
  const projectIdsKey = [...new Set(projectIds.map((projectId) => projectId.trim()).filter(Boolean))]
    .sort()
    .join("\u0000");

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const ids = projectIdsKey ? projectIdsKey.split("\u0000") : [];

    if (!enabled || ids.length === 0) {
      setFamiliarsByProject(new Map());
      setLoadingProjectIds(new Set());
      setLoadedProjectIds(new Set());
      return;
    }

    setFamiliarsByProject(new Map());
    setLoadingProjectIds(new Set(ids));
    setLoadedProjectIds(new Set());
    const search = new URLSearchParams();
    for (const projectId of ids) search.append("projectId", projectId);
    void (async () => {
      try {
        const response = await fetch(`/api/familiars?${search}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as {
          ok?: boolean;
          familiars?: Familiar[];
          familiarsByProject?: Record<string, Familiar[]>;
        } | null;
        if (!response.ok || !payload?.ok) return;
        if (generationRef.current !== generation) return;
        // `/api/familiars?projectId=…` deliberately retains its established
        // single-project `{ familiars }` response for inspector/modal callers.
        // A board can currently contain only one distinct project, though, in
        // which case this batch hook makes that same one-id request. Accept
        // both response forms so the inline picker works for single-project
        // boards and during client/server version-skewed desktop updates.
        const familiarsByProject = payload.familiarsByProject
          ?? (ids.length === 1 && Array.isArray(payload.familiars)
            ? { [ids[0]]: payload.familiars }
            : null);
        if (!familiarsByProject) return;
        const loaded = ids.map((projectId) => [
          projectId,
          Array.isArray(familiarsByProject[projectId])
            ? familiarsByProject[projectId]
            : [],
        ] as const);
        setFamiliarsByProject(new Map(loaded));
        setLoadedProjectIds(new Set(ids));
      } catch {
        // Keep every affected picker disabled and show its existing failure state.
      } finally {
        if (generationRef.current === generation) setLoadingProjectIds(new Set());
      }
    })();
  }, [enabled, projectIdsKey]);

  return { familiarsByProject, loadingProjectIds, loadedProjectIds };
}
