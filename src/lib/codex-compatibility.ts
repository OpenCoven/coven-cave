/**
 * Versioned Codex event compatibility.
 *
 * Cave normally receives Codex through `coven run --stream-json`, so it must
 * cope with both Coven's outer frames and Codex's own JSONL items.  Keep the
 * evolving Codex protocol here instead of spreading version checks through
 * the chat route.  A schema is deliberately data-only: it can describe
 * recognised event/item names, but cannot inject command arguments or code.
 */

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_SCHEMA_DOCUMENT_BYTES = 1_048_576;
const MAX_SCHEMAS_PER_DOCUMENT = 64;
const MAX_EVENT_TYPES_PER_SCHEMA = 64;
const MAX_ITEM_TYPES_PER_SCHEMA = 64;
const MAX_SCHEMA_STRING_LENGTH = 160;
const MAX_SCHEMA_FUTURE_SKEW_MS = 5 * 60_000;
const CACHE_LOCK_TIMEOUT_MS = 2_000;
const CACHE_LOCK_RETRY_MS = 25;
const MAX_TOOL_DISPLAY_CHARS = 16_384;
const MAX_JSONL_PENDING_CHARS = 256 * 1024;
const CODEX_SCHEMA_REGISTRY_ORIGIN = "https://raw.githubusercontent.com";
const CODEX_SCHEMA_REGISTRY_PATH_PREFIX = "/OpenCoven/coven-runtimes/";

export type CodexCapabilities = {
  jsonEvents: boolean;
  resume: boolean;
};

export type CodexRuntimeReport = {
  version: string | null;
  capabilities: CodexCapabilities;
};

export type CodexEventSchema = {
  id: string;
  schemaVersion: 1;
  minVersion: string;
  /** Inclusive upper bound, retained for previously signed registry documents. */
  maxVersion?: string;
  /** Exclusive upper bound, suitable for a complete minor protocol line. */
  maxVersionExclusive?: string;
  /** Signed precedence for corrective schemas with the same minimum version. */
  priority?: number;
  requiredCapabilities: Partial<CodexCapabilities>;
  /** Exact outer event names accepted from a Codex JSONL stream. */
  eventTypes: readonly string[];
  /** Item types that represent a tool invocation. */
  toolItemTypes: readonly string[];
  /** Completed item types whose text may be rendered as assistant output. */
  textItemTypes: readonly string[];
};

export type CodexSchemaDocument = {
  provenance: {
    registry: "OpenCoven/coven-runtimes";
    revision: string;
    /** Signed, strictly increasing registry checkpoint. */
    sequence: number;
    fetchedAt: string;
    expiresAt: string;
  };
  schemas: readonly CodexEventSchema[];
  /** SHA-256 of the canonical data payload, supplied by the registry. */
  contentHash: string;
  /** Registry signature metadata. Verification is supplied by the host. */
  signature: { keyId: string; value: string };
};

export type CodexSchemaResolution =
  | { ok: true; schema: CodexEventSchema; report: CodexRuntimeReport; source: "builtin" | "cache" | "registry" }
  | {
      ok: false;
      report: CodexRuntimeReport;
      reason: "runtime-unavailable" | "unsupported-version" | "capability-mismatch" | "invalid-schema";
    };

/**
 * Bootstrap schemas are checked into Cave so an offline client continues to
 * understand known Codex versions. Future registry documents can replace
 * these only after validation/signature verification by the host.
 */
export const CODEX_BOOTSTRAP_SCHEMAS: readonly CodexEventSchema[] = [
  {
    id: "codex-jsonl-v1",
    schemaVersion: 1,
    minVersion: "0.145.0",
    // A new minor release must be admitted by a signed registry fixture, not
    // silently parsed as if its protocol were unchanged. The next-minor bound
    // keeps every valid 0.145 patch (including four-digit patches) supported.
    maxVersionExclusive: "0.146.0",
    requiredCapabilities: { jsonEvents: true },
    eventTypes: ["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "item.failed", "error"],
    toolItemTypes: ["command_execution", "file_change", "mcp_tool_call", "collab_tool_call", "web_search", "tool_call"],
    textItemTypes: ["agent_message"],
  },
  {
    id: "codex-jsonl-legacy-v1",
    schemaVersion: 1,
    // This is the earliest legacy stream with an observed, fixture-backed
    // JSONL shape. Older JSON-capable CLIs retain the generic runner.
    minVersion: "0.144.2",
    maxVersionExclusive: "0.145.0",
    requiredCapabilities: { jsonEvents: true },
    eventTypes: ["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "item.failed", "error"],
    toolItemTypes: ["command_execution", "file_change", "mcp_tool_call", "collab_tool_call", "web_search", "tool_call"],
    textItemTypes: ["agent_message"],
  },
] as const;

/**
 * Safe degraded mode for an unrecognised CLI version. It never creates tool
 * activity from an undocumented shape, but preserves the established
 * completed agent-message envelope so a new client cannot turn a valid reply
 * into an empty conversation while the signed schema update is arriving.
 */
export const CODEX_TEXT_ONLY_FALLBACK_SCHEMA: CodexEventSchema = {
  id: "codex-jsonl-text-only-fallback",
  schemaVersion: 1,
  minVersion: "0.0.0",
  requiredCapabilities: {},
  eventTypes: ["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "item.failed", "error"],
  toolItemTypes: [],
  textItemTypes: ["agent_message"],
};

// Signed registry documents may tune compatible item types and version
// ranges, but cannot redefine lifecycle meanings. That would require new
// validated parser code, not a data-only compatibility update.
const SUPPORTED_CODEX_EVENT_TYPES = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.updated",
  "item.completed",
  "item.failed",
  "error",
]);

type ParsedVersion = { core: [number, number, number]; prerelease: string[] | null };

const SEMVER_CORE = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const SEMVER_PRERELEASE_IDENTIFIER = "(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER_TOKEN = `${SEMVER_CORE}(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?`;
const SEMVER_TOKEN_RE = new RegExp(`^(?:${SEMVER_TOKEN})$`);
const SEMVER_OUTPUT_RE = new RegExp(`(?:^|[^0-9A-Za-z.-])v?(${SEMVER_TOKEN})(?=$|[^0-9A-Za-z.-])`);

function hasSafeSemVerNumbers(version: string): boolean {
  const [core] = version.split(/[-+]/, 1);
  if (!core || core.split(".").some((part) => !Number.isSafeInteger(Number(part)))) return false;
  const prerelease = /-([^+]+)/.exec(version)?.[1]?.split(".");
  return !prerelease?.some((part) => /^\d+$/.test(part) && !Number.isSafeInteger(Number(part)));
}

export function parseCodexVersionOutput(output: string | null): string | null {
  if (!output) return null;
  // The version must end at a complete semver token. `\b` alone accepts the
  // first three components of malformed values such as `0.145.0.1`, because
  // the dot creates a word boundary after the patch component.
  const candidate = SEMVER_OUTPUT_RE.exec(output)?.[1] ?? null;
  return candidate && hasSafeSemVerNumbers(candidate) ? candidate : null;
}

function parsedVersion(version: string | null): ParsedVersion | null {
  const parsed = parseCodexVersionOutput(version);
  if (!parsed) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(parsed);
  if (!match) return null;
  if (!SEMVER_TOKEN_RE.test(parsed)) return null;
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (core.some((part) => !Number.isSafeInteger(part))) return null;
  const prerelease = match[4] ? match[4].split(".") : null;
  if (prerelease?.some((entry) => !entry || !/^[0-9A-Za-z-]+$/.test(entry) || (/^\d+$/.test(entry) && !Number.isSafeInteger(Number(entry))))) return null;
  return { core: [...core], prerelease };
}

function compareVersions(left: string, right: string): number {
  const a = parsedVersion(left);
  const b = parsedVersion(right);
  if (!a || !b) return Number.NaN;
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index]!;
    const rightPart = b.prerelease[index]!;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return a.prerelease.length - b.prerelease.length;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = record(value);
  if (!object) throw new TypeError("schema payload must be JSON data");
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function canonicalSchemaPayload(document: Pick<CodexSchemaDocument, "provenance" | "schemas">): string {
  // RFC 8785-style recursive member ordering for the data types allowed by
  // this document. Registry implementations can produce the same bytes
  // regardless of their input/parser key insertion order.
  return canonicalJson({ provenance: document.provenance, schemas: document.schemas });
}

export function schemaContentHash(document: Pick<CodexSchemaDocument, "provenance" | "schemas">): string {
  return createHash("sha256").update(canonicalSchemaPayload(document)).digest("hex");
}

function isStringArray(value: unknown, maxEntries: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxEntries
    && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= MAX_SCHEMA_STRING_LENGTH);
}

