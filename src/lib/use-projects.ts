"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { sortProjectsAlphabetically, type CaveProject } from "@/lib/cave-projects-types";
import type { CreateProjectOptions } from "./chat-add-project.ts";
import { emitProjectRegistryMutation, subscribeProjectRegistryReload } from "./project-registry-events.ts";
import { clearProjectsCache, fetchProjectsFromCache, type ProjectsPayload } from "./use-projects-cache.ts";

type ProjectMutationPayload = { ok?: boolean; project?: CaveProject; error?: string };
type CreateProjectResult =
  | { ok: true; project: CaveProject }
  | { ok: false; error: string };

function fetchProjects(
  familiarId: string | null,
  opts?: { force?: boolean },
): Promise<ProjectsPayload> {
  return fetchProjectsFromCache(familiarId, opts);
}

/** Test-only: drop the module-level cache between cases. */
export function resetProjectsCacheForTests(): void {
  clearProjectsCache();
}

export type ProjectsState = {
  projects: CaveProject[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  createProject: (name: string, root: string, options?: CreateProjectOptions) => Promise<CaveProject | null>;
  createProjectOrThrow: (name: string, root: string, options?: CreateProjectOptions) => Promise<CaveProject>;
  renameProject: (id: string, name: string) => Promise<boolean>;
  updateRoot: (id: string, root: string) => Promise<boolean>;
  /** Set an explicit tile tint, or pass null to restore the auto root-hash tint. */
  updateColor: (id: string, color: string | null) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
};

export type UseProjectsOptions = {
  enabled?: boolean;
  /**
   * When set, the list is scoped server-side to the projects this familiar has
   * been granted access to (`/api/projects?familiarId=`). Omit (or pass null)
   * to load every project — the unscoped operator view.
   */
  familiarId?: string | null;
};

export function useProjects({ enabled = true, familiarId = null }: UseProjectsOptions = {}): ProjectsState {
  const [projects, setProjects] = useState<CaveProject[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // Generation guard: bumped on every load() call, scope change, and disable,
  // so a stale response can't write into newer state. (Replaces the previous
  // per-instance AbortController — the shared, coalesced request can't be
  // aborted by one of its subscribers, so late results are discarded instead.)
  const generationRef = useRef(0);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    generationRef.current += 1;
    const gen = generationRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchProjects(familiarId, opts);
      if (generationRef.current !== gen) return;
      if (data.ok === false) {
        setError(data.error ?? "Failed to load projects");
      } else {
        setProjects(sortProjectsAlphabetically(Array.isArray(data.projects) ? data.projects : []));
      }
    } catch (err) {
      if (generationRef.current === gen) {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      }
    } finally {
      if (generationRef.current === gen) setLoading(false);
    }
  }, [familiarId]);

  useEffect(() => {
    if (!enabled) {
      generationRef.current += 1;
      setLoading(false);
      return;
    }

    // Drop the previous scope's list before refetching so a familiarId change
    // (or a re-enable) never leaves another familiar's projects visible — and
    // pickable — during the in-flight request. `load` is memoized on familiarId,
    // so this effect only re-runs when the scope or `enabled` actually changes;
    // a manual reload() after a mutation calls load() directly and is
    // unaffected, so an in-place refresh never blanks the list.
    setProjects([]);
    load();
    return () => {
      generationRef.current += 1;
    };
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeProjectRegistryReload(() => load());
  }, [enabled, load]);

  // Post-mutation refresh: bypass the microcache so callers always see the
  // just-mutated list.
  const reload = useCallback(() => {
    void load({ force: true });
  }, [load]);

  const applyCreatedProject = useCallback((project: CaveProject, emitMutation = true): CaveProject => {
    setProjects((prev) => sortProjectsAlphabetically([...prev, project]));
    if (emitMutation) emitProjectRegistryMutation();
    return project;
  }, []);

  const requestCreateProject = useCallback(async (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ): Promise<CreateProjectResult> => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, root }),
      });
      const data = (await res.json().catch(() => null)) as ProjectMutationPayload | null;
      if (res.ok && data?.ok && data.project) {
        return {
          ok: true,
          project: applyCreatedProject(data.project as CaveProject, options?.emitMutation !== false),
        };
      }
      return {
        ok: false,
        error: typeof data?.error === "string" ? data.error : `Could not create project (HTTP ${res.status})`,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not create that project.",
      };
    }
  }, [applyCreatedProject]);

  const createProject = useCallback(async (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ): Promise<CaveProject | null> => {
    const result = await requestCreateProject(name, root, options);
    return result.ok ? result.project : null;
  }, [requestCreateProject]);

  const createProjectOrThrow = useCallback(async (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ): Promise<CaveProject> => {
    const result = await requestCreateProject(name, root, options);
    if (result.ok) return result.project;
    throw new Error(result.error);
  }, [requestCreateProject]);

  const renameProject = useCallback(async (id: string, name: string): Promise<boolean> => {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.ok && data.project) {
      setProjects((prev) =>
        sortProjectsAlphabetically(prev.map((project) => (project.id === id ? data.project : project))),
      );
      emitProjectRegistryMutation();
      return true;
    }
    return false;
  }, []);

  const updateRoot = useCallback(async (id: string, root: string): Promise<boolean> => {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root }),
    });
    const data = await res.json();
    if (data.ok && data.project) {
      setProjects((prev) =>
        sortProjectsAlphabetically(prev.map((project) => (project.id === id ? data.project : project))),
      );
      emitProjectRegistryMutation();
      return true;
    }
    return false;
  }, []);

  const updateColor = useCallback(async (id: string, color: string | null): Promise<boolean> => {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
    const data = await res.json();
    if (data.ok && data.project) {
      setProjects((prev) =>
        sortProjectsAlphabetically(prev.map((project) => (project.id === id ? data.project : project))),
      );
      emitProjectRegistryMutation();
      return true;
    }
    return false;
  }, []);

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      setProjects((prev) => prev.filter((project) => project.id !== id));
      emitProjectRegistryMutation();
      return true;
    }
    return false;
  }, []);

  return {
    projects,
    loading,
    error,
    reload,
    createProject,
    createProjectOrThrow,
    renameProject,
    updateRoot,
    updateColor,
    deleteProject,
  };
}
