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
 * its inode metadata and content digest are unchanged. Migration replacements
 * land through `writeJsonAtomic` + `rename`, which changes the inode. A hit
 * reads bytes once to verify that digest, but it still skips the reconciliation
 * lock, migration journal reads, and JSON parsing. Every miss takes the
 * unchanged full path, lock included, and every write keeps it.
 *
 * ## Why a content digest, and why a TTL on top
 *
 * Node exposes nanosecond stat fields, but that does not mean the backing
 * filesystem advances them every nanosecond. In WSL this test suite observed
 * same-size rewrites in one host clock tick where every exposed stat identity
 * field remained equal. No metadata-only key can detect that write. The cache
 * therefore verifies a SHA-256 digest before serving a hit. This still avoids
 * the reconciliation lock and JSON parsing that dominate these reads, while
 * making an external rewrite visible immediately. A short TTL remains as a
 * final bound on the lifetime of any cache entry.
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
 * The identity is taken BEFORE the load, deliberately. If the file changes
 * during the load, the value is stored under the older identity, so the next
 * read misses and reloads. Inspecting after the load would file a fresh-looking
 * key against possibly-older content, which is the one direction that can
 * serve stale data.
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
 * serialized lock cycle, repeated journal reads, and JSON parsing.
 */

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

export type StoreReadCacheMetrics = {
  /** Reads served from cache without touching the reconciliation lock. */
  hits: number;
  /** Reads that fell through to the full locked loader. */
  misses: number;
  /** Reads whose identity probe failed (ENOENT and friends); never cached. */
  statFailures: number;
  /** Entries dropped to stay under a caller's `maxBytes`. */
  evictions: number;
  /** Distinct store paths currently held. */
  entries: number;
  /** Sum of the cached files' on-disk sizes, the quantity `maxBytes` bounds. */
  cachedBytes: number;
};

/**
 * Entries older than this are re-read even when their identity is unchanged.
 */
const DEFAULT_TTL_MS = 1_000;

type Entry = {
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  size: bigint;
  digest: string;
  readAt: number;
  value: unknown;
};

type FileIdentity = Pick<Entry, "dev" | "ino" | "mtimeNs" | "ctimeNs" | "size" | "digest">;

type StoreReadCacheOptions = {
  ttlMs?: number;
  now?: () => number;
  maxBytes?: number;
  /** Test seam for deterministic metadata-collision coverage. */
  inspectFile?: (filePath: string) => Promise<FileIdentity>;
};

