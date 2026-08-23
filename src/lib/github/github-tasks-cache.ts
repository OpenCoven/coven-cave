export const GITHUB_TASKS_TTL_MS = 60_000;

type CacheEntry = {
  endpoint: string;
  data: unknown;
  etag: string | null;
  fetchedAt: number;
};

export type GitHubTasksCacheResult = {
  data: unknown;
  freshness: "fresh" | "stale";
  source: "hit" | "upstream" | "revalidated" | "stale";
};

type CacheOptions = {
  ttlMs?: number;
  now?: () => number;
  fetcher?: typeof fetch;
};

/**
 * Process-local cache for coven-github's task feed. A factory keeps the cache
 * independently testable; the exported singleton below is shared by every
 * request handled by this Cave server process.
 */
export function createGitHubTasksCache(options: CacheOptions = {}) {
  const ttlMs = options.ttlMs ?? GITHUB_TASKS_TTL_MS;
  const now = options.now ?? Date.now;
  const fetcher: typeof fetch = options.fetcher ?? ((input, init) => fetch(input, init));
  let cached: CacheEntry | null = null;
  let inFlight: Promise<{ data: unknown; source: "upstream" | "revalidated" }> | null = null;

  async function refresh(endpoint: string): Promise<{ data: unknown; source: "upstream" | "revalidated" }> {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const previous = cached?.endpoint === endpoint ? cached : null;
      const headers: HeadersInit = previous?.etag ? { "If-None-Match": previous.etag } : {};
      const res = await fetcher(endpoint, { cache: "no-store", headers });

      if (res.status === 304 && previous) {
        cached = { ...previous, fetchedAt: now() };
        return { data: previous.data, source: "revalidated" as const };
      }

      const data = await res.json().catch(() => null);
      if (!res.ok || data == null || (typeof data === "object" && "ok" in data && data.ok === false)) {
        throw new Error(`coven-github returned ${res.status}`);
      }

      cached = {
        endpoint,
        data,
        etag: res.headers.get("etag"),
        fetchedAt: now(),
      };
      return { data, source: "upstream" as const };
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  async function read(endpoint: string, opts: { force?: boolean } = {}): Promise<GitHubTasksCacheResult> {
    const previous = cached?.endpoint === endpoint ? cached : null;

    if (!opts.force && previous) {
      if (now() - previous.fetchedAt < ttlMs) {
        return { data: previous.data, freshness: "fresh", source: "hit" };
      }

      // Stale-while-revalidate: callers get useful task context immediately,
      // and every simultaneous caller joins the same background refresh.
      void refresh(endpoint).catch(() => undefined);
      return { data: previous.data, freshness: "stale", source: "stale" };
    }

    try {
      const result = await refresh(endpoint);
      return { ...result, freshness: "fresh" };
    } catch (error) {
      // An upstream failure must not erase the last-known-good task context.
      if (previous) return { data: previous.data, freshness: "stale", source: "stale" };
      throw error;
    }
  }

  return { read };
}

const githubTasksCache = createGitHubTasksCache();

export function getGitHubTasks(endpoint: string) {
  return githubTasksCache.read(endpoint);
}

export function forceGitHubTasksRefresh(endpoint: string) {
  return githubTasksCache.read(endpoint, { force: true });
}
