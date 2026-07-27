import type {
  CanonicalMemoryOverview,
  CanonicalMemorySummary,
} from "./canonical-memory.ts";
import {
  CanonicalMemoryRequestError,
  fetchCanonicalMemoryList,
  fetchCanonicalMemoryOverview,
} from "./canonical-memory-client.ts";
import {
  surfaceWarmCache,
  type SurfaceWarmCache,
  type SurfaceWarmCacheRead,
} from "./surface-warm-cache.ts";

const LIST_KEY = "canonical-memory:list";
const OVERVIEW_KEY = "canonical-memory:overview";

export type CanonicalMemoryListLoad =
  | { state: "ready"; entries: CanonicalMemorySummary[] }
  | { state: "error"; error: CanonicalMemoryRequestError };

export type CanonicalMemoryListReader = (
  force?: boolean,
) => Promise<SurfaceWarmCacheRead<CanonicalMemorySummary[]>>;

export type CanonicalMemoryOverviewLoad =
  | { state: "ready"; overview: CanonicalMemoryOverview }
  | { state: "error"; error: CanonicalMemoryRequestError };

export type CanonicalMemoryOverviewReader = (
  force?: boolean,
) => Promise<SurfaceWarmCacheRead<CanonicalMemoryOverview>>;

export type CanonicalMemoryRefreshResult = {
  list: CanonicalMemoryListLoad;
  overview: CanonicalMemoryOverviewLoad;
};

export function installCanonicalMemoryResources(
  cache: SurfaceWarmCache,
  client: {
    list(signal: AbortSignal): Promise<CanonicalMemorySummary[]>;
    overview(signal: AbortSignal): Promise<CanonicalMemoryOverview>;
  },
) {
  cache.defineResource("canonical-memory:list", client.list, 30_000);
  cache.defineResource("canonical-memory:overview", client.overview, 30_000);
}

installCanonicalMemoryResources(surfaceWarmCache, {
  list: fetchCanonicalMemoryList,
  overview: fetchCanonicalMemoryOverview,
});

export function readCanonicalMemoryList(
  force = false,
): Promise<SurfaceWarmCacheRead<CanonicalMemorySummary[]>> {
  return surfaceWarmCache.read<CanonicalMemorySummary[]>(LIST_KEY, { force });
}

export function readCanonicalMemoryOverview(
  force = false,
): Promise<SurfaceWarmCacheRead<CanonicalMemoryOverview>> {
  return surfaceWarmCache.read<CanonicalMemoryOverview>(OVERVIEW_KEY, { force });
}

function stableRequestError(error: unknown): CanonicalMemoryRequestError {
  return error instanceof CanonicalMemoryRequestError
    ? error
    : new CanonicalMemoryRequestError("invalid_daemon_payload", 0);
}

export function createCanonicalMemoryListLoader(
  readList: CanonicalMemoryListReader,
) {
  return async function loadCanonicalList(
    force = false,
  ): Promise<CanonicalMemoryListLoad> {
    try {
      let result = await readList(force);
      if (!force && result.cache.source === "stale-fallback") {
        // A normal stale read already started revalidation. A forced read joins
        // that in-flight request, so stale data never masquerades as ready.
        result = await readList(true);
      }
      return { state: "ready", entries: result.data };
    } catch (error) {
      return { state: "error", error: stableRequestError(error) };
    }
  };
}

const loadCanonicalList = createCanonicalMemoryListLoader(readCanonicalMemoryList);

export function loadCanonicalMemoryList(
  force = false,
): Promise<CanonicalMemoryListLoad> {
  return loadCanonicalList(force);
}

export function createCanonicalMemoryOverviewLoader(
  readOverview: CanonicalMemoryOverviewReader,
) {
  return async function loadCanonicalOverview(
    force = false,
  ): Promise<CanonicalMemoryOverviewLoad> {
    try {
      let result = await readOverview(force);
      if (!force && result.cache.source === "stale-fallback") {
        result = await readOverview(true);
      }
      return { state: "ready", overview: result.data };
    } catch (error) {
      return { state: "error", error: stableRequestError(error) };
    }
  };
}

const loadCanonicalOverview = createCanonicalMemoryOverviewLoader(
  readCanonicalMemoryOverview,
);

export function loadCanonicalMemoryOverview(
  force = false,
): Promise<CanonicalMemoryOverviewLoad> {
  return loadCanonicalOverview(force);
}

export function createCanonicalMemoryRefresher(
  readList: CanonicalMemoryListReader,
  readOverview: CanonicalMemoryOverviewReader,
) {
  return async function refreshCanonicalResources(): Promise<CanonicalMemoryRefreshResult> {
    const [list, overview] = await Promise.all([
      (async (): Promise<CanonicalMemoryListLoad> => {
        try {
          const result = await readList(true);
          return { state: "ready", entries: result.data };
        } catch (error) {
          return { state: "error", error: stableRequestError(error) };
        }
      })(),
      (async (): Promise<CanonicalMemoryOverviewLoad> => {
        try {
          const result = await readOverview(true);
          return { state: "ready", overview: result.data };
        } catch (error) {
          return { state: "error", error: stableRequestError(error) };
        }
      })(),
    ]);
    return { list, overview };
  };
}

const refreshCanonicalResources = createCanonicalMemoryRefresher(
  readCanonicalMemoryList,
  readCanonicalMemoryOverview,
);

export async function warmCanonicalMemory(): Promise<void> {
  await Promise.all([
    surfaceWarmCache.warm<CanonicalMemorySummary[]>(LIST_KEY),
    surfaceWarmCache.warm<CanonicalMemoryOverview>(OVERVIEW_KEY),
  ]);
}

export function refreshCanonicalMemory(): Promise<CanonicalMemoryRefreshResult> {
  return refreshCanonicalResources();
}

export function clearCanonicalMemoryResources(): void {
  surfaceWarmCache.invalidate(LIST_KEY);
  surfaceWarmCache.invalidate(OVERVIEW_KEY);
}
