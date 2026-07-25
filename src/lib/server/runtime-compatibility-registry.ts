/**
 * Runtime compatibility catalog refresh.
 *
 * This reads the canonical, acceptance-tested coven-runtimes index directly
 * from GitHub, verifies the Git blob hash returned by the Contents API, and
 * stores only a data-only adapter document in a last-known-good cache. It is
 * deliberately runtime-agnostic so every external CLI can consume the same
 * update path. A catalog cannot run code, alter Cave permissions, or replace
 * a native launch path that Cave has not implemented.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { writeJsonAtomic } from "./atomic-write.ts";

const REGISTRY_REPO = "OpenCoven/coven-runtimes" as const;
const INDEX_PATH = "crates/coven-runtime-registry/canonical/index.json";
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_LOCK_STALE_MS = 30_000;

type AdapterEntry = { version: string; yanked?: boolean; adapter: unknown };
type CanonicalIndex = { format: string; runtimes: Record<string, AdapterEntry[]> };

export type RuntimeCompatibilitySnapshot = {
  format: 1;
  runtimeId: string;
  runtimeVersion: string;
  source: { repo: typeof REGISTRY_REPO; blobSha: string };
  fetchedAt: string;
  expiresAt: string;
  /** Data-only event protocol declarations; never launch configuration. */
  eventProtocols: unknown[];
  /** SHA-256 over the data-only cache payload, excluding this property. */
  contentHash: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type RuntimeCompatibilityOptions = {
  cachePath?: string;
  fetchImpl?: FetchLike;
  now?: Date;
  ttlMs?: number;
};

type Semver = { major: string; minor: string; patch: string; prerelease: string[] | null };
const SEMVER_NUMBER = "(?:0|[1-9]\\d*)";

function versionParts(value: string): Semver | null {
  const match = new RegExp(`^(${SEMVER_NUMBER})\\.(${SEMVER_NUMBER})\\.(${SEMVER_NUMBER})(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`).exec(value);
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? null;
  if (prerelease?.some((identifier) => /^0\d+$/.test(identifier))) return null;
  return { major: match[1]!, minor: match[2]!, patch: match[3]!, prerelease };
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return compareAscii(left, right);
}

/** SemVer identifiers are ASCII; locale collation is not SemVer ordering. */
function compareAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareVersions(left: string, right: string): number | null {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return compareNumericIdentifier(a[key], b[key]);
  }
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftId = a.prerelease[index]!;
    const rightId = b.prerelease[index]!;
    if (leftId === rightId) continue;
    const leftNumeric = /^\d+$/.test(leftId);
    const rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) return compareNumericIdentifier(leftId, rightId);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return compareAscii(leftId, rightId);
  }
  return a.prerelease.length - b.prerelease.length;
}

function cachePayload(snapshot: Omit<RuntimeCompatibilitySnapshot, "contentHash">): string {
  return JSON.stringify(snapshot);
}

export function runtimeCompatibilityContentHash(
  snapshot: Omit<RuntimeCompatibilitySnapshot, "contentHash">,
): string {
  return createHash("sha256").update(cachePayload(snapshot)).digest("hex");
}

function cacheFile(runtimeId: string): string {
  return path.join(/* turbopackIgnore: true */ caveHome(), "runtime-compatibility", `${runtimeId}.json`);
}

function eventProtocolsForAdapter(runtimeId: string, adapter: unknown): unknown[] | null {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) return null;
  const value = adapter as Record<string, unknown>;
  if (value.id !== runtimeId) return null;
  const streamArgs = value.stream_args && typeof value.stream_args === "object" && !Array.isArray(value.stream_args)
    ? value.stream_args as Record<string, unknown>
    : null;
  const protocols = value.event_protocols ?? streamArgs?.event_protocols ?? [];
  return Array.isArray(protocols) ? protocols : null;
}

export function validateRuntimeCompatibilitySnapshot(
  value: unknown,
  now = new Date(),
  allowExpired = false,
): RuntimeCompatibilitySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as RuntimeCompatibilitySnapshot;
  if (
    snapshot.format !== 1 ||
    !/^[a-z0-9][a-z0-9-]*$/.test(snapshot.runtimeId ?? "") ||
    !versionParts(snapshot.runtimeVersion ?? "") ||
    snapshot.source?.repo !== REGISTRY_REPO ||
    !/^[a-f0-9]{40}$/i.test(snapshot.source.blobSha ?? "") ||
    !Array.isArray(snapshot.eventProtocols) ||
    !/^[a-f0-9]{64}$/i.test(snapshot.contentHash ?? "")
  ) return null;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  const expiresAt = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(expiresAt) || expiresAt <= fetchedAt) return null;
  const { contentHash: _contentHash, ...payload } = snapshot;
  if (runtimeCompatibilityContentHash(payload) !== snapshot.contentHash) return null;
  if (!allowExpired && expiresAt <= now.getTime()) return null;
  return snapshot;
}

async function readSnapshot(
  runtimeId: string,
  options: RuntimeCompatibilityOptions,
  allowExpired = false,
): Promise<RuntimeCompatibilitySnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ options.cachePath ?? cacheFile(runtimeId), "utf8"));
    const snapshot = validateRuntimeCompatibilitySnapshot(parsed, options.now ?? new Date(), allowExpired);
    return snapshot?.runtimeId === runtimeId ? snapshot : null;
  } catch {
    return null;
  }
}

