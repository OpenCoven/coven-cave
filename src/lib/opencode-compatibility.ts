import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";

export type OpenCodeRunCapabilities = {
  version: string | null;
  json: boolean;
  model: boolean;
  session: boolean;
};

export type OpenCodeEventSchema = {
  id: string;
  /** A schema is selected only when every advertised requirement is met. */
  requires: { json: true; session?: boolean; model?: boolean };
  eventTypes: {
    text: string[];
    toolStart: string[];
    toolEnd: string[];
    toolComplete: string[];
    error: string[];
  };
};

export type OpenCodeSchemaBundle = {
  format: 1;
  runtime: "opencode";
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  schemas: OpenCodeEventSchema[];
  signature?: { algorithm: "ed25519"; value: string };
};

export type OpenCodeCompatibility = {
  mode: "structured" | "plain";
  capabilities: OpenCodeRunCapabilities;
  schema?: OpenCodeEventSchema;
  bundleSource: "built-in" | "cache" | "remote";
  diagnostic?: OpenCodeCompatibilityDiagnostic;
};

/** These stable codes are intentionally safe to render or log. Never include event payloads. */
export type OpenCodeCompatibilityDiagnostic =
  | "json-format-unavailable"
  | "no-compatible-schema"
  | "schema-registry-refresh-rejected"
  | "cached-schema-unavailable";

/** A value-free event-shape identifier for diagnostics. It deliberately keeps
 * field names and primitive kinds, but never prompt text, paths, tool input,
 * output, credentials, or an unknown payload's values. */
export function redactedOpenCodeEventFingerprint(value: unknown): string {
  // Event payloads are open-ended maps: a provider can put a path, prompt, or
  // credential in either a value *or a key*. Only retain a small, fixed set of
  // transport-envelope fields, and represent input/output maps as opaque.
  // This keeps the fingerprint useful for envelope evolution without turning
  // diagnostics into a side channel for user data.
  const safeEnvelopeKeys = new Set([
    "type", "sessionID", "sessionId", "session_id", "part", "data", "state",
    "id", "callID", "callId", "toolCallId", "tool_call_id", "tool", "name", "status",
  ]);
  const payloadKeys = new Set(["input", "output", "error", "prompt", "text", "content"]);
  const shape = (input: unknown, depth = 0): unknown => {
    if (depth >= 3) return Array.isArray(input) ? "array" : typeof input;
    if (Array.isArray(input)) return input.length ? [shape(input[0], depth + 1)] : ["empty"];
    if (!isRecord(input)) return typeof input;
    const entries = Object.entries(input)
      .filter(([key]) => safeEnvelopeKeys.has(key) || payloadKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, payloadKeys.has(key) ? "redacted" : shape(child, depth + 1)]);
    return entries.length ? Object.fromEntries(entries) : "object";
  };
  return createHash("sha256").update(JSON.stringify(shape(value))).digest("hex").slice(0, 16);
}

const MAX_SCHEMA_BUNDLE_BYTES = 256 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_FILE = "opencode-schema-bundle-v1.json";
const REFRESH_TIMEOUT_MS = 5_000;
const CACHE_LOCK_STALE_MS = 30_000;

/**
 * Shipped schemas remain usable offline. Selection is capability-based: a
 * version string is recorded for support, but never used as a compatibility
 * threshold. Remote schemas can be added without releasing Cave.
 */
