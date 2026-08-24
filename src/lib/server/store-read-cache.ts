/**
 * store-read-cache — stat-keyed read-through cache for Cave-owned `~/.coven`
 * JSON stores (cave-i65lt).
 *
 * Every one of `loadConfig`, `loadState`, `loadProjects`, `loadBoard`,
 * `loadProjectPermissions` and `readFamiliarWorkspaces` routes through
 * `withCaveHomeReconciledStores`, which per call reads and parses the migration
 * journal twice and then takes `withCaveHomeReconciliationLock`. That lock's
 * queue key is `migrationLockPath()` — ONE key for the whole process — so store
 * reads do not merely cost a lock cycle each, they serialize against every
 * other store read in flight. The `Promise.all([callDaemon, loadState,
 * loadProjects])` in `server/sessions-list.ts` is not actually parallel for its
 * two filesystem legs, and a single `computeSessionsList` pays the cycle at
 * least four times (`loadConfig` three of them). Under concurrent sessions this
 * is what produces `timed out waiting for local cave home reconciliation queue
 * after 15000ms`.
 *
 * None of those six loaders was memoized, so the cost was paid per request on
 * a four-second poll.
 *
 * ## Why a cache hit may skip the lock
 *
 * The lock exists to keep a read from straddling a migration replacement. A
 * hit here proves the file has not been replaced since the value was read:
 * the stat triple is unchanged, and migration replacements land through
 * `writeJsonAtomic` + `rename`, which always change it. So a hit is not
 * "reading without the lock" — it is not reading at all. Every miss takes the
 * unchanged full path, lock included, and every write keeps it.
 *
 * ## Why nanoseconds, and why a TTL on top
 *
 * `conversationSummaryCache` in `cave-conversations.ts` keys on millisecond
 * `mtimeMs`/`ctimeMs`/`size`. That is right for transcripts, which no one
 * rewrites twice in a millisecond. Config and state are rewritten by sweeps on
 * the response path, so this keys on `bigint` stat fields instead — `mtimeNs`
 * and `ctimeNs` are nanosecond-resolution on APFS and ext4 — and still caps
 * entries with a short TTL, for the filesystems that quantize coarser than they
 * report. Both guards are cheap; a wrong answer here is a config change the app
 * silently ignores.
 *
 * ## One asymmetry worth knowing about
 *
 * `withCaveHomeReconciliationLock` throws `EDEADLK` on a nested acquisition,
 * deliberately, rather than deadlocking. A cache hit does not acquire, so a
 * nested read that throws today would succeed on a hit and still throw on a
 * miss. No such nesting exists on the paths wired up here — a reader inside a
 * held lock would already be failing — but a future caller that introduces one
 * would get an intermittent failure rather than a reliable one. If that ever
 * surfaces, fix the nesting; do not make this cache pretend to hold a lock.
 *
 * ## Ordering
 *
 * The stat is taken BEFORE the load, deliberately. If the file changes during
 * the load, the value is stored under the older stat, so the next read misses
 * and reloads. Statting after the load would file a fresh-looking key against
 * possibly-older content, which is the one direction that can serve stale data.
 *
 * ## Every caller still gets its own object
 *
 * Today each loader returns a freshly parsed object, and callers are entitled
 * to treat it as theirs — `sessions-list.ts` and the archive sweeps both hand
 * the loaded state around and rewrite parts of it. Handing out one shared
 * reference would let any of them silently poison the cache for every later
 * reader, which is a far worse bug than the one this file exists to fix. So a
 * hit returns a `structuredClone`, preserving the existing contract exactly. A
 * clone is pure CPU on an already-parsed object; the cost this removes is a
 * serialized lock cycle plus four file reads.
 */

import { stat } from "node:fs/promises";

export type StoreReadCacheMetrics = {
  /** Reads served from cache without touching the reconciliation lock. */
  hits: number;
  /** Reads that fell through to the full locked loader. */
  misses: number;
  /** Reads whose stat failed (ENOENT and friends); never cached. */
  statFailures: number;
  /** Distinct store paths currently held. */
  entries: number;
};

