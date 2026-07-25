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
  /** Explicit, documented structured-output format values from `run --help`. */
  protocols: string[];
};

export type OpenCodeEventSchema = {
  id: string;
  /** A schema is selected only when every advertised requirement is met. */
  requires: { json: true; session?: boolean; model?: boolean; protocol?: string };
  eventTypes: {
    /** Documented lifecycle/status frames that carry no renderable content. */
    ignored: string[];
    text: string[];
    toolStart: string[];
    toolEnd: string[];
    toolComplete: string[];
    error: string[];
  };
  /**
   * Bounded, declarative parser contract for a compatible JSON envelope.
   * Values are direct field aliases only — arbitrary JSON paths or executable
   * selectors are deliberately not accepted from the remote registry.
   */
  shape: {
    envelope: Array<"part" | "data" | "payload" | "root">;
    sessionId: string[];
    id: string[];
    name: string[];
    text: string[];
    state: string[];
    input: string[];
    output: string[];
    error: string[];
    status: string[];
    terminalStates: string[];
    errorStates: string[];
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

type LoadedOpenCodeSchemaBundle = {
  bundle: OpenCodeSchemaBundle;
  source: "built-in" | "cache" | "remote";
  diagnostic?: "schema-registry-refresh-rejected" | "cached-schema-unavailable";
};

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
const REFRESH_FAILURE_BACKOFF_MS = 60_000;
const refreshFlights = new Map<string, Promise<LoadedOpenCodeSchemaBundle>>();
const refreshRetryAt = new Map<string, number>();

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
      requires: { json: true, session: true, protocol: "json" },
      eventTypes: {
        ignored: ["step_start", "step_finish", "reasoning"],
        text: ["text"],
        toolStart: ["tool_start", "tool"],
        toolEnd: ["tool_result"],
        toolComplete: ["tool_use", "tool"],
        error: ["error"],
      },
      shape: {
        envelope: ["part", "data", "root"],
        sessionId: ["sessionID", "sessionId", "session_id"],
        id: ["id", "callID", "callId", "toolCallId", "tool_call_id"],
        name: ["tool", "name"], text: ["text", "content"], state: ["state"], input: ["input"], output: ["output"], error: ["error"], status: ["status"],
        terminalStates: ["completed", "complete", "error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"],
        errorStates: ["error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"],
      },
    },
    {
      // Earlier and preview clients used generic tool envelopes. Keeping this
      // separate lets a signed registry retire it without a code release.
      id: "opencode-run-json-legacy",
      requires: { json: true, session: false, protocol: "json" },
      eventTypes: {
        ignored: ["step_start", "step_finish", "reasoning"],
        text: ["message", "assistant_text"],
        toolStart: ["tool"],
        toolEnd: ["tool_output"],
        toolComplete: ["tool_call"],
        error: ["error", "failed"],
      },
      shape: {
        envelope: ["part", "data", "root"],
        sessionId: ["sessionID", "sessionId", "session_id"],
        id: ["id", "callID", "callId", "toolCallId", "tool_call_id"],
        name: ["tool", "name"], text: ["text", "content"], state: ["state"], input: ["input"], output: ["output"], error: ["error"], status: ["status"],
        terminalStates: ["completed", "complete", "error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"],
        errorStates: ["error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"],
      },
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasBoundedAliases(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 16
    && value.every((alias) => typeof alias === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(alias));
}

function hasValidShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const aliasKeys = ["sessionId", "id", "name", "text", "state", "input", "output", "error", "status", "terminalStates", "errorStates"];
  if (!Object.keys(value).every((key) => key === "envelope" || aliasKeys.includes(key))) return false;
  if (!Array.isArray(value.envelope) || value.envelope.length === 0 || value.envelope.length > 4 || !value.envelope.includes("root") || !value.envelope.every((field) => field === "part" || field === "data" || field === "payload" || field === "root")) return false;
  return aliasKeys.every((key) => hasBoundedAliases(value[key]));
}

function isEventSchema(value: unknown): value is OpenCodeEventSchema {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128 || !isRecord(value.eventTypes) || !isRecord(value.requires)) return false;
  if (!hasValidShape(value.shape)) return false;
  if (!Object.keys(value.requires).every((key) => key === "json" || key === "session" || key === "model" || key === "protocol")) return false;
  if (value.requires.json !== true || (value.requires.session !== undefined && typeof value.requires.session !== "boolean") || (value.requires.model !== undefined && typeof value.requires.model !== "boolean") || (value.requires.protocol !== undefined && (typeof value.requires.protocol !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.requires.protocol)))) return false;
  const eventKeys: Array<keyof OpenCodeEventSchema["eventTypes"]> = ["ignored", "text", "toolStart", "toolEnd", "toolComplete", "error"];
  // `isRecord` deliberately narrows external JSON to unknown values. Keep that
  // boundary while validating, then use the internal shape for the duplicate
  // label checks below.
  const eventTypes = value.eventTypes as unknown as OpenCodeEventSchema["eventTypes"];
  if (Object.keys(eventTypes).length !== eventKeys.length || !eventKeys.every((key) => Array.isArray(eventTypes[key]) && eventTypes[key].length > 0 && eventTypes[key].length <= 32 && eventTypes[key].every((type: unknown) => typeof type === "string" && type.length > 0 && type.length <= 80))) return false;
  const nonToolLabels = new Set<string>();
  for (const key of ["ignored", "text", "error", "toolEnd"] as const) {
    for (const label of eventTypes[key] as unknown[]) {
      if (nonToolLabels.has(label as string)) return false;
      nonToolLabels.add(label as string);
    }
  }
  const toolLabels = [
    ...(eventTypes.toolStart as string[]),
    ...(eventTypes.toolComplete as string[]),
  ];
  if (toolLabels.some((label) => nonToolLabels.has(label))) return false;
  return true;
}

