/**
 * A small, browser-safe cache for the data needed to render a surface's
 * landing state.  It deliberately has no React dependency: a coordinator can
 * warm resources after first paint and a surface can consume the same result.
 *
 * Failed requests are retained only as diagnostics. They are never returned as
 * a successful cache value, and the next read retries them.
 */

export type SurfaceResourceLoader<T> = (signal: AbortSignal) => Promise<T> | T;

export type SurfaceWarmCacheRead<T> = {
  data: T;
  cache: {
    key: string;
    /** `stale-fallback` means a previous value is being revalidated. */
    source: "network" | "cache" | "stale-fallback";
    fresh: boolean;
    stale: boolean;
    loading: boolean;
    fetchedAt: number;
    expiresAt: number;
  };
};

export type SurfaceWarmCacheEntrySnapshot = {
  key: string;
  status: "empty" | "loading" | "fresh" | "stale" | "error";
  hasValue: boolean;
  loading: boolean;
  fetchedAt?: number;
  expiresAt?: number;
  ttlMs: number;
  error?: unknown;
  erroredAt?: number;
};

export type SurfaceWarmCacheCounters = {
  reads: number;
  warmRequests: number;
  loads: number;
  successfulLoads: number;
  failedLoads: number;
  cacheHits: number;
  staleFallbacks: number;
  coalesced: number;
  invalidations: number;
  aborts: number;
};

export type SurfaceWarmCacheSnapshot = {
  counters: Readonly<SurfaceWarmCacheCounters>;
  entries: SurfaceWarmCacheEntrySnapshot[];
};

export type SurfaceWarmCache = {
  defineResource<T>(key: string, loader: SurfaceResourceLoader<T>, ttlMs: number): void;
  read<T>(key: string, options?: { force?: boolean }): Promise<SurfaceWarmCacheRead<T>>;
  warm<T>(key: string): Promise<SurfaceWarmCacheRead<T>>;
  invalidate(key: string): void;
  /** Abort one key, or every active request with `abort()` / `abort("all")`. */
  abort(key?: string | "all"): void;
  /** Abort only background-owned work; an active navigation read keeps running. */
  abortWarm(): void;
  snapshot(): SurfaceWarmCacheSnapshot;
};

type Resource = {
  key: string;
  loader: SurfaceResourceLoader<unknown>;
  ttlMs: number;
  generation: number;
  hasValue: boolean;
  value?: unknown;
  fetchedAt?: number;
  lastError?: unknown;
  erroredAt?: number;
  inFlight?: Promise<SurfaceWarmCacheRead<unknown>>;
  controller?: AbortController;
  warmInFlight?: boolean;
  warmRequest?: Promise<SurfaceWarmCacheRead<unknown>>;
  directConsumers: number;
};

const emptyCounters = (): SurfaceWarmCacheCounters => ({
  reads: 0,
  warmRequests: 0,
  loads: 0,
  successfulLoads: 0,
  failedLoads: 0,
  cacheHits: 0,
  staleFallbacks: 0,
  coalesced: 0,
  invalidations: 0,
  aborts: 0,
});

function abortError(reason: string): Error {
  const error = new Error(reason);
  error.name = "AbortError";
  return error;
}

