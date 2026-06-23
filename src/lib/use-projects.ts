"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CaveProject } from "@/lib/cave-projects";

export type ProjectsState = {
  projects: CaveProject[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  createProject: (name: string, root: string) => Promise<CaveProject | null>;
  renameProject: (id: string, name: string) => Promise<boolean>;
  updateRoot: (id: string, root: string) => Promise<boolean>;
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
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const url = familiarId
        ? `/api/projects?familiarId=${encodeURIComponent(familiarId)}`
        : "/api/projects";
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ok?: boolean; projects?: CaveProject[]; error?: string };
      if (!controller.signal.aborted) {
        if (data.ok === false) {
          setError(data.error ?? "Failed to load projects");
        } else {
          setProjects(Array.isArray(data.projects) ? data.projects : []);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [familiarId]);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      setLoading(false);
      return;
    }

    load();
    return () => abortRef.current?.abort();
  }, [enabled, load]);

  const createProject = useCallback(async (name: string, root: string): Promise<CaveProject | null> => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, root }),
    });
    const data = await res.json();
    if (data.ok && data.project) {
      setProjects((prev) => [...prev, data.project as CaveProject]);
      return data.project as CaveProject;
    }
    return null;
  }, []);

  const renameProject = useCallback(async (id: string, name: string): Promise<boolean> => {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.ok && data.project) {
      setProjects((prev) => prev.map((project) => (project.id === id ? data.project : project)));
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
      setProjects((prev) => prev.map((project) => (project.id === id ? data.project : project)));
      return true;
    }
    return false;
  }, []);

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      setProjects((prev) => prev.filter((project) => project.id !== id));
      return true;
    }
    return false;
  }, []);

  return {
    projects,
    loading,
    error,
    reload: load,
    createProject,
    renameProject,
    updateRoot,
    deleteProject,
  };
}
