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
  /** Declared `run` option names and structured-output option/value pairs. */
  options?: string[];
  /** Declared run flags that take no value and are safe to forward verbatim. */
  noValueOptions?: string[];
  structuredOutputs?: Array<{ option: string; values: string[] }>;
};

/** A direct field or a bounded two-segment envelope path. */
export type OpenCodeEnvelopePath = string | [string, string];
export type OpenCodeRegistryKeyring = Record<string, string>;

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
    envelope: OpenCodeEnvelopePath[];
    /** The bounded location and alias that identifies the event kind. */
    discriminator: {
      envelope: OpenCodeEnvelopePath;
      field: string;
    };
    /** Envelope(s) explicitly trusted to carry assistant text. */
    textEnvelope?: OpenCodeEnvelopePath[];
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
  /** Bounded argv contract, confirmed against the installed client's help. */
  launch: {
    structuredOutput: { option: string; value: string };
    sessionOption?: "--session" | "--resume";
    requiredFlags: string[];
  };
};

export type OpenCodeSchemaBundle = {
  format: 1;
  runtime: "opencode";
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  /** Signed registry-key identifier; required when a keyring has more than one key. */
  keyId?: string;
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
  | "schema-quarantined"
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
// A selected schema that emits an unknown or malformed frame is unsafe for
// further structured launches in this process. Keep the bounded quarantine by
// schema identity so a registry update with a new profile can recover without
// replaying the incompatible turn (which may already have run tools).
const quarantinedSchemaIds = new Set<string>();
const MAX_QUARANTINED_SCHEMA_IDS = 64;

export function quarantineOpenCodeSchema(schema: OpenCodeEventSchema | undefined): void {
  if (!schema || quarantinedSchemaIds.has(schema.id)) return;
  if (quarantinedSchemaIds.size >= MAX_QUARANTINED_SCHEMA_IDS) {
    const oldest = quarantinedSchemaIds.values().next();
    if (!oldest.done) quarantinedSchemaIds.delete(oldest.value);
  }
  quarantinedSchemaIds.add(schema.id);
}

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
        discriminator: { envelope: "root", field: "type" },
        textEnvelope: ["part", "data"],
        sessionId: ["sessionID", "sessionId", "session_id"],
        id: ["id", "callID", "callId", "toolCallId", "tool_call_id"],
        name: ["tool", "name"], text: ["text", "content"], state: ["state"], input: ["input"], output: ["output"], error: ["error"], status: ["status"],
        terminalStates: ["completed", "complete", "error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"],
        errorStates: ["error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"],
      },
      launch: { structuredOutput: { option: "--format", value: "json" }, sessionOption: "--session", requiredFlags: [] },
    },
    {
      // Earlier and preview clients used generic tool envelopes. Their
      // `json` format is not distinguishable from the current envelope by
      // flags alone, so it must advertise this separate protocol marker
      // before structured parsing is allowed. A client that only says
      // `--format json` safely uses plain output until a verified schema can
      // prove its envelope contract.
      id: "opencode-run-json-legacy",
      requires: { json: true, session: false, protocol: "json-legacy" },
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
        discriminator: { envelope: "root", field: "type" },
        textEnvelope: ["part", "data"],
        sessionId: ["sessionID", "sessionId", "session_id"],
        id: ["id", "callID", "callId", "toolCallId", "tool_call_id"],
        name: ["tool", "name"], text: ["text", "content"], state: ["state"], input: ["input"], output: ["output"], error: ["error"], status: ["status"],
        terminalStates: ["completed", "complete", "error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"],
        errorStates: ["error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"],
      },
      launch: { structuredOutput: { option: "--format", value: "json-legacy" }, requiredFlags: [] },
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

function hasValidEnvelopePath(value: unknown): value is OpenCodeEnvelopePath {
  if (typeof value === "string") return value === "root" || /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value);
  return Array.isArray(value)
    && value.length === 2
    && value.every((segment) => typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(segment));
}

function hasValidShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const aliasKeys = ["sessionId", "id", "name", "text", "state", "input", "output", "error", "status", "terminalStates", "errorStates"];
  const envelopeFields = (fields: unknown): fields is OpenCodeEnvelopePath[] =>
    Array.isArray(fields)
    && fields.length > 0
    && fields.length <= 4
    && fields.every(hasValidEnvelopePath);
  if (!Object.keys(value).every((key) => key === "envelope" || key === "textEnvelope" || key === "discriminator" || aliasKeys.includes(key))) return false;
  if (!envelopeFields(value.envelope) || (value.textEnvelope !== undefined && !envelopeFields(value.textEnvelope))) return false;
  if (!isRecord(value.discriminator)
    || !Object.keys(value.discriminator).every((key) => key === "envelope" || key === "field")
    || !hasValidEnvelopePath(value.discriminator.envelope)
    || typeof value.discriminator.field !== "string"
    || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value.discriminator.field)) return false;
  return aliasKeys.every((key) => hasBoundedAliases(value[key]));
}

const SAFE_STRUCTURED_LAUNCH_OPTION = /^--[a-z0-9-]*(?:format|output|json|event|stream)[a-z0-9-]*$/i;
const UNSAFE_STRUCTURED_LAUNCH_OPTIONS = new Set([
  "--auto", "--permission", "--sandbox", "--skip-permissions", "--dangerously-skip-permissions", "--trust-all-tools", "--yolo",
]);
// A registry describes how to frame and parse a stream; it must never widen
// what an OpenCode invocation is allowed to do. Keep the remotely supplied
// companion flags to the small, audited set that only requests event framing.
const SAFE_STRUCTURED_REQUIRED_FLAGS = new Set(["--event-stream"]);

function safeStructuredLaunchOption(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 80
    && SAFE_STRUCTURED_LAUNCH_OPTION.test(value)
    && !UNSAFE_STRUCTURED_LAUNCH_OPTIONS.has(value.toLowerCase());
}

function hasValidLaunch(value: unknown, requires: Record<string, unknown>): boolean {
  if (!isRecord(value) || !Array.isArray(value.requiredFlags)) return false;
  if (!Object.keys(value).every((key) => key === "structuredOutput" || key === "sessionOption" || key === "requiredFlags")) return false;
  const structuredOutput = value.structuredOutput;
  if (!isRecord(structuredOutput)) return false;
  if (!Object.keys(structuredOutput).every((key) => key === "option" || key === "value")) return false;
  if (!safeStructuredLaunchOption(structuredOutput.option)) return false;
  if (typeof structuredOutput.value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(structuredOutput.value)) return false;
  if (structuredOutput.value !== (typeof requires.protocol === "string" ? requires.protocol : "json")) return false;
  if (value.sessionOption !== undefined && value.sessionOption !== "--session" && value.sessionOption !== "--resume") return false;
  if (requires.session === true && value.sessionOption === undefined) return false;
  return value.requiredFlags.length <= SAFE_STRUCTURED_REQUIRED_FLAGS.size
    && value.requiredFlags.every((flag) => typeof flag === "string" && SAFE_STRUCTURED_REQUIRED_FLAGS.has(flag))
    && new Set(value.requiredFlags).size === value.requiredFlags.length
    && !value.requiredFlags.includes(structuredOutput.option);
}

