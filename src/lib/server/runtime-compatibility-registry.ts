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

import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { writeJsonAtomic } from "./atomic-write.ts";

const REGISTRY_REPO = "OpenCoven/coven-runtimes" as const;
const INDEX_PATH = "crates/coven-runtime-registry/canonical/index.json";
const CACHE_TTL_MS = 24 * 60 * 60_000;

type AdapterEntry = { version: string; yanked?: boolean; adapter: unknown };
type CanonicalIndex = { format: string; runtimes: Record<string, AdapterEntry[]> };

export type RuntimeCompatibilitySnapshot = {
  format: 1;
  runtimeId: string;
  runtimeVersion: string;
  source: { repo: typeof REGISTRY_REPO; blobSha: string };
  fetchedAt: string;
  expiresAt: string;
  adapter: unknown;
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

function versionParts(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(left: string, right: string): number | null {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
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
  return path.join(caveHome(), "runtime-compatibility", `${runtimeId}.json`);
}

function validAdapter(runtimeId: string, adapter: unknown): boolean {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) return false;
  const value = adapter as Record<string, unknown>;
  return value.id === runtimeId && typeof value.executable === "string" && value.executable.length > 0;
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
    !validAdapter(snapshot.runtimeId, snapshot.adapter) ||
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
    const parsed = JSON.parse(await readFile(options.cachePath ?? cacheFile(runtimeId), "utf8"));
    const snapshot = validateRuntimeCompatibilitySnapshot(parsed, options.now ?? new Date(), allowExpired);
    return snapshot?.runtimeId === runtimeId ? snapshot : null;
  } catch {
    return null;
  }
}

function gitBlobSha(raw: string): string {
  return createHash("sha1").update(`blob ${Buffer.byteLength(raw)}\0`).update(raw).digest("hex");
}

function selectAdapter(index: unknown, runtimeId: string): { version: string; adapter: unknown } | null {
  const canonical = index as Partial<CanonicalIndex>;
  if (canonical?.format !== "1" || !canonical.runtimes || typeof canonical.runtimes !== "object") return null;
  const candidates = canonical.runtimes[runtimeId];
  if (!Array.isArray(candidates)) return null;
  let selected: { version: string; adapter: unknown } | null = null;
  for (const candidate of candidates) {
    if (!candidate || candidate.yanked || !versionParts(candidate.version) || !validAdapter(runtimeId, candidate.adapter)) continue;
    if (!selected || (compareVersions(candidate.version, selected.version) ?? -1) > 0) {
      selected = { version: candidate.version, adapter: candidate.adapter };
    }
  }
  return selected;
}

/**
 * Fetch and commit a newer accepted adapter. A malformed, expired, unavailable,
 * or lower-version response retains the cache unchanged. The content endpoint's
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
    const current = await readSnapshot(runtimeId, { ...options, now }, true);
    if (current && (compareVersions(selected.version, current.runtimeVersion) ?? -1) < 0) return null;
    const payload = {
      format: 1 as const,
      runtimeId,
      runtimeVersion: selected.version,
      source: { repo: REGISTRY_REPO, blobSha: doc.sha },
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (options.ttlMs ?? CACHE_TTL_MS)).toISOString(),
      adapter: selected.adapter,
    };
    const snapshot: RuntimeCompatibilitySnapshot = { ...payload, contentHash: runtimeCompatibilityContentHash(payload) };
    const target = options.cachePath ?? cacheFile(runtimeId);
    await mkdir(path.dirname(target), { recursive: true });
    await writeJsonAtomic(target, snapshot);
    return snapshot;
  } catch {
    return null;
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