/** Create an independent cache. The factory makes deterministic unit tests easy. */
export function createSurfaceWarmCache(options: { now?: () => number } = {}): SurfaceWarmCache {
  const now = options.now ?? Date.now;
  const resources = new Map<string, Resource>();
  const counters = emptyCounters();

  function resourceFor(key: string): Resource {
    const resource = resources.get(key);
    if (!resource) throw new Error(`Unknown surface warm resource: ${key}`);
    return resource;
  }

  function isFresh(resource: Resource, at = now()): boolean {
    return resource.hasValue && resource.fetchedAt !== undefined && at < resource.fetchedAt + resource.ttlMs;
  }

  function metadata(
    resource: Resource,
    source: SurfaceWarmCacheRead<unknown>["cache"]["source"],
    at = now(),
  ): SurfaceWarmCacheRead<unknown>["cache"] {
    const fetchedAt = resource.fetchedAt ?? at;
    const fresh = isFresh(resource, at);
    return {
      key: resource.key,
      source,
      fresh,
      stale: !fresh,
      loading: Boolean(resource.inFlight),
      fetchedAt,
      expiresAt: fetchedAt + resource.ttlMs,
    };
  }

  function result<T>(resource: Resource, source: SurfaceWarmCacheRead<unknown>["cache"]["source"]): SurfaceWarmCacheRead<T> {
    return { data: resource.value as T, cache: metadata(resource, source) };
  }

  function cancelRequest(resource: Resource): boolean {
    if (!resource.controller || resource.controller.signal.aborted) return false;
    counters.aborts += 1;
    resource.controller.abort();
    // Abort rejection is asynchronous. Clear these synchronously so an
    // invalidation or resume can start its replacement request instead of
    // coalescing onto the request that was just cancelled.
    resource.inFlight = undefined;
    resource.controller = undefined;
    resource.warmInFlight = false;
    resource.warmRequest = undefined;
    return true;
  }

  function load<T>(resource: Resource): Promise<SurfaceWarmCacheRead<T>> {
    if (resource.inFlight) {
      counters.coalesced += 1;
      return resource.inFlight as Promise<SurfaceWarmCacheRead<T>>;
    }

    const controller = new AbortController();
    const generation = resource.generation;
    counters.loads += 1;
    let loaderResult: Promise<unknown>;
    try {
      // Invoke the loader now (rather than on a later microtask) so a warm-up
      // coordinator can account for work immediately. Convert synchronous
      // throws to a rejected promise so cleanup below is still ordered.
      loaderResult = Promise.resolve(resource.loader(controller.signal));
    } catch (error) {
      loaderResult = Promise.reject(error);
    }
    const request = loaderResult.then(
      (value): SurfaceWarmCacheRead<unknown> => {
        // A loader cannot be required to observe AbortSignal. Do not let an
        // invalidated/aborted, late result repopulate the cache or reach a
        // caller that began before the mutation.
        if (resource.generation !== generation || controller.signal.aborted) {
          throw abortError("Surface warm resource was invalidated");
        }
        resource.value = value;
        resource.hasValue = true;
        resource.fetchedAt = now();
        resource.lastError = undefined;
        resource.erroredAt = undefined;
        counters.successfulLoads += 1;
        return result(resource, "network");
      },
      (error): never => {
        // An error has diagnostics value, but is deliberately not a cached
        // data value. A stale value may still be rendered by a normal read.
        if (resource.generation === generation) {
          resource.lastError = error;
          resource.erroredAt = now();
        }
        counters.failedLoads += 1;
        throw error;
      },
    );
    resource.inFlight = request;
    resource.controller = controller;
    void request.then(
      () => {
        if (resource.inFlight === request) {
          resource.inFlight = undefined;
          resource.controller = undefined;
        }
      },
      () => {
        if (resource.inFlight === request) {
          resource.inFlight = undefined;
          resource.controller = undefined;
        }
      },
    );
    return request as Promise<SurfaceWarmCacheRead<T>>;
  }

  function defineResource<T>(key: string, loader: SurfaceResourceLoader<T>, ttlMs: number): void {
    if (!key) throw new Error("Surface warm resource key is required");
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error("Surface warm resource TTL must be a non-negative finite number");

    const existing = resources.get(key);
    if (existing) {
      // HMR and tests may re-register a key. Treat a new definition as an
      // invalidation so an old loader's late result cannot win.
      cancelRequest(existing);
      existing.generation += 1;
      existing.loader = loader as SurfaceResourceLoader<unknown>;
      existing.ttlMs = ttlMs;
      existing.hasValue = false;
      existing.value = undefined;
      existing.fetchedAt = undefined;
      existing.lastError = undefined;
      existing.erroredAt = undefined;
      return;
    }
    resources.set(key, {
      key,
      loader: loader as SurfaceResourceLoader<unknown>,
      ttlMs,
      generation: 0,
      hasValue: false,
      directConsumers: 0,
    });
  }

  function trackDirect<T>(resource: Resource, request: Promise<SurfaceWarmCacheRead<T>>): Promise<SurfaceWarmCacheRead<T>> {
    resource.directConsumers += 1;
    return request.finally(() => { resource.directConsumers = Math.max(0, resource.directConsumers - 1); });
  }

  function read<T>(key: string, options: { force?: boolean } = {}): Promise<SurfaceWarmCacheRead<T>> {
    counters.reads += 1;
    const resource = resourceFor(key);
    if (!options.force && isFresh(resource)) {
      counters.cacheHits += 1;
      return Promise.resolve(result<T>(resource, "cache"));
    }

    if (!options.force && resource.hasValue) {
      // Cache-while-revalidate: navigation remains instant, while the stale
      // result is explicit so callers never mistake it for current data.
      counters.staleFallbacks += 1;
      void load(resource).catch(() => {});
      return Promise.resolve(result<T>(resource, "stale-fallback"));
    }
    return trackDirect(resource, load<T>(resource));
  }

  function warm<T>(key: string): Promise<SurfaceWarmCacheRead<T>> {
    counters.warmRequests += 1;
    const resource = resourceFor(key);
    if (isFresh(resource)) {
      counters.cacheHits += 1;
      return Promise.resolve(result<T>(resource, "cache"));
    }
    resource.warmInFlight = true;
    const request = load<T>(resource);
    resource.warmRequest = request as Promise<SurfaceWarmCacheRead<unknown>>;
    void request.finally(() => {
      if (resource.warmRequest === request) {
        resource.warmInFlight = false;
        resource.warmRequest = undefined;
      }
    }).catch(() => {});
    return request;
  }

  function invalidate(key: string): void {
    const resource = resourceFor(key);
    counters.invalidations += 1;
    resource.generation += 1;
    resource.hasValue = false;
    resource.value = undefined;
    resource.fetchedAt = undefined;
    resource.lastError = undefined;
    resource.erroredAt = undefined;
    cancelRequest(resource);
  }

  function abort(key?: string | "all"): void {
    const targets = key === undefined || key === "all" ? resources.values() : [resourceFor(key)];
    for (const resource of targets) {
      cancelRequest(resource);
    }
  }

  function abortWarm(): void {
    for (const resource of resources.values()) {
      if (!resource.warmInFlight || resource.directConsumers > 0 || !resource.controller || resource.controller.signal.aborted) continue;
      cancelRequest(resource);
    }
  }

  function snapshot(): SurfaceWarmCacheSnapshot {
    const at = now();
    return {
      counters: { ...counters },
      entries: [...resources.values()].map((resource) => {
        const fresh = isFresh(resource, at);
        const loading = Boolean(resource.inFlight);
        return {
          key: resource.key,
          status: loading ? "loading" : resource.hasValue ? (fresh ? "fresh" : "stale") : resource.lastError ? "error" : "empty",
          hasValue: resource.hasValue,
          loading,
          fetchedAt: resource.fetchedAt,
          expiresAt: resource.fetchedAt === undefined ? undefined : resource.fetchedAt + resource.ttlMs,
          ttlMs: resource.ttlMs,
          error: resource.lastError,
          erroredAt: resource.erroredAt,
        };
      }),
    };
  }

  return { defineResource, read, warm, invalidate, abort, abortWarm, snapshot };
}

/** Process-wide cache used by the surface warm-up coordinator and consumers. */
export const surfaceWarmCache = createSurfaceWarmCache();

export const defineResource = surfaceWarmCache.defineResource;
export const read = surfaceWarmCache.read;
export const warm = surfaceWarmCache.warm;
export const invalidate = surfaceWarmCache.invalidate;
export const abort = surfaceWarmCache.abort;
export const abortWarm = surfaceWarmCache.abortWarm;
export const surfaceWarmCacheSnapshot = surfaceWarmCache.snapshot;