function isEventSchema(value: unknown): value is OpenCodeEventSchema {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128 || !isRecord(value.eventTypes) || !isRecord(value.requires)) return false;
  if (!Object.keys(value).every((key) => key === "id" || key === "requires" || key === "eventTypes" || key === "shape" || key === "launch")) return false;
  if (!hasValidShape(value.shape)) return false;
  if (!hasValidLaunch(value.launch, value.requires)) return false;
  if (!Object.keys(value.requires).every((key) => key === "json" || key === "session" || key === "model" || key === "protocol")) return false;
  if (value.requires.json !== true || (value.requires.session !== undefined && typeof value.requires.session !== "boolean") || (value.requires.model !== undefined && typeof value.requires.model !== "boolean") || (value.requires.protocol !== undefined && (typeof value.requires.protocol !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.requires.protocol)))) return false;
  const eventKeys: Array<keyof OpenCodeEventSchema["eventTypes"]> = ["ignored", "text", "toolStart", "toolEnd", "toolComplete", "error"];
  // `isRecord` deliberately narrows external JSON to unknown values. Keep that
  // boundary while validating, then use the internal shape for the duplicate
  // label checks below.
  const eventTypes = value.eventTypes as unknown as OpenCodeEventSchema["eventTypes"];
  if (Object.keys(eventTypes).length !== eventKeys.length || !eventKeys.every((key) => {
    const labels = eventTypes[key];
    // Text is the only universal structured-output contract. Every other
    // category is protocol-shape optional: a text-only client has no tool
    // frames, and a split-lifecycle client has no combined completion frame.
    // Empty arrays are authoritative retirements, not invitations to use the
    // built-in aliases.
    const mayBeEmpty = key !== "text";
    return Array.isArray(labels)
      && (mayBeEmpty || labels.length > 0)
      && labels.length <= 32
      && labels.every((type: unknown) => typeof type === "string" && type.length > 0 && type.length <= 80);
  })) return false;
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
  const structuredOutputs = capabilities.structuredOutputs ?? [{ option: "--format", values: protocols }];
  if (!structuredOutputs.some((output) => output.option === schema.launch.structuredOutput.option && output.values.includes(schema.launch.structuredOutput.value))) return false;
  const options = new Set(capabilities.options ?? ["--format", "--output", "--session", "--resume", "--model"]);
  if (!options.has(schema.launch.structuredOutput.option)) return false;
  if (schema.launch.sessionOption && !options.has(schema.launch.sessionOption)) return false;
  const noValueOptions = new Set(capabilities.noValueOptions ?? []);
  if (schema.launch.requiredFlags.some((flag) => !options.has(flag) || !noValueOptions.has(flag))) return false;
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

function requirementsOverlap(left: OpenCodeEventSchema, right: OpenCodeEventSchema): boolean {
  const compatible = <T>(a: T | undefined, b: T | undefined) => a === undefined || b === undefined || a === b;
  return compatible(left.requires.session, right.requires.session)
    && compatible(left.requires.model, right.requires.model)
    && compatible(left.requires.protocol, right.requires.protocol);
}

export function isOpenCodeSchemaBundle(
  value: unknown,
  now = Date.now(),
  options: { allowExpired?: boolean } = {},
): value is OpenCodeSchemaBundle {
  if (!isRecord(value) || value.format !== 1 || value.runtime !== "opencode") return false;
  if (!Object.keys(value).every((key) => key === "format" || key === "runtime" || key === "sequence" || key === "issuedAt" || key === "expiresAt" || key === "keyId" || key === "schemas" || key === "signature")) return false;
  if (typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Array.isArray(value.schemas) || value.schemas.length === 0 || value.schemas.length > 64 || !value.schemas.every(isEventSchema)) return false;
  if (value.keyId !== undefined && (typeof value.keyId !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.keyId))) return false;
  if (value.signature !== undefined && (!isRecord(value.signature)
    || !Object.keys(value.signature).every((key) => key === "algorithm" || key === "value")
    || value.signature.algorithm !== "ed25519"
    || typeof value.signature.value !== "string")) return false;
  const issuedAt = parseCanonicalTimestamp(value.issuedAt);
  const expiresAt = parseCanonicalTimestamp(value.expiresAt);
  if (issuedAt === null || expiresAt === null || issuedAt > now || expiresAt <= issuedAt || (!options.allowExpired && expiresAt <= now)) return false;
  // A duplicated requirement profile would be an ambiguous same-specificity
  // selection for the corresponding client capabilities. Reject it at the
  // signed-bundle boundary, before it can affect a chat turn.
  const ids = new Set<string>();
  for (let index = 0; index < value.schemas.length; index += 1) {
    const schema = value.schemas[index];
    if (ids.has(schema.id)) return false;
    for (const prior of value.schemas.slice(0, index)) {
      if (schemaSpecificity(schema) === schemaSpecificity(prior) && requirementsOverlap(schema, prior)) return false;
    }
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
  publicKey: string | OpenCodeRegistryKeyring,
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
    const keyring = typeof publicKey === "string" ? { legacy: publicKey } : publicKey;
    const entries = Object.entries(keyring).filter(([id, pem]) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) && typeof pem === "string");
    if (!entries.length || entries.length > 4) return false;
    // `keyId` is signed because it is part of the canonical unsigned payload.
    // Legacy single-key caches remain readable during the staged migration.
    const candidates = bundle.keyId === undefined
      ? entries
      : entries.filter(([id]) => id === bundle.keyId);
    return candidates.some(([, pem]) => {
      const key = createPublicKey(pem);
      return key.asymmetricKeyType === "ed25519"
        && verify(null, Buffer.from(openCodeSchemaBundleSigningPayload(bundle)), key, signature);
    });
  } catch {
    return false;
  }
}

