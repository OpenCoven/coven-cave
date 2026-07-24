import { createPublicKey, verify } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
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
  const shape = (input: unknown, depth = 0): unknown => {
    if (depth >= 2) return Array.isArray(input) ? "array" : typeof input;
    if (Array.isArray(input)) return [input.length ? shape(input[0], depth + 1) : "empty"];
    if (!isRecord(input)) return typeof input;
    return Object.fromEntries(
      Object.entries(input)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, shape(child, depth + 1)]),
    );
  };
  return createHash("sha256").update(JSON.stringify(shape(value))).digest("hex").slice(0, 16);
}

const MAX_SCHEMA_BUNDLE_BYTES = 256 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_FILE = "opencode-schema-bundle-v1.json";

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

export function isOpenCodeSchemaBundle(value: unknown, now = Date.now()): value is OpenCodeSchemaBundle {
  if (!isRecord(value) || value.format !== 1 || value.runtime !== "opencode") return false;
  if (typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Array.isArray(value.schemas) || !value.schemas.every(isEventSchema)) return false;
  const issuedAt = Date.parse(String(value.issuedAt));
  const expiresAt = Date.parse(String(value.expiresAt));
  return Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && issuedAt <= now && expiresAt > now;
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
    const response = await (source.fetch ?? fetch)(url, { headers: { accept: "application/json" } });
    const raw = await response.text();
    if (!response.ok || Buffer.byteLength(raw, "utf8") > MAX_SCHEMA_BUNDLE_BYTES) throw new Error("untrusted schema bundle");
    const remote = JSON.parse(raw) as unknown;
    if (!verifyOpenCodeSchemaBundle(remote, publicKey, now)) throw new Error("invalid schema signature");
    if (cached && remote.sequence < cached.bundle.sequence) throw new Error("schema rollback");
    // A sequence identifies immutable parser semantics. A changed payload at
    // the same sequence is indistinguishable from a rollback to callers, so
    // retain the last-known-good cache even if it is freshly signed.
    if (cached && remote.sequence === cached.bundle.sequence) {
      if (openCodeSchemaBundleSigningPayload(remote) !== openCodeSchemaBundleSigningPayload(cached.bundle)) throw new Error("schema sequence rewritten");
      await mkdir(path.dirname(file), { recursive: true });
      await writeJsonAtomic(file, { checkedAt: now, bundle: cached.bundle });
      return { bundle: cached.bundle, source: "cache" };
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, { checkedAt: now, bundle: remote });
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
  const schema = loaded.bundle.schemas.find((candidate) => schemaMatches(candidate, capabilities));
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
