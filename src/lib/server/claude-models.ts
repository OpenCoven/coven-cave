import { spawn } from "node:child_process";
import {
  parseClaudeCodeVersion,
  withClaudeOpus5,
} from "../claude-models.ts";
import { canonicalProbeSpawnEnv, harnessSpawnEnv } from "../harness-spawn-env.ts";
import { catalogForRuntime, type RuntimeModelOption } from "../runtime-models.ts";
import { claudeProbeEnvironment } from "./claude-runtime-compatibility.ts";

const VERSION_TIMEOUT_MS = 2_500;
const FORCE_KILL_GRACE_MS = 250;
const MAX_VERSION_OUTPUT_BYTES = 4_096;
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_CONCURRENT_DISCOVERIES = 4;

const CLAUDE_MODEL_ENV_KEYS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
] as const;

type ClaudeModelDependencies = {
  spawnImpl?: typeof spawn;
  scopedEnv?: (
    familiarId?: string | null,
  ) => Record<string, string | undefined>;
  probeEnv?: () => Record<string, string | undefined>;
  timeoutMs?: number;
  forceKillGraceMs?: number;
  now?: () => number;
  cacheMs?: number;
  maxCacheEntries?: number;
  maxConcurrentDiscoveries?: number;
};

type CacheEntry = { expiresAt: number; models: RuntimeModelOption[] };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<{ models: RuntimeModelOption[] }>>();

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

function seedModels(): RuntimeModelOption[] {
  return [...(catalogForRuntime("claude")?.models ?? [])];
}

function modelEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    CLAUDE_MODEL_ENV_KEYS.flatMap((key) => {
      const value = env[key]?.trim();
      return value ? [[key, value]] : [];
    }),
  );
}

function cacheKey(
  familiarId: string | null | undefined,
  env: Record<string, string | undefined>,
): string {
  return JSON.stringify([
    familiarId ?? "",
    ...CLAUDE_MODEL_ENV_KEYS.map((key) => env[key] ?? ""),
  ]);
}

function readVersion(
  dependencies: ClaudeModelDependencies,
): Promise<string | null> {
  return new Promise((resolve) => {
    const spawnImpl = dependencies.spawnImpl ?? spawn;
    const timeoutMs = dependencies.timeoutMs ?? VERSION_TIMEOUT_MS;
    const forceKillGraceMs =
      dependencies.forceKillGraceMs ?? FORCE_KILL_GRACE_MS;
    let child: ReturnType<typeof spawn>;
    try {
      const sourceEnv = (dependencies.probeEnv ?? canonicalProbeSpawnEnv)();
      child = spawnImpl("claude", ["--version"], {
        env: claudeProbeEnvironment(sourceEnv) as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }

    let output = "";
    let outputBytes = 0;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const terminate = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        return;
      }
      forceKillTimer ??= setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process already exited.
        }
      }, forceKillGraceMs);
      forceKillTimer.unref?.();
    };
    const capture = (chunk: Buffer | string) => {
      if (settled) return;
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > MAX_VERSION_OUTPUT_BYTES) {
        terminate();
        finish(null);
        return;
      }
      output += text;
    };
    const timeout = setTimeout(() => {
      terminate();
      finish(null);
    }, timeoutMs);
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.once("error", () => finish(null));
    child.once("close", (code) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      finish(code === 0 ? output : null);
    });
  });
}

async function discoverClaudeModels(
  familiarId: string | null | undefined,
  providerEnv: Record<string, string | undefined>,
  dependencies: ClaudeModelDependencies,
): Promise<{ models: RuntimeModelOption[] }> {
  const versionOutput = await readVersion(dependencies);
  const models = withClaudeOpus5(seedModels(), {
    versionOutput,
    env: providerEnv,
  });
  if (parseClaudeCodeVersion(versionOutput)) {
    const now = dependencies.now ?? Date.now;
    const currentTime = now();
    pruneExpiredCache(currentTime);
    cacheModels(
      cacheKey(familiarId, providerEnv),
      {
        expiresAt: currentTime + (dependencies.cacheMs ?? CACHE_MS),
        models,
      },
      positiveLimit(dependencies.maxCacheEntries, MAX_CACHE_ENTRIES),
    );
  }
  // `claude --version` only proves that the CLI is installed. The remaining
  // entries are Cave's conservative seed (and an Opus 5 choice inferred from
  // provider configuration), not an authenticated provider model listing.
  // Keep this result degraded until Claude exposes a bounded entitlement
  // discovery path that can validate the complete inventory.
  return { models };
}

/** Return the Claude seed augmented only when this familiar's concrete
 * Claude Code/provider configuration can route Opus 5. Version probing is an
 * availability check, not a provider entitlement listing, so this adapter
 * never claims a live/cached inventory for its seed-derived result. */
export async function listClaudeModelInventory(
  familiarId?: string | null,
  dependencies: ClaudeModelDependencies = {},
): Promise<{ models: RuntimeModelOption[]; provenance: "live" | "cached" | "fallback" }> {
  let providerEnv: Record<string, string | undefined>;
  try {
    providerEnv = modelEnvironment(
      (dependencies.scopedEnv ?? harnessSpawnEnv)(familiarId),
    );
  } catch {
    return { models: seedModels(), provenance: "fallback" };
  }
  const key = cacheKey(familiarId, providerEnv);
  const now = dependencies.now ?? Date.now;
  pruneExpiredCache(now());
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return { models: [...cached.models], provenance: "fallback" };
  }
  const pending = inFlight.get(key);
  if (pending) {
    const result = await pending;
    return { models: [...result.models], provenance: "fallback" };
  }
  if (
    inFlight.size >= positiveLimit(
      dependencies.maxConcurrentDiscoveries,
      MAX_CONCURRENT_DISCOVERIES,
    )
  ) {
    return { models: seedModels(), provenance: "fallback" };
  }

  const discovery = discoverClaudeModels(
    familiarId,
    providerEnv,
    dependencies,
  ).finally(() => {
    if (inFlight.get(key) === discovery) inFlight.delete(key);
  });
  inFlight.set(key, discovery);
  const result = await discovery;
  return {
    models: [...result.models],
    provenance: "fallback",
  };
}

/** Compatibility projection for callers that only need the entries. */
export async function listClaudeModels(
  familiarId?: string | null,
  dependencies: ClaudeModelDependencies = {},
): Promise<RuntimeModelOption[]> {
  return (await listClaudeModelInventory(familiarId, dependencies)).models;
}

export function clearClaudeModelCache(): void {
  cache.clear();
  inFlight.clear();
}
