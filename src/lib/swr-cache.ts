/**
 * Small stale-while-revalidate async cache (cave-5m1c).
 *
 * Built for /api/sessions/list, whose 2s TTL sat under the workspace's 4s
 * poll — every poll missed the cache and paid the full daemon + git + sweep
 * recompute on the response path. With SWR the poll is served instantly from
 * the last computed payload while one background recompute refreshes it, so
 * steady-state pollers never wait on the compute and concurrent callers share
 * a single in-flight computation.
 *
 * Semantics:
 *  - fresh (age <= ttlMs): serve cached, no recompute
 *  - stale (ttlMs < age <= staleServeMs), entry marked servable: serve cached
 *    immediately AND kick one background revalidation
 *  - expired (age > staleServeMs) or never computed: caller awaits the
 *    compute (deduped with any concurrent caller of the same key)
 *  - entries the caller marks non-servable (e.g. error payloads) are never
 *    served stale — callers re-await the compute instead of pinning a
 *    transient failure for the whole stale window
 */

export type SwrCache<T> = {
  get(key: string, compute: () => Promise<T>): Promise<T>;
  /** Drop every cached entry (state resets in tests / config changes). */
  clear(): void;
};

export function createSwrCache<T>(options: {
  /** Serve without recompute while an entry is younger than this. */
  ttlMs: number;
  /** Serve stale + revalidate in background up to this age; beyond it, block. */
  staleServeMs: number;
  /** Entries failing this predicate are never served stale. Default: all pass. */
  canServeStale?: (value: T) => boolean;
  /** Injectable clock for tests. */
  now?: () => number;
}): SwrCache<T> {
  const { ttlMs, staleServeMs } = options;
  const canServeStale = options.canServeStale ?? (() => true);
  const now = options.now ?? Date.now;

  type Entry = { computedAt: number; value: T };
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<T>>();

  function revalidate(key: string, compute: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = compute().then((value) => {
      entries.set(key, { computedAt: now(), value });
      return value;
    });
    inFlight.set(key, promise);
    void promise.catch(() => undefined).then(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    return promise;
  }

  return {
    async get(key, compute) {
      const entry = entries.get(key);
      const age = entry ? now() - entry.computedAt : Infinity;
      if (entry && age <= ttlMs) return entry.value;
      if (entry && age <= staleServeMs && canServeStale(entry.value)) {
        // Serve stale, revalidate in the background. Swallow background
        // failures — the stale value stays until a later compute succeeds.
        revalidate(key, compute).catch(() => undefined);
        return entry.value;
      }
      return revalidate(key, compute);
    },
    clear() {
      entries.clear();
    },
  };
}