function schemaMatches(schema: OpenCodeEventSchema, capabilities: OpenCodeRunCapabilities): boolean {
  if (!capabilities.json) return false;
  if (schema.requires.session !== undefined && schema.requires.session !== capabilities.session) return false;
  if (schema.requires.model !== undefined && schema.requires.model !== capabilities.model) return false;
  // Older callers/tests did not carry protocol markers; their documented JSON
  // surface is the v1 `json` protocol. New probes always populate this list.
  const protocols = capabilities.protocols ?? (capabilities.json ? ["json"] : []);
  if (schema.requires.protocol !== undefined && !protocols.includes(schema.requires.protocol)) return false;
  return true;
}

function schemaSpecificity(schema: OpenCodeEventSchema): number {
  return Number(schema.requires.session !== undefined) + Number(schema.requires.model !== undefined) + Number(schema.requires.protocol !== undefined);
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

const CANONICAL_RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !CANONICAL_RFC3339_UTC.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

export function isOpenCodeSchemaBundle(
  value: unknown,
  now = Date.now(),
  options: { allowExpired?: boolean } = {},
): value is OpenCodeSchemaBundle {
  if (!isRecord(value) || value.format !== 1 || value.runtime !== "opencode") return false;
  if (typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Array.isArray(value.schemas) || value.schemas.length === 0 || value.schemas.length > 64 || !value.schemas.every(isEventSchema)) return false;
  const issuedAt = parseCanonicalTimestamp(value.issuedAt);
  const expiresAt = parseCanonicalTimestamp(value.expiresAt);
  if (issuedAt === null || expiresAt === null || issuedAt > now || expiresAt <= issuedAt || (!options.allowExpired && expiresAt <= now)) return false;
  // A duplicated requirement profile would be an ambiguous same-specificity
  // selection for the corresponding client capabilities. Reject it at the
  // signed-bundle boundary, before it can affect a chat turn.
  const profiles = new Set<string>();
  const ids = new Set<string>();
  for (const schema of value.schemas) {
    const profile = stableJson(schema.requires);
    if (profiles.has(profile) || ids.has(schema.id)) return false;
    profiles.add(profile);
    ids.add(schema.id);
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

export function verifyOpenCodeSchemaBundle(
  bundle: unknown,
  publicKey: string,
  now = Date.now(),
  options: { allowExpired?: boolean } = {},
): bundle is OpenCodeSchemaBundle {
  if (!isOpenCodeSchemaBundle(bundle, now, options) || !bundle.signature || bundle.signature.algorithm !== "ed25519") return false;
  try {
    // Buffer's base64 decoder silently ignores malformed trailing characters.
    // Require the registry's encoding to round-trip before verification.
    const encoded = bundle.signature.value;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
    const signature = Buffer.from(encoded, "base64");
    if (!signature.length || signature.toString("base64") !== encoded) return false;
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== "ed25519") return false;
    return verify(null, Buffer.from(openCodeSchemaBundleSigningPayload(bundle)), key, signature);
  } catch {
    return false;
  }
}

type CachedBundle = { checkedAt: number; bundle: OpenCodeSchemaBundle };

function cachePath(): string {
  return path.join(caveHome(), CACHE_FILE);
}

/**
 * Expired bundles are never selected for parsing, but their verified identity
 * remains a trust floor. Without it, expiry would create a downgrade window
 * where a signed lower sequence (or rewritten equal sequence) could replace
 * the durable cache.
 */
async function readCachedTrustState(file: string, publicKey: string, now: number): Promise<CachedBundle | null> {
  try {
    const raw = await readFile(file, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_SCHEMA_BUNDLE_BYTES) return null;
    const cached = JSON.parse(raw) as CachedBundle;
    if (
      !isRecord(cached)
      || typeof cached.checkedAt !== "number"
      || !Number.isFinite(cached.checkedAt)
      || !verifyOpenCodeSchemaBundle(cached.bundle, publicKey, now, { allowExpired: true })
    ) return null;
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
    const owner = Number((await readFile(lock, "utf8")).trim().split(":", 1)[0]);
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

async function readVerifiedCache(file: string, publicKey: string, now: number): Promise<CachedBundle | null> {
  const cached = await readCachedTrustState(file, publicKey, now);
  if (
    !cached
    // The wrapper is not signed; a future timestamp must not pin an old,
    // otherwise valid bundle and suppress all subsequent registry refreshes.
    || cached.checkedAt > now
    || !verifyOpenCodeSchemaBundle(cached.bundle, publicKey, now)
  ) return null;
  return cached;
}

async function releaseCacheLock(lock: string, ownerToken: string): Promise<void> {
  try {
    // Never unlink a lock that was reclaimed and replaced after an unusually
    // slow filesystem operation. The unique token makes release ownership
    // explicit across processes and antivirus/filesystem stalls.
    if ((await readFile(lock, "utf8")) !== ownerToken) return;
    await rm(lock, { force: true });
  } catch {
    // A concurrent stale-lock recovery or shutdown already cleaned it up.
  }
}

async function withCacheWriteLock<T>(file: string, callback: () => Promise<T>): Promise<T | null> {
  const lock = `${file}.lock`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  const ownerToken = `${process.pid}:${randomBytes(16).toString("hex")}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const acquired = await open(lock, "wx", 0o600);
      try {
        await acquired.writeFile(ownerToken);
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
    await releaseCacheLock(lock, ownerToken);
  }
}

export type OpenCodeSchemaBundleSource = {
  url?: string;
  publicKey?: string;
  fetch?: typeof fetch;
  now?: () => number;
  cacheFile?: string;
};

// Release builds inject these public values at compile time. Server-side
// overrides retain local test and operator support without changing the
// packaged trust anchor.
const PACKAGED_REGISTRY_URL = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL;
const PACKAGED_REGISTRY_PUBLIC_KEY = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY;

function schemaRefreshKey(file: string, url: string, publicKey: string): string {
  return createHash("sha256").update(`${file}\0${url}\0${publicKey}`).digest("hex");
}

async function refreshOpenCodeSchemaBundle(
  file: string,
  url: string,
  publicKey: string,
  fetcher: typeof fetch,
  now: number,
): Promise<LoadedOpenCodeSchemaBundle> {
  const response = await fetchSchemaBundle(url, fetcher);
  const raw = await readResponseTextLimited(response);
  if (!response.ok) throw new Error("untrusted schema bundle");
  const remote = JSON.parse(raw) as unknown;
  if (!verifyOpenCodeSchemaBundle(remote, publicKey, now)) throw new Error("invalid schema signature");
  const cachedTrust = await readCachedTrustState(file, publicKey, now);
  if (cachedTrust && remote.sequence < cachedTrust.bundle.sequence) throw new Error("schema rollback");
  await mkdir(path.dirname(file), { recursive: true });
  const writeResult = await withCacheWriteLock(file, async () => {
    // Re-read after acquiring the lock. Another process may have refreshed
    // while this request was in flight, and the cache must never move back.
    const currentTrust = await readCachedTrustState(file, publicKey, now);
    if (currentTrust && remote.sequence < currentTrust.bundle.sequence) throw new Error("schema rollback");
    if (currentTrust && remote.sequence === currentTrust.bundle.sequence) {
      if (openCodeSchemaBundleSigningPayload(remote) !== openCodeSchemaBundleSigningPayload(currentTrust.bundle)) throw new Error("schema sequence rewritten");
      // The just-verified remote payload is byte-for-byte the same signed
      // contract, so it is safe to refresh only the unsigned cache freshness.
      await writeJsonAtomic(file, { checkedAt: now, bundle: remote });
      return { bundle: remote, source: "remote" as const };
    }
    await writeJsonAtomic(file, { checkedAt: now, bundle: remote });
    return { bundle: remote, source: "remote" as const };
  });
  if (writeResult) return writeResult;
  // A concurrent writer can have installed a newer sequence while this
  // request held an older verified response. Never select that older parser
  // for this turn merely because the lock was busy.
  const current = await readVerifiedCache(file, publicKey, now);
  if (current && current.bundle.sequence >= remote.sequence) {
    return { bundle: current.bundle, source: "cache" };
  }
  return { bundle: remote, source: "remote" };
}

function startSchemaRefresh(
  key: string,
  refresh: () => Promise<LoadedOpenCodeSchemaBundle>,
  now: number,
): Promise<LoadedOpenCodeSchemaBundle> {
  const running = refreshFlights.get(key);
  if (running) return running;
  const flight = refresh()
    .then((result) => {
      refreshRetryAt.delete(key);
      return result;
    })
    .catch((error) => {
      refreshRetryAt.set(key, now + REFRESH_FAILURE_BACKOFF_MS);
      throw error;
    })
    .finally(() => refreshFlights.delete(key));
  refreshFlights.set(key, flight);
  return flight;
}

/**
 * Read a last-known-good schema bundle and opportunistically refresh it. A
 * remote bundle is accepted only with a configured Ed25519 key, valid dates,
 * a monotonic sequence, and a valid signature. Failed refreshes never replace
 * the old cache. This makes network loss and unsafe rollbacks non-events.
 */
export async function loadOpenCodeSchemaBundle(source: OpenCodeSchemaBundleSource = {}): Promise<LoadedOpenCodeSchemaBundle> {
  const now = source.now?.() ?? Date.now();
  const file = source.cacheFile ?? cachePath();
  const url = source.url ?? process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_URL ?? PACKAGED_REGISTRY_URL;
  const publicKey = source.publicKey ?? process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY ?? PACKAGED_REGISTRY_PUBLIC_KEY;
  if (!url || !publicKey) return { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in" };

  const cached = await readVerifiedCache(file, publicKey, now);
  const cacheFresh = cached && now - cached.checkedAt < CACHE_TTL_MS;
  if (cacheFresh) return { bundle: cached.bundle, source: "cache" };
  const key = schemaRefreshKey(file, url, publicKey);
  if ((refreshRetryAt.get(key) ?? 0) > now) {
    return cached
      ? { bundle: cached.bundle, source: "cache", diagnostic: "schema-registry-refresh-rejected" }
      : { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "cached-schema-unavailable" };
  }
  const refresh = startSchemaRefresh(
    key,
    () => refreshOpenCodeSchemaBundle(file, url, publicKey, source.fetch ?? fetch, now),
    now,
  );
  if (cached) {
    // A stale but verified parser is safer than delaying a chat behind a
    // registry outage. One in-flight refresh updates it for later turns.
    void refresh.catch(() => undefined);
    return { bundle: cached.bundle, source: "cache" };
  }
  try {
    return await refresh;
  } catch {
    return { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "cached-schema-unavailable" };
  }
}

export async function resolveOpenCodeCompatibility(
  capabilities: OpenCodeRunCapabilities,
  source?: OpenCodeSchemaBundleSource,
): Promise<OpenCodeCompatibility> {
  if (!capabilities.json) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: "built-in",
      diagnostic: "json-format-unavailable",
    };
  }
  const loaded = await loadOpenCodeSchemaBundle(source);
  // A configured registry with no currently verified cache must not silently
  // fall back to a potentially older compiled parser. Keep plain chat until a
  // signed schema for this client can be verified again.
  if (loaded.diagnostic === "cached-schema-unavailable") {
    return {
      mode: "plain",
      capabilities,
      bundleSource: loaded.source,
      diagnostic: "cached-schema-unavailable",
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
