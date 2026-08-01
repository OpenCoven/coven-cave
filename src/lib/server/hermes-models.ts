import { createHash } from "node:crypto";
import { cleanModelId, isSyntheticLocalModel } from "../chat-model-state.ts";
import { harnessSpawnEnv } from "../harness-spawn-env.ts";
import {
  hermesApiConfig,
  hermesResponsesUrl,
  type HermesApiConfig,
} from "../hermes-responses-stream.ts";
import type { RuntimeModelOption } from "../runtime-models.ts";

const MODEL_LIST_TIMEOUT_MS = 2_500;
const MAX_MODEL_LIST_BYTES = 512 * 1024;
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_CONCURRENT_DISCOVERIES = 4;

type HermesModelDependencies = {
  fetchImpl?: typeof fetch;
  scopedEnv?: (
    familiarId?: string | null,
  ) => Record<string, string | undefined>;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
  cacheMs?: number;
  maxCacheEntries?: number;
  maxConcurrentDiscoveries?: number;
};

type CacheEntry = { expiresAt: number; models: RuntimeModelOption[] };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RuntimeModelOption[]>>();

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function pruneExpiredCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function cacheModels(
  key: string,
  entry: CacheEntry,
  maxEntries: number,
): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function hermesScopeKey(
  familiarId: string | null | undefined,
  config: HermesApiConfig,
): string {
  const credentialFingerprint = createHash("sha256")
    .update(config.apiKey)
    .digest("hex");
  return `${familiarId ?? ""}\u0000${config.baseUrl}\u0000${credentialFingerprint}`;
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new Error("Hermes model request timed out"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("Hermes model request timed out"));
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

async function readBoundedPayload(
  response: Response,
  controller: AbortController,
  maxBytes: number,
): Promise<unknown | null> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    controller.abort();
    try {
      await response.body?.cancel();
    } catch {
      // The aborted fetch already released the response body.
    }
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, controller.signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        controller.abort();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  } finally {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      // A completed or aborted response needs no further cleanup.
    }
  }
}

async function discoverHermesModels(
  config: HermesApiConfig,
  dependencies: HermesModelDependencies,
): Promise<RuntimeModelOption[]> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    dependencies.timeoutMs ?? MODEL_LIST_TIMEOUT_MS,
  );
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(
      hermesResponsesUrl(config).replace(/\/responses$/, "/models"),
      {
        headers: { authorization: `Bearer ${config.apiKey}` },
        signal: controller.signal,
        redirect: "error",
      },
    );
    if (!response.ok) {
      controller.abort();
      try {
        await response.body?.cancel();
      } catch {
        // The aborted fetch already released the response body.
      }
      return [];
    }
    const payload = await readBoundedPayload(
      response,
      controller,
      dependencies.maxBytes ?? MAX_MODEL_LIST_BYTES,
    );
    const data = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { data?: unknown }).data
      : null;
    if (!Array.isArray(data)) return [];

    const models = new Map<string, RuntimeModelOption>();
    for (const item of data) {
      const id = cleanModelId(
        item && typeof item === "object"
          ? (item as { id?: unknown }).id
          : null,
      );
      if (id && !isSyntheticLocalModel(id, "hermes")) {
        models.set(id, { id, label: id });
      }
    }
    return [...models.values()];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Read the familiar-scoped provider inventory for a bare-local Hermes
 * binding. The caller owns the profile/SSH gate; this resolver validates the
 * endpoint and caches only successful results against its credential scope. */
export async function listHermesModelInventory(
  familiarId?: string | null,
  dependencies: HermesModelDependencies = {},
): Promise<{ models: RuntimeModelOption[]; provenance: "live" | "cached" }> {
  let config: HermesApiConfig | null;
  try {
    const env = (dependencies.scopedEnv ?? harnessSpawnEnv)(familiarId);
    config = hermesApiConfig({
      HERMES_API_URL: env.HERMES_API_URL,
      HERMES_API_KEY: env.HERMES_API_KEY,
    });
  } catch {
    return { models: [], provenance: "live" };
  }
  if (!config) return { models: [], provenance: "live" };

  const key = hermesScopeKey(familiarId, config);
  const now = (dependencies.now ?? Date.now)();
  pruneExpiredCache(now);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return { models: [...cached.models], provenance: "cached" };
  }
  const pending = inFlight.get(key);
  if (pending) return { models: [...await pending], provenance: "live" };
  if (
    inFlight.size >= positiveLimit(
      dependencies.maxConcurrentDiscoveries,
      MAX_CONCURRENT_DISCOVERIES,
    )
  ) {
    return { models: [], provenance: "live" };
  }

  const discovery = discoverHermesModels(config, dependencies)
    .then((models) => {
      if (models.length > 0) {
        const cachedAt = (dependencies.now ?? Date.now)();
        pruneExpiredCache(cachedAt);
        cacheModels(
          key,
          {
            expiresAt: cachedAt + positiveLimit(dependencies.cacheMs, CACHE_MS),
            models,
          },
          positiveLimit(dependencies.maxCacheEntries, MAX_CACHE_ENTRIES),
        );
      }
      return models;
    })
    .finally(() => {
      if (inFlight.get(key) === discovery) inFlight.delete(key);
    });
  inFlight.set(key, discovery);
  return { models: [...await discovery], provenance: "live" };
}

/** Compatibility projection for callers that only need the entries. */
export async function listHermesModels(
  familiarId?: string | null,
  dependencies: HermesModelDependencies = {},
): Promise<RuntimeModelOption[]> {
  return (await listHermesModelInventory(familiarId, dependencies)).models;
}

export function clearHermesModelCache(): void {
  cache.clear();
  inFlight.clear();
}
