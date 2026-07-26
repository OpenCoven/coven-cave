"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  intersectAccessibleProjects,
  type AccessibleCaveProject,
} from "./group-chat-projects.ts";
import { subscribeProjectRegistryMutation } from "./project-registry-events.ts";
import { fetchProjectsFromCache } from "./use-projects-cache.ts";

export type GroupProjectsState = {
  projects: AccessibleCaveProject[];
  loading: boolean;
  error: string | null;
  loadedSuccessfully: boolean;
};

/**
 * Load one familiar-scoped project list per Coven participant and expose only
 * their verified intersection. Scope keys synchronously mask an older result
 * while a roster or permission refresh is in flight.
 */
export function useGroupProjects(familiarIds: readonly string[]): GroupProjectsState {
  const ids = useMemo(
    () => Array.from(new Set(familiarIds.map((id) => id.trim()).filter(Boolean))).sort(),
    [familiarIds],
  );
  const [registryGeneration, setRegistryGeneration] = useState(0);
  const [projects, setProjects] = useState<AccessibleCaveProject[]>([]);
  const [loading, setLoading] = useState(ids.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(
    () =>
      subscribeProjectRegistryMutation(({ generation }) => {
        setRegistryGeneration(generation);
      }),
    [],
  );

  const participantKey = ids.join("\u0000");
  const scopeKey = `${registryGeneration}:${participantKey}`;
  const loadedSuccessfully = ids.length > 0 && loadedScopeKey === scopeKey;
  const currentProjects = loadedSuccessfully ? projects : [];

  useEffect(() => {
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;
    setLoadedScopeKey(null);
    setProjects([]);
    setError(null);
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all(ids.map((id) => fetchProjectsFromCache(id)))
      .then((payloads) => {
        if (requestGenerationRef.current !== requestGeneration) return;
        const lists = payloads.map((payload) => {
          if (payload.ok === false) {
            throw new Error(payload.error ?? "Failed to load group projects");
          }
          return Array.isArray(payload.projects) ? payload.projects : [];
        });
        setProjects(intersectAccessibleProjects(lists));
        setLoadedScopeKey(scopeKey);
      })
      .catch((reason: unknown) => {
        if (requestGenerationRef.current !== requestGeneration) return;
        setError(reason instanceof Error ? reason.message : "Failed to load group projects");
      })
      .finally(() => {
        if (requestGenerationRef.current === requestGeneration) setLoading(false);
      });
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [ids, scopeKey]);

  return {
    projects: currentProjects,
    loading,
    error,
    loadedSuccessfully,
  };
}