async function inspectStoreFile(filePath: string): Promise<FileIdentity> {
  // Read through one descriptor so the metadata and bytes identify the same
  // inode even when an atomic replacement races this probe. WSL filesystems
  // can report identical timestamp nanoseconds for two writes in one host
  // clock tick; the digest is the only truthful discriminator in that case.
  const handle = await open(/* turbopackIgnore: true */ filePath, "r");
  try {
    const stats = await handle.stat({ bigint: true });
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return {
      dev: stats.dev,
      ino: stats.ino,
      mtimeNs: stats.mtimeNs,
      ctimeNs: stats.ctimeNs,
      size: stats.size,
      digest: hash.digest("base64url"),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Unbounded by default, which is right for the handful of fixed `~/.coven`
 * store paths this started with: there are six of them and they all stay hot.
 *
 * A caller reading paths drawn from user data must pass `maxBytes`. The bound
 * is BYTES rather than an entry count on purpose: conversation transcripts are
 * the motivating caller, the set is the user's whole chat history, and a single
 * transcript can exceed the 8 MiB `MAX_TURNS_PAYLOAD_BYTES` that bounds one
 * write route — so "24 entries" could mean anything from a few KB to hundreds
 * of MB against a sidecar running on a pinned heap. The file's `size` is
 * already in hand from the stat this function must take anyway, so a byte bound
 * costs nothing extra to maintain and actually describes the resource at risk.
 *
 * It is an approximation in one direction only: the parsed object is larger
 * than its JSON text, so the real footprint exceeds the accounted bytes by a
 * roughly constant factor. Sizing the budget accordingly is the caller's job.
 *
 * `Map` preserves insertion order, so eviction is `keys().next()` and a hit
 * re-inserts to move the entry to the young end — a true LRU rather than
 * first-in-first-out. That distinction matters here: the hot set is "the chats
 * the reader is moving between", not "the chats opened earliest".
 */
const entries = new Map<string, Entry>();
let hits = 0;
let misses = 0;
let statFailures = 0;
let evictions = 0;
let cachedBytes = 0;

function dropEntry(filePath: string): void {
  const existing = entries.get(filePath);
  if (!existing) return;
  cachedBytes -= Number(existing.size);
  entries.delete(filePath);
}

function evictToBytes(maxBytes: number): void {
  // `entries.size > 1` keeps a single over-budget transcript cached rather than
  // evicting it immediately and re-reading it on every request — the worst of
  // both worlds. One oversized entry is bounded; a re-read loop is not.
  while (cachedBytes > maxBytes && entries.size > 1) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    dropEntry(oldest.value);
    evictions += 1;
  }
}

export function getStoreReadCacheMetrics(): StoreReadCacheMetrics {
  return { hits, misses, statFailures, evictions, entries: entries.size, cachedBytes };
}

export function resetStoreReadCacheMetrics(): void {
  hits = 0;
  misses = 0;
  statFailures = 0;
  evictions = 0;
}

/**
 * Drop one store's cached value. Call from every write path that replaces the
 * file, so a same-process mutation is visible on the next read instead of
 * waiting for the file identity to be observed.
 */
export function invalidateCachedStore(filePath: string): void {
  dropEntry(filePath);
}

/** Drop everything. Tests that repoint `COVEN_HOME` must call this. */
export function clearCaveStoreReadCache(): void {
  entries.clear();
  cachedBytes = 0;
  resetStoreReadCacheMetrics();
}

/**
 * Read a store through the cache. `load` is the existing locked loader and is
 * called unchanged on every miss.
 */
export async function readCachedStore<T>(
  filePath: string,
  load: () => Promise<T>,
  options: StoreReadCacheOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes;

  let identity: FileIdentity;
  try {
    // `turbopackIgnore` because this path is a runtime value, and Turbopack
    // otherwise treats a dynamic filesystem access as a reason to trace the
    // whole project ("Dynamic filesystem access causes tracing of the whole
    // project"). That matters more here than at most call sites: `writeFileAtomic`
    // imports this module, so without the annotation every route that writes a
    // store would inherit whole-project tracing — and in this checkout
    // `.worktrees` alone matches ~237k files. Same convention as
    // `server/agent-attachments.ts` and `server/assist-runner.ts`.
    identity = await (options.inspectFile ?? inspectStoreFile)(filePath);
  } catch {
    // ENOENT is the ordinary cold-start shape: the loader returns defaults.
    // A store with no file has no identity to key on, so it is never cached — the
    // moment it appears, the very next read must see it.
    statFailures += 1;
    dropEntry(filePath);
    return load();
  }

  const cached = entries.get(filePath);
  if (
    cached &&
    cached.dev === identity.dev &&
    cached.ino === identity.ino &&
    cached.mtimeNs === identity.mtimeNs &&
    cached.ctimeNs === identity.ctimeNs &&
    cached.size === identity.size &&
    cached.digest === identity.digest &&
    now() - cached.readAt <= ttlMs
  ) {
    const copy = cloneStoreValue(cached.value);
    if (copy.ok) {
      hits += 1;
      // Re-insert so recency, not insertion order, decides what a bounded
      // caller evicts. Skipped for the unbounded store paths, which never evict.
      if (maxBytes !== undefined) {
        entries.delete(filePath);
        entries.set(filePath, cached);
      }
      return copy.value as T;
    }
    // A store holding something structuredClone cannot copy would otherwise be
    // shared by reference. Drop it and take the honest path instead.
    dropEntry(filePath);
  }

  misses += 1;
  const value = await load();
  // The cache keeps its OWN copy and the caller keeps the loader's object.
  // Storing the caller's reference instead would let whoever triggered the
  // miss mutate the entry every later reader is served — the same poisoning
  // the hit path clones to avoid, just one read earlier. A value that cannot
  // be copied is simply not cached.
  const stored = cloneStoreValue(value);
  if (stored.ok) {
    // Drop before set so a re-read of an existing key moves to the young end
    // rather than staying at its original insertion position, and so its old
    // size leaves the byte account before the new one joins.
    dropEntry(filePath);
    entries.set(filePath, { ...identity, readAt: now(), value: stored.value });
    cachedBytes += Number(identity.size);
    if (maxBytes !== undefined) evictToBytes(maxBytes);
  }
  return value;
}

function cloneStoreValue(value: unknown): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: structuredClone(value) };
  } catch {
    return { ok: false };
  }
}
