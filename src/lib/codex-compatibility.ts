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
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_RETRY_MS = 25;

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
  maxVersion?: string;
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
    // silently parsed as if its protocol were unchanged.
    maxVersion: "0.145.999",
    requiredCapabilities: { jsonEvents: true },
    eventTypes: ["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "item.failed", "error"],
    toolItemTypes: ["command_execution", "file_change", "mcp_tool_call", "web_search", "tool_call"],
    textItemTypes: ["agent_message"],
  },
  {
    id: "codex-jsonl-legacy-v1",
    schemaVersion: 1,
    minVersion: "0.0.0",
    maxVersion: "0.144.999",
    requiredCapabilities: { jsonEvents: true },
    eventTypes: ["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "item.failed", "error"],
    toolItemTypes: ["command_execution", "file_change", "mcp_tool_call", "web_search", "tool_call"],
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

type ParsedVersion = { core: [number, number, number]; prerelease: string[] | null };

export function parseCodexVersionOutput(output: string | null): string | null {
  if (!output) return null;
  // The version must end at a complete semver token. `\b` alone accepts the
  // first three components of malformed values such as `0.145.0.1`, because
  // the dot creates a word boundary after the patch component.
  return /(?:^|[^0-9A-Za-z.-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=$|[^0-9A-Za-z.-])/.exec(output)?.[1] ?? null;
}

function parsedVersion(version: string | null): ParsedVersion | null {
  const parsed = parseCodexVersionOutput(version);
  if (!parsed) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(parsed);
  if (!match) return null;
  const prerelease = match[4] ? match[4].split(".") : null;
  if (prerelease?.some((entry) => !entry || !/^[0-9A-Za-z-]+$/.test(entry))) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease };
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
    value.maxVersion
    && (!parsedVersion(value.maxVersion) || compareVersions(value.maxVersion, minVersion) < 0)
  ) return false;
  if (
    !isStringArray(value.eventTypes, MAX_EVENT_TYPES_PER_SCHEMA)
    || !isStringArray(value.toolItemTypes, MAX_ITEM_TYPES_PER_SCHEMA)
    || !isStringArray(value.textItemTypes, MAX_ITEM_TYPES_PER_SCHEMA)
  ) return false;
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
  options: { allowExpired?: boolean } = {},
): { ok: true; value: CodexSchemaDocument } | { ok: false; reason: "invalid" | "expired" | "hash" } {
  if (!document || typeof document !== "object") return { ok: false, reason: "invalid" };
  const value = document as CodexSchemaDocument;
  if (
    value.provenance?.registry !== "OpenCoven/coven-runtimes" ||
    typeof value.provenance.revision !== "string" ||
    value.provenance.revision.length === 0 ||
    value.provenance.revision.length > MAX_SCHEMA_STRING_LENGTH ||
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
    || fetchedAt > now.getTime() + MAX_SCHEMA_FUTURE_SKEW_MS
    || expiresAt <= fetchedAt
    || (!options.allowExpired && expiresAt <= now.getTime())
  ) {
    return { ok: false, reason: "expired" };
  }
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
  const issued = Date.parse(left.provenance.fetchedAt) - Date.parse(right.provenance.fetchedAt);
  if (issued !== 0) return issued;
  if (left.contentHash === right.contentHash) return 0;
  // Coarse registry clocks make two revisions with the same issue time
  // ambiguous. Refuse replacement rather than guessing an ordering and
  // letting a replayed document replace last-known-good state.
  return -1;
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

/**
 * The in-process queue prevents local contention; this lock protects the
 * shared per-user cache when two Cave processes refresh at the same time.
 * A stale lock is recoverable after a crashed writer, while a live lock only
 * causes the later refresh to retain the existing last-known-good document.
 */
async function acquireCacheWriteLock(cachePath: string): Promise<(() => Promise<void>) | null> {
  const lockPath = `${cachePath}.lock`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < CACHE_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(path.dirname(cachePath), { recursive: true });
      const handle = await open(lockPath, "wx", 0o600);
      const ownershipToken = crypto.randomUUID();
      await handle.writeFile(ownershipToken, "utf8");
      await handle.close();
      return async () => {
        try {
          // Never delete a replacement lock acquired by another process after
          // this writer finished. The token is an ownership proof, not merely
          // a stale-file hint.
          if ((await readFile(lockPath, "utf8")) === ownershipToken) await unlink(lockPath);
        } catch { /* best effort */ }
      };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "EEXIST") return null;
      try {
        const observed = await readFile(lockPath, "utf8");
        if (Date.now() - (await stat(lockPath)).mtimeMs > CACHE_LOCK_STALE_MS) {
          // Re-read immediately before removal: if a live writer replaced the
          // stale file, its ownership token changes and its lock is preserved.
          if ((await readFile(lockPath, "utf8")) === observed) await unlink(lockPath);
          continue;
        }
      } catch {
        // Another process released/replaced the lock between stat and unlink.
      }
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
  options: { allowExpired?: boolean } = {},
): Promise<CodexSchemaDocument | null> {
  try {
    if ((await stat(cachePath)).size > MAX_SCHEMA_DOCUMENT_BYTES) return null;
    const checked = validateCodexSchemaDocument(JSON.parse(await readFile(cachePath, "utf8")), now, options);
    return checked.ok && verifySignature(checked.value) ? checked.value : null;
  } catch {
    return null;
  }
}

/** Atomic replace keeps a power loss or interrupted refresh from erasing LKG. */
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
      const previous = await readCodexSchemaCache(cachePath, verifySignature, now, { allowExpired: true });
      if (previous && compareSchemaDocumentFreshness(checked.value, previous) <= 0) return false;
      const serialized = JSON.stringify(checked.value);
      if (Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_DOCUMENT_BYTES) return false;
      const dir = path.dirname(cachePath);
      const temp = `${cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(temp, serialized, { encoding: "utf8", mode: 0o600 });
        await rename(temp, cachePath);
        return true;
      } catch {
        try { await unlink(temp); } catch { /* best effort */ }
        return false;
      }
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
  if (cached) sources.push({ source: "cache", schemas: cached.schemas });

  // The runtime registry currently publishes adapter manifests, not signed
  // Codex event schemas. Do not silently poll a guessed URL: deployments that
  // operate a signed schema registry opt in explicitly, and stock clients keep
  // using the reviewed bootstrap schemas plus a verified LKG cache.
  const registryUrl = options.registryUrl ?? process.env.COVEN_CODEX_SCHEMA_REGISTRY_URL;
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
    .filter(({ schema }) => compareVersions(report.version!, schema.minVersion) >= 0 && (!schema.maxVersion || compareVersions(report.version!, schema.maxVersion) <= 0))
    .sort((left, right) => {
      const versionOrder = compareVersions(right.schema.minVersion, left.schema.minVersion);
      if (versionOrder !== 0) return versionOrder;
      const sourceOrder = precedence[right.source] - precedence[left.source];
      if (sourceOrder !== 0) return sourceOrder;
      return right.schema.id.localeCompare(left.schema.id);
    });
  const sawVersion = compatible.length > 0;
  for (const { source, schema } of compatible) {
    if (hasCapabilities(report, schema.requiredCapabilities)) {
      return { ok: true, schema, report, source };
    }
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

type CodexProbeCacheEntry = { report: CodexRuntimeReport; expiresAt: number; pending?: Promise<CodexRuntimeReport> };
let codexProbeCache: CodexProbeCacheEntry | null = null;
const CODEX_PROBE_SUCCESS_TTL_MS = 60_000;
const CODEX_PROBE_FAILURE_TTL_MS = 10_000;

export function clearCodexRuntimeDiscoveryCache(): void {
  codexProbeCache = null;
}

/** Safe local discovery; failures become an explicit unavailable report. */
export async function discoverCodexRuntime(
  command = "codex",
  timeout = 1_500,
  env?: NodeJS.ProcessEnv,
): Promise<CodexRuntimeReport> {
  try {
    // `codex` is normally an npm `.cmd` shim on Windows. The argv is fixed
    // by this module (never request-supplied), so Node's shell bridge is used
    // only there to let Windows resolve the shim safely.
    const windowsShim = process.platform === "win32";
    const [{ stdout: versionOut, stderr: versionErr }, { stdout: helpOut, stderr: helpErr }] = await Promise.all([
      execFileAsync(command, ["--version"], { timeout, windowsHide: true, env, shell: windowsShim }),
      execFileAsync(command, ["exec", "--help"], { timeout, windowsHide: true, env, shell: windowsShim }),
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
  command = "codex",
  timeout = 1_500,
  env = codexProbeEnv(),
  now = Date.now(),
): Promise<CodexRuntimeReport> {
  return startCodexRuntimeDiscovery(command, timeout, env, now);
}

function startCodexRuntimeDiscovery(
  command: string,
  timeout: number,
  env: NodeJS.ProcessEnv,
  now: number,
): Promise<CodexRuntimeReport> {
  const cached = codexProbeCache;
  if (cached && cached.expiresAt > now) return cached.pending ?? Promise.resolve(cached.report);
  const pending = discoverCodexRuntime(command, timeout, env).then((report) => {
    codexProbeCache = {
      report,
      expiresAt: Date.now() + (report.version ? CODEX_PROBE_SUCCESS_TTL_MS : CODEX_PROBE_FAILURE_TTL_MS),
    };
    return report;
  });
  codexProbeCache = {
    report: cached?.report ?? { version: null, capabilities: { jsonEvents: false, resume: false } },
    expiresAt: now + timeout,
    pending,
  };
  return pending;
}

/**
 * Return the last probe result immediately and warm a stale entry in the
 * background. A cold process spawn must not put a chat request on the critical
 * path; that first turn safely uses the text-only fallback while later turns
 * use the cached, capability-gated schema.
 */
export function peekCachedCodexRuntime(
  command = "codex",
  timeout = 1_500,
  env = codexProbeEnv(),
  now = Date.now(),
): CodexRuntimeReport {
  const cached = codexProbeCache;
  if (!cached || cached.expiresAt <= now) {
    void startCodexRuntimeDiscovery(command, timeout, env, now);
  }
  return cached?.report ?? { version: null, capabilities: { jsonEvents: false, resume: false } };
}

export type CodexStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "session"; sessionId: string }
  | { kind: "tool_start"; id: string; name: string; input?: unknown }
  | { kind: "tool_end"; id: string; output?: string; isError: boolean }
  | { kind: "unknown"; fingerprint: string }
  | { kind: "ignored" };

export type CodexDecodedToken =
  | CodexStreamEvent
  | { kind: "passthrough"; text: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeOutput(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value == null) return undefined;
  try { return JSON.stringify(value); } catch { return undefined; }
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
  if (event.type === "turn.started" || event.type === "turn.completed" || event.type === "turn.failed") {
    return { kind: "ignored" };
  }
  if (event.type === "error") return { kind: "unknown", fingerprint: eventFingerprint(event) };
  const item = record(event.item);
  if (!item) return { kind: "unknown", fingerprint: eventFingerprint(event) };
  if (typeof item.type === "string" && schema.textItemTypes.includes(item.type)) {
    return event.type === "item.completed" && typeof item.text === "string"
      ? { kind: "text", text: item.text }
      : { kind: "unknown", fingerprint: eventFingerprint(event) };
  }
  if (
    (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed" || event.type === "item.failed") &&
    (typeof item.id !== "string" || typeof item.type !== "string" || !schema.toolItemTypes.includes(item.type))
  ) {
    return { kind: "unknown", fingerprint: eventFingerprint(event) };
  }
  if (typeof item.id !== "string" || typeof item.type !== "string" || !schema.toolItemTypes.includes(item.type)) return { kind: "unknown", fingerprint: eventFingerprint(event) };
  const name = typeof item.name === "string" ? item.name : item.type === "command_execution" ? "Bash" : item.type;
  const input = item.arguments ?? item.input ?? (item.type === "command_execution" ? { command: item.command } : undefined);
  if (event.type === "item.started" || event.type === "item.updated") return { kind: "tool_start", id: item.id, name, input };
  if (event.type === "item.completed" || event.type === "item.failed") {
    const exitCode = typeof item.exit_code === "number"
      ? item.exit_code
      : typeof item.exitCode === "number"
        ? item.exitCode
        : null;
    const isError = event.type === "item.failed" || item.status === "failed" || (exitCode !== null && Number.isFinite(exitCode) && exitCode !== 0);
    return { kind: "tool_end", id: item.id, output: safeOutput(item.aggregated_output ?? item.output ?? item.error), isError };
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
  // Codex's captured stream may start with its own `codex` marker. Never infer
  // protocol ownership from a JSON value alone unless the trusted outer
  // transport explicitly says these bytes came from Codex's JSONL pipe.
  private protocolArmed = false;
  private protocolActive = false;
  private readonly options: { trustThreadPreamble?: boolean };

  constructor(options: { trustThreadPreamble?: boolean } = {}) {
    this.options = options;
  }

  get hasPendingRecord(): boolean {
    return this.pending.length > 0;
  }

  push(chunk: string, schema: CodexEventSchema): { events: CodexStreamEvent[]; passthrough: string; tokens: CodexDecodedToken[] } {
    this.pending += chunk;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    const events: CodexStreamEvent[] = [];
    const passthrough: string[] = [];
    const tokens: CodexDecodedToken[] = [];
    for (const line of lines) {
      if (!line) continue;
      if (line.trim().toLowerCase() === "codex") {
        this.protocolArmed = true;
        // This is a transport/startup marker, never assistant prose. It is
        // intentionally consumed here instead of relying on text heuristics
        // downstream to hide it.
        continue;
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
          /^(?:thread|turn|item|response)\./.test(rawType)
          || rawType === "error"
          // Once Codex's own marker has established JSONL ownership (or a
          // trusted thread preamble has done so), a dotted `type` is a
          // protocol envelope even when the currently selected schema does
          // not know that event family yet.
          // Plain JSON examples such as `{ "type": "example" }` remain
          // passthrough, while future frames such as `rate_limits.updated`
          // cannot leak runtime metadata or tool payloads into the transcript.
          || ((this.protocolArmed || this.protocolActive || this.options.trustThreadPreamble === true) && rawType.includes("."))
        );
        const thread = record(frame?.thread);
        const sessionId = typeof frame?.thread_id === "string"
          ? frame.thread_id
          : typeof thread?.id === "string"
            ? thread.id
            : null;
        const validThreadPreamble = rawType === "thread.started" && !!sessionId;
        // The `codex` marker is an unambiguous transport boundary. Consume
        // malformed first frames after it as shape-only diagnostics instead
        // of passing their tool/control payload through as assistant prose.
        // The Windows captured-pipe transport marks its bytes as trusted at
        // construction, so it receives the same protection even if its first
        // thread.started frame is malformed. Decoders without either transport
        // proof still leave ordinary JSON/code examples untouched.
        const protocolFrame = (this.protocolArmed || this.options.trustThreadPreamble === true)
          && (protocolType || reservedProtocolType);
        if (protocolFrame) {
          if (validThreadPreamble) this.protocolActive = true;
          const event = parseCodexStreamEvent(parsed, schema) ?? { kind: "unknown" as const, fingerprint: "unmapped-frame" };
          events.push(event);
          tokens.push(event);
          continue;
        }
      } catch {
        if ((this.protocolActive || this.options.trustThreadPreamble === true) && /"type"\s*:\s*"[^"\\.\s]+(?:\.[^"\\.\s]+)+"/.test(line)) {
          const event: CodexStreamEvent = { kind: "unknown", fingerprint: "malformed-jsonl" };
          events.push(event);
          tokens.push(event);
          continue;
        }
      }
      const text = `${line}\n`;
      passthrough.push(text);
      tokens.push({ kind: "passthrough", text });
    }
    return { events, passthrough: passthrough.join(""), tokens };
  }

  flush(schema: CodexEventSchema): { events: CodexStreamEvent[]; passthrough: string; tokens: CodexDecodedToken[] } {
    if (!this.pending) return { events: [], passthrough: "", tokens: [] };
    return this.push("\n", schema);
  }
}