export const BUILTIN_OPENCODE_SCHEMA_BUNDLE: OpenCodeSchemaBundle = {
  format: 1,
  runtime: "opencode",
  sequence: 1,
  issuedAt: "2026-07-24T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  schemas: [
    {
      id: "opencode-run-json-v1",
      requires: { json: true, session: true },
      eventTypes: {
        text: ["text"],
        toolStart: ["tool_start", "tool"],
        toolEnd: ["tool_result"],
        toolComplete: ["tool_use", "tool"],
        error: ["error"],
      },
    },
    {
      // Earlier and preview clients used generic tool envelopes. Keeping this
      // separate lets a signed registry retire it without a code release.
      id: "opencode-run-json-legacy",
      requires: { json: true, session: false },
      eventTypes: {
        text: ["message", "assistant_text"],
        toolStart: ["tool"],
        toolEnd: ["tool_output"],
        toolComplete: ["tool_call"],
        error: ["error", "failed"],
      },
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEventSchema(value: unknown): value is OpenCodeEventSchema {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128 || !isRecord(value.eventTypes) || !isRecord(value.requires)) return false;
  if (value.requires.json !== true || (value.requires.session !== undefined && typeof value.requires.session !== "boolean") || (value.requires.model !== undefined && typeof value.requires.model !== "boolean")) return false;
  const eventKeys = ["text", "toolStart", "toolEnd", "toolComplete", "error"];
  const eventTypes = value.eventTypes;
  if (Object.keys(eventTypes).length !== eventKeys.length || !eventKeys.every((key) => Array.isArray(eventTypes[key]) && eventTypes[key].every((type: unknown) => typeof type === "string" && type.length > 0 && type.length <= 80))) return false;
  return true;
}

function schemaMatches(schema: OpenCodeEventSchema, capabilities: OpenCodeRunCapabilities): boolean {
  if (!capabilities.json) return false;
  if (schema.requires.session !== undefined && schema.requires.session !== capabilities.session) return false;
  if (schema.requires.model !== undefined && schema.requires.model !== capabilities.model) return false;
  return true;
}

function schemaSpecificity(schema: OpenCodeEventSchema): number {
  return Number(schema.requires.session !== undefined) + Number(schema.requires.model !== undefined);
}

/**
 * Select the most specific matching schema rather than trusting registry
 * order. A same-specificity tie means two schemas claim the identical observed
 * capability surface, so the caller must fail closed instead of guessing.
 */
export function selectOpenCodeSchema(
  schemas: OpenCodeEventSchema[],
  capabilities: OpenCodeRunCapabilities,
): OpenCodeEventSchema | null {
  const matches = schemas.filter((schema) => schemaMatches(schema, capabilities));
  if (!matches.length) return null;
  const specificity = Math.max(...matches.map(schemaSpecificity));
  const mostSpecific = matches.filter((schema) => schemaSpecificity(schema) === specificity);
  return mostSpecific.length === 1 ? mostSpecific[0] : null;
}

export function isOpenCodeSchemaBundle(value: unknown, now = Date.now()): value is OpenCodeSchemaBundle {
  if (!isRecord(value) || value.format !== 1 || value.runtime !== "opencode") return false;
  if (typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Array.isArray(value.schemas) || !value.schemas.every(isEventSchema)) return false;
  const issuedAt = Date.parse(String(value.issuedAt));
  const expiresAt = Date.parse(String(value.expiresAt));
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now || expiresAt <= now) return false;
  // A duplicated requirement profile would be an ambiguous same-specificity
  // selection for the corresponding client capabilities. Reject it at the
  // signed-bundle boundary, before it can affect a chat turn.
  const profiles = new Set<string>();
  for (const schema of value.schemas) {
    const profile = JSON.stringify(schema.requires);
    if (profiles.has(profile)) return false;
    profiles.add(profile);
  }
  return true;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

/** Canonical, payload-only representation used by the detached signature. */
export function openCodeSchemaBundleSigningPayload(bundle: OpenCodeSchemaBundle): string {
  const { signature: _signature, ...unsigned } = bundle;
  return stableJson(unsigned);
}

export function verifyOpenCodeSchemaBundle(bundle: unknown, publicKey: string, now = Date.now()): bundle is OpenCodeSchemaBundle {
  if (!isOpenCodeSchemaBundle(bundle, now) || !bundle.signature || bundle.signature.algorithm !== "ed25519") return false;
  try {
    return verify(null, Buffer.from(openCodeSchemaBundleSigningPayload(bundle)), createPublicKey(publicKey), Buffer.from(bundle.signature.value, "base64"));
  } catch {
    return false;
  }
}

type CachedBundle = { checkedAt: number; bundle: OpenCodeSchemaBundle };

function cachePath(): string {
  return path.join(caveHome(), CACHE_FILE);
}

async function readVerifiedCache(file: string, publicKey: string, now: number): Promise<CachedBundle | null> {
  try {
    const raw = await readFile(file, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_SCHEMA_BUNDLE_BYTES) return null;
    const cached = JSON.parse(raw) as CachedBundle;
    if (!isRecord(cached) || typeof cached.checkedAt !== "number" || !verifyOpenCodeSchemaBundle(cached.bundle, publicKey, now)) return null;
    return cached;
  } catch {
    return null;
  }
}

async function readResponseTextLimited(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SCHEMA_BUNDLE_BYTES) throw new Error("schema bundle too large");
  if (!response.body) {
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_SCHEMA_BUNDLE_BYTES) throw new Error("schema bundle too large");
    return raw;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_SCHEMA_BUNDLE_BYTES) throw new Error("schema bundle too large");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchSchemaBundle(url: string, fetcher: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("schema registry refresh timed out"));
    }, REFRESH_TIMEOUT_MS);
  });
  try {
    // Test and embedding fetch shims are not required to honor AbortSignal;
    // racing the timeout prevents a hung registry from delaying a chat turn.
    return await Promise.race([
      fetcher(url, { headers: { accept: "application/json" }, signal: controller.signal }),
      timedOut,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Keep a failed lock acquisition fail-closed for the cache: the caller can
 * still use its verified remote bundle for this turn, but it never races a
 * peer into replacing a newer last-known-good cache with an older sequence.
 */
async function staleLockCanBeReclaimed(lock: string): Promise<boolean> {
  try {
    const info = await stat(lock);
    if (Date.now() - info.mtimeMs < CACHE_LOCK_STALE_MS) return false;
    const owner = Number((await readFile(lock, "utf8")).trim());
    if (!Number.isSafeInteger(owner) || owner < 1) return true;
    try {
      process.kill(owner, 0);
      return false;
    } catch (error) {
      // EPERM means the process exists but this user cannot signal it.
      return (error as NodeJS.ErrnoException).code !== "EPERM";
    }
  } catch {
    return false;
  }
}

async function withCacheWriteLock<T>(file: string, callback: () => Promise<T>): Promise<T | null> {
  const lock = `${file}.lock`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const acquired = await open(lock, "wx", 0o600);
      try {
        await acquired.writeFile(String(process.pid));
      } catch (error) {
        await acquired.close().catch(() => undefined);
        await rm(lock, { force: true }).catch(() => undefined);
        throw error;
      }
      handle = acquired;
      break;
    } catch {
      if (attempt || !(await staleLockCanBeReclaimed(lock))) return null;
      // Move rather than unlink the stale lock: a competing refresher cannot
      // delete a newly acquired lock between its stale check and this cleanup.
      const stale = `${lock}.${process.pid}.${randomBytes(6).toString("hex")}.stale`;
      try {
        await rename(lock, stale);
        await rm(stale, { force: true });
      } catch {
        return null;
      }
    }
  }
  if (!handle) return null;
  try {
    return await callback();
  } finally {
    await handle.close().catch(() => undefined);
    await rm(lock, { force: true }).catch(() => undefined);
  }
}

export type OpenCodeSchemaBundleSource = {
  url?: string;
  publicKey?: string;
  fetch?: typeof fetch;
  now?: () => number;
  cacheFile?: string;
};

/**
 * Read a last-known-good schema bundle and opportunistically refresh it. A
 * remote bundle is accepted only with a configured Ed25519 key, valid dates,
 * a monotonic sequence, and a valid signature. Failed refreshes never replace
 * the old cache. This makes network loss and unsafe rollbacks non-events.
 */
export async function loadOpenCodeSchemaBundle(source: OpenCodeSchemaBundleSource = {}): Promise<{
  bundle: OpenCodeSchemaBundle;
  source: "built-in" | "cache" | "remote";
  diagnostic?: "schema-registry-refresh-rejected" | "cached-schema-unavailable";
}> {
  const now = source.now?.() ?? Date.now();
  const file = source.cacheFile ?? cachePath();
  const url = source.url ?? process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_URL;
  const publicKey = source.publicKey ?? process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY;
  if (!url || !publicKey) return { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in" };

  const cached = await readVerifiedCache(file, publicKey, now);
  const cacheFresh = cached && now - cached.checkedAt < CACHE_TTL_MS;
  if (cacheFresh) return { bundle: cached.bundle, source: "cache" };

  try {
    const response = await fetchSchemaBundle(url, source.fetch ?? fetch);
    const raw = await readResponseTextLimited(response);
    if (!response.ok) throw new Error("untrusted schema bundle");
    const remote = JSON.parse(raw) as unknown;
    if (!verifyOpenCodeSchemaBundle(remote, publicKey, now)) throw new Error("invalid schema signature");
    if (cached && remote.sequence < cached.bundle.sequence) throw new Error("schema rollback");
    // A sequence identifies immutable parser semantics. A changed payload at
    // the same sequence is indistinguishable from a rollback to callers, so
    // retain the last-known-good cache even if it is freshly signed.
    await mkdir(path.dirname(file), { recursive: true });
    const writeResult = await withCacheWriteLock(file, async () => {
      // Re-read after acquiring the lock. Another process may have refreshed
      // while this request was in flight, and the cache must never move back.
      const current = await readVerifiedCache(file, publicKey, now);
      if (current && remote.sequence < current.bundle.sequence) throw new Error("schema rollback");
      if (current && remote.sequence === current.bundle.sequence) {
        if (openCodeSchemaBundleSigningPayload(remote) !== openCodeSchemaBundleSigningPayload(current.bundle)) throw new Error("schema sequence rewritten");
        await writeJsonAtomic(file, { checkedAt: now, bundle: current.bundle });
        return { bundle: current.bundle, source: "cache" as const };
      }
      await writeJsonAtomic(file, { checkedAt: now, bundle: remote });
      return { bundle: remote, source: "remote" as const };
    });
    if (writeResult) return writeResult;
    // Do not overwrite a cache another process is refreshing. The remote was
    // independently verified and remains safe for this request.
    return { bundle: remote, source: "remote" };
  } catch {
    if (cached) return { bundle: cached.bundle, source: "cache", diagnostic: "schema-registry-refresh-rejected" };
    return { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "cached-schema-unavailable" };
  }
}

export async function resolveOpenCodeCompatibility(
  capabilities: OpenCodeRunCapabilities,
  source?: OpenCodeSchemaBundleSource,
): Promise<OpenCodeCompatibility> {
  const loaded = await loadOpenCodeSchemaBundle(source);
  if (!capabilities.json) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: loaded.source,
      diagnostic: "json-format-unavailable",
    };
  }
  const schema = selectOpenCodeSchema(loaded.bundle.schemas, capabilities);
  if (!schema) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: loaded.source,
      diagnostic: "no-compatible-schema",
    };
  }
  return {
    mode: "structured",
    capabilities,
    schema,
    bundleSource: loaded.source,
    diagnostic: loaded.diagnostic,
  };
}
