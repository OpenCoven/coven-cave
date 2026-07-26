/**
 * Shared SWR cache for /api/sessions/list (cave-5m1c), plus its invalidation
 * hook (cave-53yx).
 *
 * The cache exists because the old plain 2s TTL sat under the workspace's 4s
 * poll, so effectively EVERY poll missed and paid the full daemon + git +
 * archive-sweep recompute on the response path. Now a poll inside the fresh
 * window is a pure cache hit; a poll after it is served the previous payload
 * instantly while one background recompute refreshes it — steady-state pollers
 * never wait on the compute. Error payloads are never served stale (a
 * transient daemon failure must not pin a 503 for the whole stale window), and
 * concurrent callers still share one in-flight compute.
 *
 * It lives here (not in the route file, which may only export handlers) so
 * mutation paths can bust it: without invalidation, event-driven client
 * refreshes — exactly the requests fired right after a mutation — were served
 * the pre-mutation payload and the change appeared only 1-2 polls later
 * (~4-8s perceived lag). Session mutators in cave-config / cave-conversations
 * and the daemon-side mutation routes call `invalidateSessionsListCache()` so
 * the next list request recomputes.
 *
 * Invalidation drops EVERY cached view rather than a targeted key: one
 * session mutation can affect the active and archived views, any number of
 * familiar-scoped views, and both collapse modes — working out which keys
 * contain the session is the same work the compute itself does, and there are
 * only a handful of keys.
 */
import { createSwrCache } from "../swr-cache.ts";
import type { SessionRow } from "../types.ts";

export type SessionsListPayload =
  | {
      ok: true;
      degraded?: boolean;
      error?: string;
      sessions: SessionRow[];
    }
  | {
      ok: false;
      error: string;
      sessions: [];
    };

export type SessionsListResult = {
  payload: SessionsListPayload;
  init?: ResponseInit;
};

const SESSIONS_LIST_CACHE_MS = 2000;
const SESSIONS_LIST_STALE_SERVE_MS = 30_000;

export const sessionsListCache = createSwrCache<SessionsListResult>({
  ttlMs: SESSIONS_LIST_CACHE_MS,
  staleServeMs: SESSIONS_LIST_STALE_SERVE_MS,
  canServeStale: (result) => result.payload.ok,
});

/**
 * Bust every cached sessions-list view so the next request recomputes.
 * Call after any mutation that changes what the list returns: conversation
 * save/delete, session create, archive/summon, keep, title, sacrifice, kill,
 * prune. Do NOT call from the auto-archive sweeps — they run INSIDE the list
 * compute (their result is already folded into the returned rows via
 * applySweptRows), and invalidating mid-compute would version-bump the entry
 * away and leave the cache permanently cold.
 */
export function invalidateSessionsListCache(): void {
  sessionsListCache.clear();
}
