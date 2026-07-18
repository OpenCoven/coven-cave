import type { CaveProject } from "./cave-projects-types.ts";
import { createSwrCache } from "./swr-cache.ts";

export type ProjectsPayload = { ok?: boolean; projects?: CaveProject[]; error?: string };

/**
 * Module-level dedupe for GET /api/projects (cave-v8hh). The hook has 8+
 * consumers (sidebar, chat views, board, composer, palette, modals) and no
 * shared store, so a surface mount fired the same request once per consumer —
 * traces showed 6 back-to-back copies. A short hard-TTL microcache collapses
 * a mount burst (plus dev StrictMode's double effects) onto one request per
 * scope. There is no steady poll on this endpoint, so the 2.5s window only
 * ever spans a burst; mutations advance the cache generation once, and
 * reload() bypasses the current generation entry.
 */
const CACHE_TTL_MS = 2500;
let projectsGeneration = 0;

// staleServeMs === ttlMs disables the serve-stale window (hard TTL).
const projectsCache = createSwrCache<ProjectsPayload>({
  ttlMs: CACHE_TTL_MS,
  staleServeMs: CACHE_TTL_MS,
});

async function requestProjects(familiarId: string | null): Promise<ProjectsPayload> {
  const url = familiarId
    ? `/api/projects?familiarId=${encodeURIComponent(familiarId)}`
    : "/api/projects";
  const res = await fetch(url);
  // Thrown (not returned) so HTTP failures are never cached — swr-cache only
  // stores resolutions — and every coalesced caller sees the same error.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ProjectsPayload;
}

function generationKey(familiarId: string | null): string {
  return `${projectsGeneration}:${familiarId ?? ""}`;
}

export function advanceProjectsCacheGeneration(): number {
  projectsGeneration += 1;
  projectsCache.clear();
  return projectsGeneration;
}

export function fetchProjectsFromCache(
  familiarId: string | null,
  opts?: { force?: boolean },
): Promise<ProjectsPayload> {
  const key = generationKey(familiarId);
  if (opts?.force) projectsCache.invalidate(key);
  return projectsCache.get(key, () => requestProjects(familiarId));
}

export function clearProjectsCache(): void {
  projectsCache.clear();
}

/** Test-only: exercise the shared projects cache without mounting the hook. */
export function fetchProjectsForTests(
  familiarId: string | null,
  opts?: { force?: boolean },
): Promise<ProjectsPayload> {
  return fetchProjectsFromCache(familiarId, opts);
}

/** Test-only: drop the module-level cache between cases. */
export function resetProjectsCacheForTests(): void {
  projectsCache.clear();
  projectsGeneration = 0;
}