export function isValidCodexSchema(schema: unknown): schema is CodexEventSchema {
  if (!schema || typeof schema !== "object") return false;
  const value = schema as Partial<CodexEventSchema>;
  const minVersion = value.minVersion;
  if (
    value.schemaVersion !== 1
    || typeof value.id !== "string"
    || value.id.length === 0
    || value.id.length > MAX_SCHEMA_STRING_LENGTH
    || typeof minVersion !== "string"
    || !parsedVersion(minVersion)
  ) return false;
  if (
    (value.maxVersion !== undefined && (typeof value.maxVersion !== "string" || !parsedVersion(value.maxVersion) || compareVersions(value.maxVersion, minVersion) < 0))
    || (value.maxVersionExclusive !== undefined && (typeof value.maxVersionExclusive !== "string" || !parsedVersion(value.maxVersionExclusive) || compareVersions(value.maxVersionExclusive, minVersion) <= 0))
    || (value.maxVersion !== undefined && value.maxVersionExclusive !== undefined)
    || (value.priority !== undefined && (!Number.isSafeInteger(value.priority) || value.priority < 0))
  ) return false;
  if (
    !isStringArray(value.eventTypes, MAX_EVENT_TYPES_PER_SCHEMA)
    || !value.eventTypes.every((eventType) => SUPPORTED_CODEX_EVENT_TYPES.has(eventType))
    || !isStringArray(value.toolItemTypes, MAX_ITEM_TYPES_PER_SCHEMA)
    || !isStringArray(value.textItemTypes, MAX_ITEM_TYPES_PER_SCHEMA)
  ) return false;
  if (value.toolItemTypes.some((itemType) => value.textItemTypes!.includes(itemType))) return false;
  if (!value.requiredCapabilities || typeof value.requiredCapabilities !== "object") return false;
  return Object.entries(value.requiredCapabilities).every(
    ([key, enabled]) => (key === "jsonEvents" || key === "resume") && typeof enabled === "boolean",
  );
}

/**
 * Validation is intentionally separate from transport. Callers verify the
 * detached signature using their trust store, then pass the verified document
 * here. A bad hash, expiry, or schema can never become the selected parser.
 */