function gitBlobSha(raw: string): string {
  return createHash("sha1").update(`blob ${Buffer.byteLength(raw)}\0`).update(raw).digest("hex");
}

function selectAdapter(index: unknown, runtimeId: string): { version: string; eventProtocols: unknown[] } | null {
  const canonical = index as Partial<CanonicalIndex>;
  if (canonical?.format !== "1" || !canonical.runtimes || typeof canonical.runtimes !== "object") return null;
  const candidates = canonical.runtimes[runtimeId];
  if (!Array.isArray(candidates)) return null;
  let selected: { version: string; eventProtocols: unknown[] } | null = null;
  for (const candidate of candidates) {
    const eventProtocols = candidate && !candidate.yanked ? eventProtocolsForAdapter(runtimeId, candidate.adapter) : null;
    if (!candidate || !versionParts(candidate.version) || eventProtocols === null) continue;
    if (!selected || (compareVersions(candidate.version, selected.version) ?? -1) > 0) {
      selected = { version: candidate.version, eventProtocols };
    }
  }
  return selected;
}

/**
 * Fetch and commit newer protocol metadata. A malformed, expired, unavailable,
 * equal-but-different, or lower-version response retains the cache unchanged. The content endpoint's
 * blob SHA is recomputed from the response bytes before any JSON is trusted.
 */
export async function refreshRuntimeCompatibility(
  runtimeId: string,
  options: RuntimeCompatibilityOptions = {},
): Promise<RuntimeCompatibilitySnapshot | null> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `https://api.github.com/repos/${REGISTRY_REPO}/contents/${INDEX_PATH}?ref=main`;
  try {
    const response = await fetchImpl(endpoint, {
      headers: { accept: "application/vnd.github+json", "user-agent": "coven-cave-runtime-compatibility" },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return null;
    const doc = await response.json() as { encoding?: unknown; content?: unknown; sha?: unknown };
    if (doc.encoding !== "base64" || typeof doc.content !== "string" || typeof doc.sha !== "string") return null;
    const raw = Buffer.from(doc.content, "base64").toString("utf8");
    if (gitBlobSha(raw) !== doc.sha) return null;
    const selected = selectAdapter(JSON.parse(raw), runtimeId);
    if (!selected) return null;
    const payload = {
      format: 1 as const,
      runtimeId,
      runtimeVersion: selected.version,
      source: { repo: REGISTRY_REPO, blobSha: doc.sha },
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (options.ttlMs ?? CACHE_TTL_MS)).toISOString(),
      eventProtocols: selected.eventProtocols,
    };
    const snapshot: RuntimeCompatibilitySnapshot = { ...payload, contentHash: runtimeCompatibilityContentHash(payload) };
    const target = options.cachePath ?? cacheFile(runtimeId);
    await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
    return await withCacheLock(target, async () => {
      const current = await readSnapshot(runtimeId, { ...options, now }, true);
      if (current) {
        const comparison = compareVersions(selected.version, current.runtimeVersion);
        // Only a strictly newer runtime revision can replace LKG. Revisions
        // with the same version but different content need a new immutable
        // registry version; the same blob can safely renew its expiry.
        if (comparison === null || comparison < 0 || (comparison === 0 && current.source.blobSha !== doc.sha)) return null;
      }
      await writeJsonAtomic(/* turbopackIgnore: true */ target, snapshot);
      return snapshot;
    });
  } catch {
    return null;
  }
}

async function reclaimStaleCacheLock(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(/* turbopackIgnore: true */ lockPath);
    if (Date.now() - info.mtimeMs < CACHE_LOCK_STALE_MS) return false;
    // Rename, rather than unlinking, so a reclaimer never deletes a lock
    // acquired by another process between its stale check and cleanup.
    const quarantine = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
    const beforeRename = await stat(/* turbopackIgnore: true */ lockPath);
    if (beforeRename.ino !== info.ino || beforeRename.mtimeMs !== info.mtimeMs) return false;
    await rename(/* turbopackIgnore: true */ lockPath, quarantine);
    await rm(/* turbopackIgnore: true */ quarantine, { force: true }).catch(() => {});
    return true;
  } catch (error) {
    // A concurrent owner may have released the lock between the failed open
    // and this check. Retry acquisition rather than treating it as a failure.
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** A small cross-process lock: failure to acquire it retains LKG, never races a downgrade. */
async function withCacheLock<T>(target: string, action: () => Promise<T>): Promise<T | null> {
  const lockPath = `${target}.lock`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      handle = await open(/* turbopackIgnore: true */ lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
      if (await reclaimStaleCacheLock(lockPath)) continue;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!handle) return null;
  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await rm(/* turbopackIgnore: true */ lockPath, { force: true }).catch(() => {});
  }
}

/**
 * Resolve a fresh cached adapter first, then attempt a bounded refresh. On
 * outage/expiry failure this returns null so the caller falls back to its
 * checked-in compatible baseline instead of using stale or partial data.
 */
export async function resolveRuntimeCompatibility(
  runtimeId: string,
  options: RuntimeCompatibilityOptions = {},
): Promise<RuntimeCompatibilitySnapshot | null> {
  const cached = await readSnapshot(runtimeId, options);
  return cached ?? refreshRuntimeCompatibility(runtimeId, options);
}
