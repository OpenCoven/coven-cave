import {
  openCovenToolStatuses,
  type NpmLatestCheckError,
  type OpenCovenToolStatus,
} from "./opencoven-tools-status.ts";

export const OPEN_COVEN_UPDATE_TTL_MS = 10 * 60 * 1000;

export type OpenCovenUpdateError = NpmLatestCheckError | "unknown";
export type OpenCovenUpdateFreshness = "fresh" | "stale" | "unavailable";

export type OpenCovenUpdateSnapshot = {
  tools: OpenCovenToolStatus[];
  checkedAt: string | null;
  freshness: OpenCovenUpdateFreshness;
  stale: boolean;
  refreshing: boolean;
  error: OpenCovenUpdateError | null;
};

type SuccessfulEntry = {
  tools: OpenCovenToolStatus[];
  checkedAt: string;
  storedAt: number;
};

type CacheDependencies = {
  load?: () => Promise<OpenCovenToolStatus[]>;
  now?: () => number;
  ttlMs?: number;
};

function latestFailure(tools: OpenCovenToolStatus[]): OpenCovenUpdateError | null {
  const failed = tools.find((tool) => tool.latestCheck.status === "failed");
  return failed?.latestCheck.status === "failed" ? failed.latestCheck.error : null;
}

function latestCheckedAt(tools: OpenCovenToolStatus[]): string | null {
  return tools
    .map((tool) => tool.latestCheck.checkedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

/** Process-local SWR cache. The factory is exported so timing, failures, and
 * concurrency can be verified without launching npm in tests. */
export function createOpenCovenToolUpdateCache(dependencies: CacheDependencies = {}) {
  const load = dependencies.load ?? openCovenToolStatuses;
  const now = dependencies.now ?? Date.now;
  const ttlMs = dependencies.ttlMs ?? OPEN_COVEN_UPDATE_TTL_MS;
  let successful: SuccessfulEntry | null = null;
  let successfulStale = false;
  let unavailableTools: OpenCovenToolStatus[] = [];
  let unavailableCheckedAt: string | null = null;
  let unavailableStoredAt: number | null = null;
  let lastError: OpenCovenUpdateError | null = null;
  let inFlight: Promise<OpenCovenUpdateSnapshot> | null = null;
  let generation = 0;

  const fromSuccess = (
    freshness: "fresh" | "stale",
    refreshing = false,
    error: OpenCovenUpdateError | null = lastError,
  ): OpenCovenUpdateSnapshot => ({
    tools: successful?.tools ?? [],
    checkedAt: successful?.checkedAt ?? null,
    freshness,
    stale: freshness === "stale",
    refreshing,
    error,
  });

  const unavailable = (refreshing = false): OpenCovenUpdateSnapshot => ({
    tools: unavailableTools,
    checkedAt: unavailableCheckedAt,
    freshness: "unavailable",
    stale: false,
    refreshing,
    error: lastError,
  });

  const refresh = (): Promise<OpenCovenUpdateSnapshot> => {
    if (inFlight) return inFlight;
    const requestGeneration = generation;
    const request = load()
      .then((tools) => {
        if (requestGeneration !== generation) {
          return successful ? fromSuccess("stale", false, lastError) : unavailable();
        }
        const checkedAt = latestCheckedAt(tools);
        const error = latestFailure(tools);
        if (error || !checkedAt) {
          unavailableTools = tools;
          unavailableCheckedAt = checkedAt;
          unavailableStoredAt = now();
          lastError = error ?? "unknown";
          if (successful) successfulStale = true;
          return successful ? fromSuccess("stale", false, lastError) : unavailable();
        }
        successful = { tools, checkedAt, storedAt: now() };
        successfulStale = false;
        unavailableTools = [];
        unavailableCheckedAt = null;
        unavailableStoredAt = null;
        lastError = null;
        return fromSuccess("fresh", false, null);
      })
      .catch(() => {
        if (requestGeneration !== generation) {
          return successful ? fromSuccess("stale", false, lastError) : unavailable();
        }
        lastError = "unknown";
        unavailableStoredAt = now();
        if (successful) successfulStale = true;
        return successful ? fromSuccess("stale", false, lastError) : unavailable();
      })
      .finally(() => {
        if (inFlight === request) inFlight = null;
      });
    inFlight = request;
    return request;
  };

  return {
    async get(): Promise<OpenCovenUpdateSnapshot> {
      if (!successful) {
        if (unavailableStoredAt !== null && now() - unavailableStoredAt < ttlMs) {
          return unavailable();
        }
        return refresh();
      }
      if (successfulStale) {
        void refresh();
        return fromSuccess("stale", true, lastError);
      }
      if (now() - successful.storedAt < ttlMs) return fromSuccess("fresh", false, null);
      void refresh();
      return fromSuccess("stale", true, lastError);
    },
    force(): Promise<OpenCovenUpdateSnapshot> {
      return refresh();
    },
    invalidate(): void {
      generation += 1;
      inFlight = null;
      successful = null;
      successfulStale = false;
      unavailableTools = [];
      unavailableCheckedAt = null;
      unavailableStoredAt = null;
      lastError = null;
    },
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __openCovenToolUpdateCache:
    | ReturnType<typeof createOpenCovenToolUpdateCache>
    | undefined;
}

function sharedCache() {
  return (globalThis.__openCovenToolUpdateCache ??=
    createOpenCovenToolUpdateCache());
}

export function getOpenCovenToolUpdates(): Promise<OpenCovenUpdateSnapshot> {
  return sharedCache().get();
}

export function forceOpenCovenToolUpdateCheck(): Promise<OpenCovenUpdateSnapshot> {
  return sharedCache().force();
}

export function invalidateOpenCovenToolUpdateCache(): void {
  sharedCache().invalidate();
}