/**
 * Entries older than this are re-read even when the stat triple is unchanged.
 * Short because the only thing it defends against is a filesystem whose
 * timestamp resolution is coarser than the write rate; the stat key does the
 * real work.
 */
const DEFAULT_TTL_MS = 1_000;

type Entry = {
  mtimeNs: bigint;
  ctimeNs: bigint;
  size: bigint;
  readAt: number;
  value: unknown;
};

const entries = new Map<string, Entry>();
let hits = 0;
let misses = 0;
let statFailures = 0;

export function getStoreReadCacheMetrics(): StoreReadCacheMetrics {
  return { hits, misses, statFailures, entries: entries.size };
}

export function resetStoreReadCacheMetrics(): void {
  hits = 0;
  misses = 0;
  statFailures = 0;
}

/**
 * Drop one store's cached value. Call from every write path that replaces the
 * file, so a same-process mutation is visible on the next read instead of
 * waiting for the stat to be observed.
 */
export function invalidateCachedStore(filePath: string): void {
  entries.delete(filePath);
}

/** Drop everything. Tests that repoint `COVEN_HOME` must call this. */
export function clearCaveStoreReadCache(): void {
  entries.clear();
  resetStoreReadCacheMetrics();
}

/**
 * Read a store through the cache. `load` is the existing locked loader and is
 * called unchanged on every miss.
 */
export async function readCachedStore<T>(
  filePath: string,
  load: () => Promise<T>,
  options: { ttlMs?: number; now?: () => number } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;

  let stats: { mtimeNs: bigint; ctimeNs: bigint; size: bigint } | null = null;
  try {
    // `turbopackIgnore` because this path is a runtime value, and Turbopack
    // otherwise treats a dynamic filesystem access as a reason to trace the
    // whole project ("Dynamic filesystem access causes tracing of the whole
    // project"). That matters more here than at most call sites: `writeFileAtomic`
    // imports this module, so without the annotation every route that writes a
    // store would inherit whole-project tracing — and in this checkout
    // `.worktrees` alone matches ~237k files. Same convention as
    // `server/agent-attachments.ts` and `server/assist-runner.ts`.
    const raw = await stat(/* turbopackIgnore: true */ filePath, { bigint: true });
    stats = { mtimeNs: raw.mtimeNs, ctimeNs: raw.ctimeNs, size: raw.size };
  } catch {
    // ENOENT is the ordinary cold-start shape: the loader returns defaults.
    // A store with no file has no stat to key on, so it is never cached — the
    // moment it appears, the very next read must see it.
    statFailures += 1;
    entries.delete(filePath);
    return load();
  }

  const cached = entries.get(filePath);
  if (
    cached &&
    cached.mtimeNs === stats.mtimeNs &&
    cached.ctimeNs === stats.ctimeNs &&
    cached.size === stats.size &&
    now() - cached.readAt <= ttlMs
  ) {
    const copy = cloneStoreValue(cached.value);
    if (copy.ok) {
      hits += 1;
      return copy.value as T;
    }
    // A store holding something structuredClone cannot copy would otherwise be
    // shared by reference. Drop it and take the honest path instead.
    entries.delete(filePath);
  }

  misses += 1;
  const value = await load();
  // The cache keeps its OWN copy and the caller keeps the loader's object.
  // Storing the caller's reference instead would let whoever triggered the
  // miss mutate the entry every later reader is served — the same poisoning
  // the hit path clones to avoid, just one read earlier. A value that cannot
  // be copied is simply not cached.
  const stored = cloneStoreValue(value);
  if (stored.ok) entries.set(filePath, { ...stats, readAt: now(), value: stored.value });
  return value;
}

function cloneStoreValue(value: unknown): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: structuredClone(value) };
  } catch {
    return { ok: false };
  }
}
