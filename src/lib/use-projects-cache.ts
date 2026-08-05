import { sortProjectsAlphabetically, type CaveProject } from "./cave-projects-types.ts";
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
  const payload = (await res.json()) as ProjectsPayload;
  return normalizePayload(payload);
}

/**
 * Dedupe + sort ONCE per fetch, here, rather than once per consumer.
 *
 * `useProjects()` has 20+ call sites and the cache already collapses their
 * mount burst onto a single request — but each consumer was still running
 * `sortProjectsAlphabetically` over the whole list when that one response
 * resolved, so the O(n log n) ran once per consumer for identical input.
 * Normalizing inside the cache also means every coalesced caller receives the
 * SAME array instance, which keeps referential equality stable for memoized
 * consumers instead of handing each one a fresh copy.
 *
 * Safe to share because nothing mutates the list in place: the only in-place
 * sort over projects (comux-projects) builds its own objects from sessions.
 */
function normalizePayload(payload: ProjectsPayload): ProjectsPayload {
  if (payload.ok === false) return payload;
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  followRootMoves(projects);
  return { ...payload, projects: sortProjectsAlphabetically(projects) };
}

/**
 * Follow any root the server re-normalized, once (cave-2x1em).
 *
 * This is the single choke point every project consumer funnels through, which
 * is why the migration hangs here rather than in a component: 20+ call sites
 * would otherwise each need to remember to run it.
 *
 * Deliberately NOT awaited. The payload is already correct — the server serves
 * the expanded root — so nothing on screen waits for a re-key of local avatar
 * and override records. A failure leaves the old keys in place and the next
 * load retries; the migration is idempotent and reports 0 when there is
 * nothing to do.
 */
let rootMoveMigration: Promise<unknown> | null = null;
function followRootMoves(projects: readonly CaveProject[]): void {
  if (typeof window === "undefined") return;
  if (rootMoveMigration) return; // one at a time; a concurrent fetch is not a second migration
  if (
    !projects.some(
      (project) =>
        project.legacyRoot ||
        project.legacyRoots?.length ||
        project.legacyProjectIds?.length,
    )
  ) {
    return;
  }
  rootMoveMigration = import("./project-root-migration.ts")
    .then((mod) => mod.migrateAndAcknowledgeProjectRoots(projects))
    .catch((error) => {
      console.error("project migration failed; pending aliases will retry", error);
    })
    .finally(() => {
      rootMoveMigration = null;
    });
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