type CachedBundle = { checkedAt: number; bundle: OpenCodeSchemaBundle; verifiedKeyId?: string };

function cachePath(): string {
  return path.join(caveHome(), CACHE_FILE);
}

function cacheTrustPath(file: string): string {
  return `${file}.trust`;
}

/**
 * Expired bundles are never selected for parsing, but their verified identity
 * remains a trust floor. Without it, expiry would create a downgrade window
 * where a signed lower sequence (or rewritten equal sequence) could replace
 * the durable cache.
 */
async function readTrustedCacheRecord(file: string, publicKey: string | OpenCodeRegistryKeyring, now: number): Promise<CachedBundle | null> {
  try {
    const raw = await readFile(file, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_SCHEMA_BUNDLE_BYTES) return null;
    const cached = JSON.parse(raw) as CachedBundle;
    if (
      !isRecord(cached)
      || typeof cached.checkedAt !== "number"
      || !Number.isFinite(cached.checkedAt)
      || (cached.verifiedKeyId !== undefined && (typeof cached.verifiedKeyId !== "string" || cached.bundle.keyId !== cached.verifiedKeyId))
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

async function fetchSchemaBundle(url: string, fetcher: typeof fetch, timeoutMs = REFRESH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let response: Response | undefined;
  let deadlineElapsed = false;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      deadlineElapsed = true;
      controller.abort();
      void response?.body?.cancel().catch(() => undefined);
      reject(new Error("schema registry refresh timed out"));
    }, timeoutMs);
  });
  try {
    // The deadline covers response headers *and* body consumption. Test and
    // embedding fetch shims are not required to honor AbortSignal, so race the
    // full operation as well as aborting the platform fetch/body stream.
    return await Promise.race([
      (async () => {
        response = await fetcher(url, { headers: { accept: "application/json" }, signal: controller.signal });
        if (deadlineElapsed) throw new Error("schema registry refresh timed out");
        if (!response.ok) throw new Error("untrusted schema bundle");
        return readResponseTextLimited(response);
      })(),
      deadline,
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

async function readCachedTrustState(file: string, publicKey: string | OpenCodeRegistryKeyring, now: number): Promise<CachedBundle | null> {
  const [primary, backup] = await Promise.all([
    readTrustedCacheRecord(file, publicKey, now),
    readTrustedCacheRecord(cacheTrustPath(file), publicKey, now),
  ]);
  if (!primary) return backup;
  if (!backup) return primary;
  // The sidecar is written before the replaceable cache payload. At an equal
  // sequence it is the durable floor if a torn/manual primary differs.
  return backup.bundle.sequence >= primary.bundle.sequence ? backup : primary;
}

async function writeVerifiedCache(file: string, cached: CachedBundle): Promise<void> {
  // Persist the signed trust floor first: a later damaged/truncated primary
  // file cannot erase the highest accepted sequence before the next refresh.
  await writeJsonAtomic(cacheTrustPath(file), cached);
  await writeJsonAtomic(file, cached);
}

async function readVerifiedCache(file: string, publicKey: string | OpenCodeRegistryKeyring, now: number): Promise<CachedBundle | null> {
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
  /** Bounded active-plus-previous keyring for staged registry-key rotation. */
  publicKeys?: OpenCodeRegistryKeyring;
  fetch?: typeof fetch;
  now?: () => number;
  cacheFile?: string;
  /** Test-only bounded deadline for the complete fetch and body read. */
  refreshTimeoutMs?: number;
};

// Release builds inject these public values at compile time. Server-side
// overrides retain local test and operator support without changing the
// packaged trust anchor.
const PACKAGED_REGISTRY_URL = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL;
const PACKAGED_REGISTRY_PUBLIC_KEY = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY;
const PACKAGED_REGISTRY_PUBLIC_KEYS = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS;

function parseKeyring(value: string | undefined): OpenCodeRegistryKeyring | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return undefined;
    const entries = Object.entries(parsed).filter(([id, pem]) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) && typeof pem === "string");
    return entries.length > 0 && entries.length <= 4 && entries.length === Object.keys(parsed).length
      ? Object.fromEntries(entries) as OpenCodeRegistryKeyring
      : undefined;
  } catch {
    return undefined;
  }
}