export function validateCodexSchemaDocument(
  document: unknown,
  now = new Date(),
  options: { allowExpired?: boolean; ignoreTime?: boolean } = {},
): { ok: true; value: CodexSchemaDocument } | { ok: false; reason: "invalid" | "expired" | "hash" } {
  if (!document || typeof document !== "object") return { ok: false, reason: "invalid" };
  const value = document as CodexSchemaDocument;
  if (
    value.provenance?.registry !== "OpenCoven/coven-runtimes" ||
    typeof value.provenance.revision !== "string" ||
    value.provenance.revision.length === 0 ||
    value.provenance.revision.length > MAX_SCHEMA_STRING_LENGTH ||
    !Number.isSafeInteger(value.provenance.sequence) ||
    value.provenance.sequence < 0 ||
    !Array.isArray(value.schemas) ||
    value.schemas.length === 0 ||
    value.schemas.length > MAX_SCHEMAS_PER_DOCUMENT ||
    !value.schemas.every(isValidCodexSchema) ||
    new Set(value.schemas.map((schema) => schema.id)).size !== value.schemas.length ||
    !/^[a-f0-9]{64}$/i.test(value.contentHash ?? "") ||
    typeof value.signature?.keyId !== "string" ||
    value.signature.keyId.length === 0 ||
    value.signature.keyId.length > MAX_SCHEMA_STRING_LENGTH ||
    typeof value.signature?.value !== "string" ||
    value.signature.value.length === 0 ||
    value.signature.value.length > MAX_SCHEMA_DOCUMENT_BYTES
  ) {
    return { ok: false, reason: "invalid" };
  }
  const fetchedAt = Date.parse(value.provenance.fetchedAt);
  const expiresAt = Date.parse(value.provenance.expiresAt);
  if (
    !Number.isFinite(fetchedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= fetchedAt
  ) {
    return { ok: false, reason: "expired" };
  }
  if (!options.ignoreTime && (
    fetchedAt > now.getTime() + MAX_SCHEMA_FUTURE_SKEW_MS
    || (!options.allowExpired && expiresAt <= now.getTime())
  )) return { ok: false, reason: "expired" };
  if (schemaContentHash(value) !== value.contentHash) return { ok: false, reason: "hash" };
  return { ok: true, value };
}

/** In-memory last-known-good cache; persistence adapters may hydrate it at boot. */
export class CodexSchemaCache {
  private document: CodexSchemaDocument | null = null;

  read(): CodexSchemaDocument | null {
    return this.document;
  }

  /** Refuse a stale/replayed registry revision and replace atomically only after validation. */
  offer(document: unknown, options: { now?: Date; verifySignature: (value: CodexSchemaDocument) => boolean }): boolean {
    const checked = validateCodexSchemaDocument(document, options.now);
    if (!checked.ok || !options.verifySignature(checked.value)) return false;
    const current = this.document;
    if (current && compareSchemaDocumentFreshness(checked.value, current) <= 0) return false;
    this.document = checked.value;
    return true;
  }
}

export type CodexSchemaSignatureVerifier = (value: CodexSchemaDocument) => boolean;

function compareSchemaDocumentFreshness(left: CodexSchemaDocument, right: CodexSchemaDocument): number {
  const sequence = left.provenance.sequence - right.provenance.sequence;
  if (sequence !== 0) return sequence;
  // The sequence is the authenticated anti-rollback checkpoint. A publisher
  // must never reissue an older payload under a later wall-clock timestamp:
  // clocks can be coarse or corrected backwards, while the signed sequence
  // is monotonic across documents.
  if (left.contentHash !== right.contentHash) return -1;
  const issued = Date.parse(left.provenance.fetchedAt) - Date.parse(right.provenance.fetchedAt);
  if (issued !== 0) return issued;
  return 0;
}

const cacheWriteQueues = new Map<string, Promise<void>>();

async function serializeCacheWrite<T>(cachePath: string, action: () => Promise<T>): Promise<T> {
  const previous = cacheWriteQueues.get(cachePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  cacheWriteQueues.set(cachePath, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (cacheWriteQueues.get(cachePath) === queued) cacheWriteQueues.delete(cachePath);
  }
}

async function waitForCacheLock(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type CacheLockLease = { token: string; pid: number };

function parseCacheLockLease(value: string): CacheLockLease | null {
  try {
    const parsed = JSON.parse(value) as Partial<CacheLockLease>;
    const token = parsed.token;
    const pid = parsed.pid;
    if (typeof token !== "string" || token.length === 0 || typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null;
    return { token, pid };
  } catch {
    return null;
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM proves the process exists but is not ours to signal.
    return !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
}

/** Move, never unlink, a crashed owner's lease so a racing writer cannot lose a new lock. */
async function reclaimAbandonedCacheLock(lockPath: string): Promise<boolean> {
  let observed: CacheLockLease | null = null;
  try {
    observed = parseCacheLockLease(await readFile(lockPath, "utf8"));
  } catch {
    return false;
  }
  if (!observed || pidIsAlive(observed.pid)) return false;
  const tombstone = `${lockPath}.abandoned.${observed.token}`;
  try {
    await rename(lockPath, tombstone);
    try { await unlink(tombstone); } catch { /* best effort */ }
    return true;
  } catch {
    return false;
  }
}

/**
 * The in-process queue prevents local contention; this lock protects the
 * shared per-user cache when two Cave processes refresh at the same time.
 * Stale locks deliberately fail closed: deleting a lock after observing it is
 * non-atomic and could remove a replacement writer's live ownership token.
 */
async function acquireCacheWriteLock(cachePath: string): Promise<(() => Promise<void>) | null> {
  const lockPath = `${cachePath}.lock`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < CACHE_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(path.dirname(cachePath), { recursive: true });
      const handle = await open(lockPath, "wx", 0o600);
      const ownershipToken = crypto.randomUUID();
      await handle.writeFile(JSON.stringify({ token: ownershipToken, pid: process.pid }), "utf8");
      await handle.close();
      return async () => {
        try {
          // Never delete a replacement lock acquired by another process after
          // this writer finished. The token is an ownership proof, not merely
          // a stale-file hint.
          if (parseCacheLockLease(await readFile(lockPath, "utf8"))?.token === ownershipToken) await unlink(lockPath);
        } catch { /* best effort */ }
      };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "EEXIST") return null;
      if (await reclaimAbandonedCacheLock(lockPath)) continue;
      await waitForCacheLock(CACHE_LOCK_RETRY_MS);
    }
  }
  return null;
}

/**
 * Durable last-known-good cache. Registry transport belongs to the updater or
 * sidecar; this narrow persistence seam means it can update schemas without
 * granting a registry document code execution or arbitrary filesystem access.
 */
export async function readCodexSchemaCache(
  cachePath: string,
  verifySignature: CodexSchemaSignatureVerifier,
  now = new Date(),
  options: { allowExpired?: boolean; ignoreTime?: boolean } = {},
): Promise<CodexSchemaDocument | null> {
  try {
    // Hold one descriptor from size check through the bounded read. A second
    // path-based read can be swapped for a multi-gigabyte file after stat.
    const handle = await open(cachePath, "r");
    let serialized: string;
    try {
      const { size } = await handle.stat();
      if (size > MAX_SCHEMA_DOCUMENT_BYTES) return null;
      const bytes = Buffer.alloc(size);
      const { bytesRead } = await handle.read(bytes, 0, size, 0);
      if (bytesRead !== size) return null;
      // Detect growth of the opened inode/handle after its fstat as well.
      const extra = Buffer.alloc(1);
      if ((await handle.read(extra, 0, 1, size)).bytesRead !== 0) return null;
      serialized = bytes.toString("utf8");
    } finally {
      await handle.close();
    }
    const checked = validateCodexSchemaDocument(JSON.parse(serialized), now, options);
    return checked.ok && verifySignature(checked.value) ? checked.value : null;
  } catch {
    return null;
  }
}

function codexSchemaWatermarkPath(cachePath: string): string {
  return `${cachePath}.watermark`;
}

/**
 * The cache payload is selectable state; the sidecar is an authenticated
 * high-water mark. Keeping the full signed document lets a corrupt payload
 * still reject an older replay without trusting an unsigned sequence file.
 */
async function readCodexSchemaWatermark(
  cachePath: string,
  verifySignature: CodexSchemaSignatureVerifier,
  now: Date,
): Promise<CodexSchemaDocument | null> {
  return readCodexSchemaCache(
    codexSchemaWatermarkPath(cachePath),
    verifySignature,
    now,
    { allowExpired: true, ignoreTime: true },
  );
}

async function syncCacheFile(filePath: string): Promise<void> {
  // Windows only permits fsync on a writable handle, even though the file is
  // already closed and no longer needs modification.
  const handle = await open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncCacheDirectory(dir: string): Promise<void> {
  // Windows does not permit opening a directory as a normal file handle. The
  // rename is still atomic there; POSIX platforms additionally need the
  // directory sync to make the rename survive a sudden power loss.
  if (process.platform === "win32") return;
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurableSchemaDocument(filePath: string, serialized: string): Promise<boolean> {
  const dir = path.dirname(filePath);
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(temp, serialized, { encoding: "utf8", mode: 0o600 });
    await syncCacheFile(temp);
    await rename(temp, filePath);
    await syncCacheDirectory(dir);
    return true;
  } catch {
    try { await unlink(temp); } catch { /* best effort */ }
    return false;
  }
}

/** Atomic, durable replace keeps a power loss or interrupted refresh from erasing LKG. */
export async function writeCodexSchemaCache(
  cachePath: string,
  document: unknown,
  verifySignature: CodexSchemaSignatureVerifier,
  now = new Date(),
): Promise<boolean> {
  return serializeCacheWrite(cachePath, async () => {
    const release = await acquireCacheWriteLock(cachePath);
    if (!release) return false;
    try {
      const checked = validateCodexSchemaDocument(document, now);
      if (!checked.ok || !verifySignature(checked.value)) return false;
      // Keep an authenticated watermark even when this document is too old
      // to select. That prevents an offline replay from rolling the cache
      // back after the current selection has expired.
      // A watermark only needs a valid signature/hash and coherent issued
      // times. It must survive a backward clock correction, otherwise a
      // previously newer signed document could be replayed over the cache.
      const cached = await readCodexSchemaCache(cachePath, verifySignature, now, { allowExpired: true, ignoreTime: true });
      const watermark = await readCodexSchemaWatermark(cachePath, verifySignature, now);
      const previous = !cached || (watermark && compareSchemaDocumentFreshness(watermark, cached) > 0)
        ? watermark
        : cached;
      const freshness = previous
        ? compareSchemaDocumentFreshness(checked.value, previous)
        : 1;
      // The watermark is intentionally published before the selectable cache.
      // A crash or transient I/O error between those writes leaves the exact
      // same document as the authenticated high-water mark but no usable
      // payload. Let that document repair the payload on a later refresh;
      // lower or conflicting documents remain rejected as replays.
      if (freshness < 0 || (freshness === 0 && cached?.contentHash === checked.value.contentHash)) return false;
      const serialized = JSON.stringify(checked.value);
      if (Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_DOCUMENT_BYTES) return false;
      // Publish the authenticated checkpoint first. If the selectable cache
      // is then damaged or a power loss interrupts its replacement, the next
      // refresh still rejects any lower-sequence replay.
      if (!await writeDurableSchemaDocument(codexSchemaWatermarkPath(cachePath), serialized)) return false;
      return writeDurableSchemaDocument(cachePath, serialized);
    } finally {
      await release();
    }
  });
}

/**
 * Refresh contract for the canonical registry client. Call it on a background
 * cadence; a failed fetch/verification intentionally leaves the cache alone.
 */
export async function refreshCodexSchemaCache(
  cachePath: string,
  fetchDocument: () => Promise<unknown>,
  verifySignature: CodexSchemaSignatureVerifier,
  now = new Date(),
): Promise<"updated" | "retained"> {
  try {
    return (await writeCodexSchemaCache(cachePath, await fetchDocument(), verifySignature, now))
      ? "updated"
      : "retained";
  } catch {
    return "retained";
  }
}

const schemaRefreshes = new Map<string, { checkedAt: number; pending: Promise<void> | null }>();

/** Registry documents may only come from the release-owned schema repository.
 * The configurable value selects a path/revision there; it never grants an
 * arbitrary outbound network destination to the chat process. */
export function trustedCodexSchemaRegistryUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === CODEX_SCHEMA_REGISTRY_ORIGIN
      && url.protocol === "https:"
      && !url.username
      && !url.password
      && url.pathname.startsWith(CODEX_SCHEMA_REGISTRY_PATH_PREFIX)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Fetch's `response.json()` buffers an arbitrarily large body before schema
 * validation gets a chance to apply the document cap. Keep the transport
 * bounded too: a bad registry response must retain LKG rather than consume a
 * chat server's memory while it is being parsed.
 */
export async function readBoundedCodexSchemaResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SCHEMA_DOCUMENT_BYTES) {
    throw new Error("schema registry response exceeds the document limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("schema registry response has no body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SCHEMA_DOCUMENT_BYTES) {
        throw new Error("schema registry response exceeds the document limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
}

/**
 * Versioned OpenCoven registry signing roots. These public Ed25519 keys are
 * pinned in the shipped client so a stock installation can verify a future
 * registry document before any deployment environment is configured.
 * Environment keys may extend the keyring for a managed rotation, but cannot
 * replace a pinned root.
 */
export const CODEX_SCHEMA_TRUSTED_KEYS: Readonly<Record<string, string>> = {
  "opencoven-ed25519-2026-01": "MCowBQYDK2VwAyEAIEW6H97r7kazZlASzyc0tttmCN9XICUt6NmtPMm9dplG",
  "opencoven-ed25519-2026-02": "MCowBQYDK2VwAyEAIMJbFNI/zlvK1mHebDpytNSP5sP0+vx/ygaXZ0axjPXg",
  "opencoven-ed25519-2026-03": "MCowBQYDK2VwAyEAILKDFHwLzZJnHWppq+9WzP2N3539CF6AsWr1uNziQdOY",
  "opencoven-ed25519-2026-04": "MCowBQYDK2VwAyEAII3BskUTDPVil6koBFQ7bsCoH5Yk7i/jY3JA4UsGO406",
  "opencoven-ed25519-2026-05": "MCowBQYDK2VwAyEAILMG3rE4/iAnnalyyP3GO3PzPTzuKBZFluNOdk/Pp5wq",
};

export function codexSchemaCachePath(home = os.homedir()): string {
  return path.join(home, ".coven", "cache", "codex-schemas.json");
}

/**
 * Key material is SPKI DER encoded as base64 and keyed by the document's
 * signed keyId. Keeping the trust store separate from a remotely fetched
 * document permits key rotation only through an intentional Cave policy
 * update (or managed deployment configuration), never by the registry itself.
 */
export function codexSchemaSignatureVerifierFromEnv(
  encoded = process.env.COVEN_CODEX_SCHEMA_TRUSTED_KEYS,
): CodexSchemaSignatureVerifier {
  let configured: Record<string, string> = {};
  try {
    if (encoded) configured = JSON.parse(encoded) as Record<string, string>;
  } catch {
    // Ignore a malformed deployment extension; pinned roots remain usable.
  }
  const keys = [
    ...Object.entries(CODEX_SCHEMA_TRUSTED_KEYS),
    ...Object.entries(configured).filter(([id]) => !(id in CODEX_SCHEMA_TRUSTED_KEYS)),
  ];
  const trusted = new Map(
    keys.flatMap(([id, value]) => {
      try {
        return [[id, createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" })] as const];
      } catch {
        return [];
      }
    }),
  );
  return (document) => {
    const key = trusted.get(document.signature.keyId);
    if (!key) return false;
    try {
      return verifySignature(null, Buffer.from(canonicalSchemaPayload(document)), key, Buffer.from(document.signature.value, "base64"));
    } catch {
      return false;
    }
  };
}

export type CodexSchemaSources = Array<{ source: "builtin" | "cache" | "registry"; schemas: readonly CodexEventSchema[] }>;

/**
 * Hydrate LKG synchronously for this turn, then schedule at most one bounded
 * authenticated refresh per cadence. A failed network/signature check never
 * displaces the already verified cache or blocks the chat response.
 */
export async function productionCodexSchemaSources(options: {
  cachePath?: string;
  registryUrl?: string;
  verifier?: CodexSchemaSignatureVerifier | null;
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<CodexSchemaSources> {
  const verifier = options.verifier ?? codexSchemaSignatureVerifierFromEnv();
  const cachePath = options.cachePath ?? codexSchemaCachePath();
  const now = options.now ?? new Date();
  const sources: CodexSchemaSources = [{ source: "builtin", schemas: CODEX_BOOTSTRAP_SCHEMAS }];
  const cached = await readCodexSchemaCache(cachePath, verifier, now);
  const watermark = await readCodexSchemaWatermark(cachePath, verifier, now);
  // A restored/replayed cache file cannot bypass the authenticated high-water
  // mark written beside it. Leave the cache unselectable until an equal-or-
  // newer verified document repairs it.
  if (cached && (!watermark || compareSchemaDocumentFreshness(cached, watermark) >= 0)) {
    sources.push({ source: "cache", schemas: cached.schemas });
  }

  // The runtime registry currently publishes adapter manifests, not signed
  // Codex event schemas. Do not silently poll a guessed URL: deployments that
  // operate a signed schema registry opt in explicitly, and stock clients keep
  // using the reviewed bootstrap schemas plus a verified LKG cache.
  const registryUrl = trustedCodexSchemaRegistryUrl(
    options.registryUrl ?? process.env.COVEN_CODEX_SCHEMA_REGISTRY_URL,
  );
  const refresh = schemaRefreshes.get(cachePath);
  const refreshDue = !refresh || Date.now() - refresh.checkedAt >= 5 * 60_000;
  if (registryUrl && refreshDue && !refresh?.pending) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const pending = refreshCodexSchemaCache(
      cachePath,
      async () => {
        const response = await fetchImpl(registryUrl, {
          headers: { Accept: "application/json", "User-Agent": "coven-cave" },
          signal: AbortSignal.timeout(4_000),
          cache: "no-store",
          redirect: "error",
        });
        if (!response.ok) throw new Error(`registry fetch failed: ${response.status}`);
        return readBoundedCodexSchemaResponse(response);
      },
      verifier,
    ).then(() => undefined).finally(() => {
      const current = schemaRefreshes.get(cachePath);
      if (current) current.pending = null;
    });
    schemaRefreshes.set(cachePath, { checkedAt: Date.now(), pending });
  }
  return sources;
}

function hasCapabilities(report: CodexRuntimeReport, required: Partial<CodexCapabilities>): boolean {
  return Object.entries(required).every(([key, value]) => value !== true || report.capabilities[key as keyof CodexCapabilities] === true);
}

export function resolveCodexSchema(
  report: CodexRuntimeReport,
  sources: Array<{ source: "builtin" | "cache" | "registry"; schemas: readonly CodexEventSchema[] }> = [
    { source: "builtin", schemas: CODEX_BOOTSTRAP_SCHEMAS },
  ],
): CodexSchemaResolution {
  const version = parsedVersion(report.version);
  if (!version) return { ok: false, report, reason: "runtime-unavailable" };
  // Stable schemas never implicitly admit rollout builds. A future schema can
  // add an explicit prerelease field when that protocol is intentionally
  // conformance-tested; until then, preview clients take the safe fallback.
  if (version.prerelease) return { ok: false, report, reason: "unsupported-version" };
  const precedence = { builtin: 0, cache: 1, registry: 2 } as const;
  const compatible = sources.flatMap(({ source, schemas }) => schemas.map((schema) => ({ source, schema })))
    .filter(({ schema }) => compareVersions(report.version!, schema.minVersion) >= 0
      && (!schema.maxVersion || compareVersions(report.version!, schema.maxVersion) <= 0)
      && (!schema.maxVersionExclusive || compareVersions(report.version!, schema.maxVersionExclusive) < 0))
    .sort((left, right) => {
      const versionOrder = compareVersions(right.schema.minVersion, left.schema.minVersion);
      if (versionOrder !== 0) return versionOrder;
      const priorityOrder = (right.schema.priority ?? 0) - (left.schema.priority ?? 0);
      if (priorityOrder !== 0) return priorityOrder;
      const sourceOrder = precedence[right.source] - precedence[left.source];
      if (sourceOrder !== 0) return sourceOrder;
      return 0;
    });
  const sawVersion = compatible.length > 0;
  const capable = compatible.filter(({ schema }) => hasCapabilities(report, schema.requiredCapabilities));
  const ambiguous = capable.some((candidate, index) => capable.slice(index + 1).some((other) =>
    candidate.source === other.source
    && compareVersions(candidate.schema.minVersion, other.schema.minVersion) === 0
    && (candidate.schema.priority ?? 0) === (other.schema.priority ?? 0),
  ));
  if (ambiguous) return { ok: false, report, reason: "invalid-schema" };
  const selected = capable[0];
  if (selected) {
    return { ok: true, schema: selected.schema, report, source: selected.source };
  }
  return { ok: false, report, reason: sawVersion ? "capability-mismatch" : "unsupported-version" };
}

const PROBE_ENV_KEYS = process.platform === "win32"
  ? ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"]
  : ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"];

/** A probe must never receive harness, vault, provider, or launcher secrets. */
export function codexProbeEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const key of PROBE_ENV_KEYS) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}

export type CodexProbeTarget = { command: string; fixedArgs?: readonly string[] };
type CodexProbeCacheEntry = { report: CodexRuntimeReport; expiresAt: number; pending?: Promise<CodexRuntimeReport> };
const codexProbeCache = new Map<string, CodexProbeCacheEntry>();
const CODEX_PROBE_SUCCESS_TTL_MS = 60_000;
const CODEX_PROBE_FAILURE_TTL_MS = 10_000;

export function clearCodexRuntimeDiscoveryCache(): void {
  codexProbeCache.clear();
}

function normalizedProbeTarget(target: string | CodexProbeTarget): Required<CodexProbeTarget> {
  return typeof target === "string"
    ? { command: target, fixedArgs: [] }
    : { command: target.command, fixedArgs: [...(target.fixedArgs ?? [])] };
}

function codexProbeCacheKey(target: Required<CodexProbeTarget>, env: NodeJS.ProcessEnv): string {
  return JSON.stringify({
    command: target.command,
    fixedArgs: target.fixedArgs,
    // `env` has already passed codexProbeEnv's secret allowlist.
    env: PROBE_ENV_KEYS.map((key) => [key, env[key] ?? ""]),
  });
}

/** Safe local discovery; failures become an explicit unavailable report. */
export async function discoverCodexRuntime(
  command: string | CodexProbeTarget = "codex",
  timeout = 1_500,
  env?: NodeJS.ProcessEnv,
): Promise<CodexRuntimeReport> {
  try {
    const target = normalizedProbeTarget(command);
    // `codex` is normally an npm `.cmd` shim on Windows. The argv is fixed
    // by this module (never request-supplied), so Node's shell bridge is used
    // only there to let Windows resolve the shim safely.
    const windowsShim = process.platform === "win32" && (target.command === "codex" || /\.(cmd|bat)$/i.test(target.command));
    const [{ stdout: versionOut, stderr: versionErr }, { stdout: helpOut, stderr: helpErr }] = await Promise.all([
      execFileAsync(target.command, [...target.fixedArgs, "--version"], { timeout, windowsHide: true, env, shell: windowsShim }),
      execFileAsync(target.command, [...target.fixedArgs, "exec", "--help"], { timeout, windowsHide: true, env, shell: windowsShim }),
    ]);
    const version = parseCodexVersionOutput(`${versionOut}\n${versionErr}`);
    const help = `${helpOut}\n${helpErr}`;
    return { version, capabilities: { jsonEvents: /(?:^|\s)--json(?:\s|$)/m.test(help), resume: /\bresume\b/i.test(help) } };
  } catch {
    return { version: null, capabilities: { jsonEvents: false, resume: false } };
  }
}

/** Single-flight, bounded-cadence discovery for chat turns. */
export async function discoverCachedCodexRuntime(
  command: string | CodexProbeTarget = "codex",
  timeout = 1_500,
  env = codexProbeEnv(),
  now = Date.now(),
): Promise<CodexRuntimeReport> {
  return startCodexRuntimeDiscovery(command, timeout, env, now);
}

function startCodexRuntimeDiscovery(
  command: string | CodexProbeTarget,
  timeout: number,
  env: NodeJS.ProcessEnv,
  now: number,
): Promise<CodexRuntimeReport> {
  const target = normalizedProbeTarget(command);
  const cacheKey = codexProbeCacheKey(target, env);
  const cached = codexProbeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.pending ?? Promise.resolve(cached.report);
  const pending = discoverCodexRuntime(target, timeout, env).then((report) => {
    codexProbeCache.set(cacheKey, {
      report,
      expiresAt: Date.now() + (report.version ? CODEX_PROBE_SUCCESS_TTL_MS : CODEX_PROBE_FAILURE_TTL_MS),
    });
    return report;
  });
  codexProbeCache.set(cacheKey, {
    // A stale report may describe an executable that has been replaced since
    // the last probe. Do not select its schema while the refresh is pending:
    // the text-only fallback is safer than parsing a newly upgraded runtime
    // with an expired protocol contract.
    report: !cached || cached.expiresAt <= now
      ? { version: null, capabilities: { jsonEvents: false, resume: false } }
      : cached.report,
    expiresAt: now + timeout,
    pending,
  });
  return pending;
}

/**
 * Return the last probe result immediately and warm a stale entry in the
 * background. A cold process spawn must not put a chat request on the critical
 * path; that first turn safely uses the text-only fallback while later turns
 * use the cached, capability-gated schema.
 */
export function peekCachedCodexRuntime(
  command: string | CodexProbeTarget = "codex",
  timeout = 1_500,
  env = codexProbeEnv(),
  now = Date.now(),
): CodexRuntimeReport {
  const target = normalizedProbeTarget(command);
  const cacheKey = codexProbeCacheKey(target, env);
  const cached = codexProbeCache.get(cacheKey);
  if (!cached || cached.expiresAt <= now) {
    void startCodexRuntimeDiscovery(command, timeout, env, now);
    return { version: null, capabilities: { jsonEvents: false, resume: false } };
  }
  return cached.report;
}

export type CodexStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "session"; sessionId: string }
  | { kind: "tool_start"; id: string; name: string; input?: unknown }
  | { kind: "tool_end"; id: string; name: string; input?: unknown; output?: string; isError: boolean }
  /** Terminal Codex failure with no untrusted payload attached. */
  | { kind: "failure" }
  | { kind: "unknown"; fingerprint: string }
  | { kind: "ignored" };

export type CodexDecodedToken =
  | CodexStreamEvent
  | { kind: "passthrough"; text: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeOutput(value: unknown): string | undefined {
  let output: string | undefined;
  if (typeof value === "string") output = value || undefined;
  else if (value == null) return undefined;
  else {
    try { output = JSON.stringify(value); } catch { return undefined; }
  }
  if (!output) return undefined;
  return output.length <= MAX_TOOL_DISPLAY_CHARS
    ? output
    : `${output.slice(0, MAX_TOOL_DISPLAY_CHARS)}\n[output truncated]`;
}

function eventFingerprint(value: Record<string, unknown>): string {
  // Event shape only: no payload values are included in the diagnostic.
  const shape = JSON.stringify({ type: value.type, keys: Object.keys(value).sort(), itemType: record(value.item)?.type });
  return createHash("sha256").update(shape).digest("hex").slice(0, 12);
}

export function parseCodexStreamEvent(value: unknown, schema: CodexEventSchema): CodexStreamEvent | null {
  const event = record(value);
  if (!event || typeof event.type !== "string") return null;
  if (!schema.eventTypes.includes(event.type)) return { kind: "unknown", fingerprint: eventFingerprint(event) };
  if (event.type === "thread.started") {
    const thread = record(event.thread);
    const id = typeof event.thread_id === "string" ? event.thread_id : typeof thread?.id === "string" ? thread.id : null;
    return id ? { kind: "session", sessionId: id } : { kind: "unknown", fingerprint: eventFingerprint(event) };
  }
  if (event.type === "turn.failed" || event.type === "error") {
    return { kind: "failure" };
  }
  if (event.type === "turn.started" || event.type === "turn.completed") {
    return { kind: "ignored" };
  }
  const item = record(event.item);
  if (!item) return { kind: "unknown", fingerprint: eventFingerprint(event) };
  if (typeof item.type === "string" && schema.textItemTypes.includes(item.type)) {
    return event.type === "item.completed" && typeof item.text === "string"
      ? { kind: "text", text: item.text }
      // Normal lifecycle starts/updates for agent_message contain no display
      // text. They are not compatibility failures.
      : { kind: "ignored" };
  }
  if (
    (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed" || event.type === "item.failed") &&
    (typeof item.id !== "string" || typeof item.type !== "string" || !schema.toolItemTypes.includes(item.type))
  ) {
    return { kind: "unknown", fingerprint: eventFingerprint(event) };
  }
  if (typeof item.id !== "string" || !item.id || item.id.length > MAX_SCHEMA_STRING_LENGTH || typeof item.type !== "string" || !schema.toolItemTypes.includes(item.type)) return { kind: "unknown", fingerprint: eventFingerprint(event) };
  const mcpName = item.type === "mcp_tool_call"
    && typeof item.tool === "string" && item.tool
    ? `${typeof item.server === "string" && item.server ? `${item.server}.` : ""}${item.tool}`
    : null;
  const name = typeof item.name === "string" && item.name
    ? item.name
    : mcpName ?? (item.type === "command_execution" ? "Bash" : item.type);
  const input = item.arguments
    ?? item.input
    ?? (item.type === "command_execution" && typeof item.command === "string"
      ? { command: item.command }
      : undefined);
  if (event.type === "item.started" || event.type === "item.updated") return { kind: "tool_start", id: item.id, name, input };
  if (event.type === "item.completed" || event.type === "item.failed") {
    const exitCode = typeof item.exit_code === "number"
      ? item.exit_code
      : typeof item.exitCode === "number"
        ? item.exitCode
        : null;
    const isError = event.type === "item.failed" || item.status === "failed" || (exitCode !== null && Number.isFinite(exitCode) && exitCode !== 0);
    return {
      kind: "tool_end",
      id: item.id,
      name,
      ...(input !== undefined ? { input } : {}),
      output: safeOutput(item.aggregated_output || item.output || item.result || item.error),
      isError,
    };
  }
  return null;
}

/**
 * Splits only complete JSONL records. Text that is not a recognised Codex
 * record is returned untouched for AssistantFilter, so a future CLI cannot
 * make normal assistant prose disappear.
 */
export class CodexJsonlDecoder {
  private pending = "";
  private discardingOversizedRecord = false;
  // A `codex` line is common on captured pipes, but it can also be
  // user-requested assistant prose. Hold it until a valid thread preamble
  // proves protocol ownership, then consume it; otherwise preserve it.
  private pendingUntrustedMarker: string | null = null;
  // Codex's captured stream may start with its own `codex` marker. Never infer
  // protocol ownership from a JSON value alone unless the trusted outer
  // transport explicitly says these bytes came from Codex's JSONL pipe.
  private protocolArmed = false;
  private protocolActive = false;
  private readonly options: { trustThreadPreamble?: boolean; trustCodexMarker?: boolean };

  constructor(options: { trustThreadPreamble?: boolean; trustCodexMarker?: boolean } = {}) {
    this.options = options;
  }

  get hasPendingRecord(): boolean {
    return this.pending.length > 0 || this.pendingUntrustedMarker !== null || this.discardingOversizedRecord;
  }

  push(chunk: string, schema: CodexEventSchema): { events: CodexStreamEvent[]; passthrough: string; tokens: CodexDecodedToken[] } {
    if (this.discardingOversizedRecord) {
      const newline = chunk.indexOf("\n");
      if (newline < 0) return { events: [], passthrough: "", tokens: [] };
      this.discardingOversizedRecord = false;
      chunk = chunk.slice(newline + 1);
    }
    this.pending += chunk;
    if (this.pending.length > MAX_JSONL_PENDING_CHARS) {
      // Drop only the oversized record and consume through its next newline
      // before accepting later valid JSONL. Never retain attacker-controlled
      // partial data just because it lacks a newline.
      this.pending = "";
      this.discardingOversizedRecord = true;
      const event: CodexStreamEvent = { kind: "unknown", fingerprint: "oversized-jsonl" };
      return { events: [event], passthrough: "", tokens: [event] };
    }
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    const events: CodexStreamEvent[] = [];
    const passthrough: string[] = [];
    const tokens: CodexDecodedToken[] = [];
    const releaseUntrustedMarker = () => {
      if (!this.pendingUntrustedMarker) return;
      const text = this.pendingUntrustedMarker;
      this.pendingUntrustedMarker = null;
      passthrough.push(text);
      tokens.push({ kind: "passthrough", text });
    };
    for (const line of lines) {
      if (!line) continue;
      if (line.trim().toLowerCase() === "codex") {
        if (this.options.trustCodexMarker !== false) {
          this.protocolArmed = true;
          // This is a transport/startup marker, never assistant prose. It is
          // intentionally consumed here instead of relying on text heuristics
          // downstream to hide it.
          continue;
        }
        if (!this.protocolArmed && !this.protocolActive) {
          this.pendingUntrustedMarker = `${line}\n`;
          continue;
        }
      }
      try {
        const parsed = JSON.parse(line) as unknown;
        const frame = record(parsed);
        const rawType = typeof frame?.type === "string" ? frame.type : null;
        // A registry may add accepted outer event names. Once the marker has
        // armed this transport, consume every selected-schema frame instead
        // of leaking a harmless new control event as assistant JSON.
        const protocolType = !!rawType && schema.eventTypes.includes(rawType);
        // Keep protocol families reserved once a trusted thread preamble has
        // selected this stream. In particular, a newer Codex can add a
        // `response.*` control frame before Cave has a schema for it; that
        // frame must not be persisted as assistant JSON (where it can carry
        // control metadata or tool payloads). Ordinary JSON such as
        // `{ "type": "example" }` remains passthrough.
        const reservedProtocolType = !!rawType && (
          /^(?:thread|turn|item|response|rate_limits)\./.test(rawType)
          || rawType === "error"
          // Once Codex's own marker has established JSONL ownership (or a
          // trusted thread preamble has done so), a dotted `type` is a
          // protocol envelope even when the currently selected schema does
          // not know that event family yet.
          // Plain JSON examples such as `{ "type": "example" }` remain
          // passthrough, while future frames such as `rate_limits.updated`
          // cannot leak runtime metadata or tool payloads into the transcript.
          || ((this.protocolArmed || this.protocolActive) && rawType.includes("."))
        );
        const thread = record(frame?.thread);
        const sessionId = typeof frame?.thread_id === "string"
          ? frame.thread_id
          : typeof thread?.id === "string"
            ? thread.id
            : null;
        const validThreadPreamble = rawType === "thread.started" && !!sessionId;
        // The `codex` marker is an unambiguous transport boundary. The
        // marker-free captured-pipe transport also reserves documented
        // control families from its first frame so startup errors cannot leak
        // into prose; unrelated JSON/code remains visible until a complete
        // thread preamble establishes full protocol ownership.
        // A marker is transport proof. The marker-free captured-pipe path
        // instead needs a complete, valid `thread.started` preamble before it
        // owns later JSON records. In particular, do not let an assistant's
        // ordinary `{ type: "invoice.created" }` JSON response become an
        // unsupported protocol frame merely because it has a dotted type.
        // Once a native/attested JSONL boundary owns the stream, every JSON
        // envelope with a type is protocol data. Assistant-authored JSON is
        // conveyed inside a validated agent_message item, never as a raw
        // outer frame, so fail closed rather than leaking a future control
        // record into the transcript.
        const protocolFrame = this.protocolArmed || this.protocolActive
          ? !!rawType
          : this.options.trustThreadPreamble === true && (validThreadPreamble || reservedProtocolType);
        if (protocolFrame) {
          if (validThreadPreamble) {
            this.protocolActive = true;
            // The pending marker is now proven to be captured-pipe startup
            // metadata rather than assistant prose.
            this.pendingUntrustedMarker = null;
          }
          // Before a valid preamble, trusted control families are quarantined
          // as shape-only diagnostics. Do not let a startup `item.*` frame
          // manufacture a tool bubble or expose its arguments.
          const event = (this.protocolArmed || this.protocolActive)
            ? parseCodexStreamEvent(parsed, schema) ?? { kind: "unknown" as const, fingerprint: "unmapped-frame" }
            : rawType === "turn.failed" || rawType === "error"
              ? { kind: "failure" as const }
              : { kind: "unknown" as const, fingerprint: "prelude-control-frame" };
          events.push(event);
          tokens.push(event);
          continue;
        }
      } catch {
        if ((this.protocolArmed || this.protocolActive)
          && /"type"\s*:/.test(line)) {
          const event: CodexStreamEvent = { kind: "unknown", fingerprint: "malformed-jsonl" };
          events.push(event);
          tokens.push(event);
          continue;
        }
      }
      releaseUntrustedMarker();
      const text = `${line}\n`;
      passthrough.push(text);
      tokens.push({ kind: "passthrough", text });
    }
    return { events, passthrough: passthrough.join(""), tokens };
  }

  flush(schema: CodexEventSchema): { events: CodexStreamEvent[]; passthrough: string; tokens: CodexDecodedToken[] } {
    if (!this.pending) {
      if (!this.pendingUntrustedMarker) return { events: [], passthrough: "", tokens: [] };
      const text = this.pendingUntrustedMarker;
      this.pendingUntrustedMarker = null;
      return { events: [], passthrough: text, tokens: [{ kind: "passthrough", text }] };
    }
    return this.push("\n", schema);
  }
}
