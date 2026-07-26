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
  /**
   * Drop one key's cached entry so the next `get` recomputes against a new
   * version. Older in-flight computes are left to finish for their original
   * callers, but they are never reused for the new version and cannot
   * repopulate the current cache entry after they resolve.
   */
  invalidate(key: string): void;
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
  const inFlight = new Map<string, Map<number, Promise<T>>>();
  const versions = new Map<string, number>();
  let nextVersion = 1;

  function currentVersion(key: string): number {
    let version = versions.get(key);
    if (version === undefined) {
      version = nextVersion++;
      versions.set(key, version);
    }
    return version;
  }

  function bumpVersion(key: string): number {
    const version = nextVersion++;
    versions.set(key, version);
    return version;
  }

  function revalidate(key: string, compute: () => Promise<T>, version = currentVersion(key)): Promise<T> {
    const existing = inFlight.get(key)?.get(version);
    if (existing) return existing;
    const promise = compute().then((value) => {
      if (versions.get(key) === version) entries.set(key, { computedAt: now(), value });
      return value;
    });
    let perKey = inFlight.get(key);
    if (!perKey) {
      perKey = new Map();
      inFlight.set(key, perKey);
    }
    perKey.set(version, promise);
    void promise.catch(() => undefined).then(() => {
      const pending = inFlight.get(key);
      if (!pending) return;
      if (pending.get(version) === promise) pending.delete(version);
      if (pending.size === 0) inFlight.delete(key);
    });
    return promise;
  }

  return {
    async get(key, compute) {
      const version = currentVersion(key);
      const entry = entries.get(key);
      const age = entry ? now() - entry.computedAt : Infinity;
      if (entry && age <= ttlMs) return entry.value;
      if (entry && age <= staleServeMs && canServeStale(entry.value)) {
        // Serve stale, revalidate in the background. Swallow background
        // failures — the stale value stays until a later compute succeeds.
        revalidate(key, compute, version).catch(() => undefined);
        return entry.value;
      }
      return revalidate(key, compute, version);
    },
    invalidate(key) {
      entries.delete(key);
      bumpVersion(key);
    },
    clear() {
      entries.clear();
      for (const key of new Set([...versions.keys(), ...inFlight.keys()])) bumpVersion(key);
    },
  };
}