function registryKeyring(source: OpenCodeSchemaBundleSource): OpenCodeRegistryKeyring | undefined {
  const configured = source.publicKeys
    ?? parseKeyring(process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS)
    ?? parseKeyring(PACKAGED_REGISTRY_PUBLIC_KEYS);
  if (configured) return configured;
  const single = source.publicKey ?? process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY ?? PACKAGED_REGISTRY_PUBLIC_KEY;
  return single ? { legacy: single } : undefined;
}

function schemaRefreshKey(file: string, url: string, publicKeys: OpenCodeRegistryKeyring): string {
  return createHash("sha256").update(`${file}\0${url}\0${stableJson(publicKeys)}`).digest("hex");
}

async function refreshOpenCodeSchemaBundle(
  file: string,
  url: string,
  publicKeys: OpenCodeRegistryKeyring,
  fetcher: typeof fetch,
  now: number,
  refreshTimeoutMs?: number,
): Promise<LoadedOpenCodeSchemaBundle> {
  const raw = await fetchSchemaBundle(url, fetcher, refreshTimeoutMs);
  const remote = JSON.parse(raw) as unknown;
  if (!verifyOpenCodeSchemaBundle(remote, publicKeys, now)) throw new Error("invalid schema signature");
  if (Object.keys(publicKeys).length > 1 && remote.keyId === undefined) throw new Error("missing schema signing key id");
  const cachedTrust = await readCachedTrustState(file, publicKeys, now);
  if (cachedTrust && remote.sequence < cachedTrust.bundle.sequence) throw new Error("schema rollback");
  await mkdir(path.dirname(file), { recursive: true });
  const writeResult = await withCacheWriteLock(file, async () => {
    // Re-read after acquiring the lock. Another process may have refreshed
    // while this request was in flight, and the cache must never move back.
    const currentTrust = await readCachedTrustState(file, publicKeys, now);
    if (currentTrust && remote.sequence < currentTrust.bundle.sequence) throw new Error("schema rollback");
    if (currentTrust && remote.sequence === currentTrust.bundle.sequence) {
      if (openCodeSchemaBundleSigningPayload(remote) !== openCodeSchemaBundleSigningPayload(currentTrust.bundle)) throw new Error("schema sequence rewritten");
      // The just-verified remote payload is byte-for-byte the same signed
      // contract, so it is safe to refresh only the unsigned cache freshness.
      await writeVerifiedCache(file, { checkedAt: now, bundle: remote, verifiedKeyId: remote.keyId });
      return { bundle: remote, source: "remote" as const };
    }
    await writeVerifiedCache(file, { checkedAt: now, bundle: remote, verifiedKeyId: remote.keyId });
    return { bundle: remote, source: "remote" as const };
  });
  if (writeResult) return writeResult;
  // A concurrent writer can have installed a newer sequence while this
  // request held an older verified response. Never select that older parser
  // for this turn merely because the lock was busy.
  const current = await readVerifiedCache(file, publicKeys, now);
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
 * Read a last-known-good schema bundle and refresh it within a bounded
 * deadline. A remote bundle is accepted only with a configured Ed25519 key,
 * valid dates, a monotonic sequence, and a valid signature. Failed refreshes
 * never replace the old cache and are surfaced as a value-free diagnostic.
 */
export async function loadOpenCodeSchemaBundle(source: OpenCodeSchemaBundleSource = {}): Promise<LoadedOpenCodeSchemaBundle> {
  const now = source.now?.() ?? Date.now();
  const file = source.cacheFile ?? cachePath();
  const url = source.url ?? process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_URL ?? PACKAGED_REGISTRY_URL;
  const publicKeys = registryKeyring(source);
  if (!url || !publicKeys) return { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in" };

  const cached = await readVerifiedCache(file, publicKeys, now);
  // An expired signed cache cannot parse a turn, but it records that this
  // client previously trusted a newer registry contract. Do not silently
  // regress to the compiled parser if refresh fails; a first offline launch
  // without any cache can still use that source-trusted baseline.
  const cacheTrust = cached ?? await readCachedTrustState(file, publicKeys, now);
  const cacheFresh = cached && now - cached.checkedAt < CACHE_TTL_MS;
  if (cacheFresh) return { bundle: cached.bundle, source: "cache" };
  const key = schemaRefreshKey(file, url, publicKeys);
  if ((refreshRetryAt.get(key) ?? 0) > now) {
    return cached
      ? { bundle: cached.bundle, source: "cache", diagnostic: "schema-registry-refresh-rejected" }
      : cacheTrust
        ? { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "cached-schema-unavailable" }
        : { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "schema-registry-refresh-rejected" };
  }
  const refresh = startSchemaRefresh(
    key,
    () => refreshOpenCodeSchemaBundle(file, url, publicKeys, source.fetch ?? fetch, now, source.refreshTimeoutMs),
    now,
  );
  try {
    return await refresh;
  } catch {
    // Another process may have installed a newer verified contract after this
    // invocation captured `cached` but before its refresh lost the cache lock
    // to a rollback rejection. Re-read first so this turn cannot regress to
    // the stale parser that initiated the race.
    const current = await readVerifiedCache(file, publicKeys, now);
    if (current && (!cached || current.bundle.sequence >= cached.bundle.sequence)) {
      return { bundle: current.bundle, source: "cache", diagnostic: "schema-registry-refresh-rejected" };
    }
    // A verified stale bundle is still valid for its own expiry window. Keep
    // using it, but surface this turn's rejected refresh instead of hiding the
    // first recovery failure until the retry backoff path runs.
    if (cached) return { bundle: cached.bundle, source: "cache", diagnostic: "schema-registry-refresh-rejected" };
    return cacheTrust
      ? { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "cached-schema-unavailable" }
      : { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "schema-registry-refresh-rejected" };
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
  // The compiled baseline remains a safe first-launch fallback while it is
  // within its own explicit validity window. Once that baseline expires, do
  // not extend an old parser merely because a remote cache is unavailable.
  if (
    loaded.diagnostic === "cached-schema-unavailable"
    && Date.parse(BUILTIN_OPENCODE_SCHEMA_BUNDLE.expiresAt) <= (source?.now?.() ?? Date.now())
  ) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: loaded.source,
      diagnostic: loaded.diagnostic,
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
  if (quarantinedSchemaIds.has(schema.id)) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: loaded.source,
      diagnostic: "schema-quarantined",
    };
  }
  return {
    mode: "structured",
    capabilities,
    schema,
    bundleSource: loaded.source,
    // The shipped parser is a source-trusted offline baseline. A failed
    // registry refresh must not remove otherwise compatible tool activity,
    // but callers still surface the value-free recovery state.
    diagnostic: loaded.diagnostic,
  };
}
