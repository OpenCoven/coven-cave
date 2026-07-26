import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import * as registryFs from "node:fs/promises";
import { homedir } from "node:os";

type RegistryFs = typeof registryFs;

function requireRegistryFs(): RegistryFs {
  return registryFs;
}

export type OpenCodeRunCapabilities = {
  version: string | null;
  /** Whether this capability record came from a complete probe, a bounded
   * same-launcher fallback, or no usable probe at all. */
  probeStatus?: "verified" | "fallback" | "unavailable";
  json: boolean;
  model: boolean;
  session: boolean;
  /** Explicit, documented structured-output format values from `run --help`. */
  protocols: string[];
  /** Declared `run` option names and structured-output option/value pairs. */
  options?: string[];
  /** Declared run options whose synopsis explicitly accepts an argument. */
  valueOptions?: string[];
  /** Declared run flags that take no value and are safe to forward verbatim. */
  noValueOptions?: string[];
  /** Whether `run --help` explicitly documents `--` as an option delimiter. */
  endOfOptions?: boolean;
  /** Declared valueless switches that explicitly request a JSON protocol. */
  structuredSwitches?: Array<{ option: string; protocols: string[] }>;
  structuredOutputs?: Array<{ option: string; values: string[] }>;
};

/** A direct field or a bounded two-segment envelope path. */
export type OpenCodeEnvelopePath = string | [string, string];
export type OpenCodeRegistryKeyring = Record<string, string>;
/** Immutable release checkpoint used to prevent first-use registry replays. */
export type OpenCodeRegistryCheckpoint = { sequence: number; payloadHash: string };

export type OpenCodeEventSchema = {
  id: string;
  /** Signed tie-breaker for clients that advertise multiple valid protocols. */
  priority?: number;
  /** A schema is selected only when every advertised requirement is met. */
  requires: { json: true; session?: boolean; model?: boolean; protocol?: string };
  eventTypes: {
    /** Documented lifecycle/status frames that carry no renderable content. */
    ignored: string[];
    text: string[];
    toolStart: string[];
    /** Nonterminal output/status updates for an already-announced tool call.
     * Optional so pre-progress signed registry bundles remain valid. */
    toolProgress?: string[];
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
    /** Envelope(s) explicitly trusted to carry tool input/output/state. */
    toolEnvelope?: OpenCodeEnvelopePath[];
    /** Envelope(s) that carry the stable tool-call id; defaults to payload/root. */
    idEnvelope?: OpenCodeEnvelopePath[];
    /** Declares the payload's own kind discriminator before it may render. */
    payloadKind: {
      field: string;
      text: string[];
      tool: string[];
    };
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
    structuredOutput: { option: string; value?: string };
    sessionOption?: "--session" | "--resume";
    requiredFlags: string[];
    /** May use `--` only when the installed CLI documents the delimiter. */
    endOfOptions?: true;
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
  /** Signed, explicit retirement of compiled baseline schema IDs. */
  retiredSchemaIds?: string[];
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
  | "capability-probe-unavailable"
  | "capability-probe-fallback"
  | "json-format-unavailable"
  | "no-compatible-schema"
  | "schema-quarantined"
  | "schema-registry-refresh-rejected"
  | "cached-schema-unavailable";

type LoadedOpenCodeSchemaBundle = {
  bundle: OpenCodeSchemaBundle;
  source: "built-in" | "cache" | "remote";
  diagnostic?: "schema-registry-refresh-rejected" | "cached-schema-unavailable";
  /** A verified-but-expired remote contract existed, so the built-in parser is unsafe. */
  remoteSchemaRequired?: boolean;
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
// Cached records wrap a verified bundle with timestamps/key metadata and are
// pretty-printed for recoverability. Keep their read cap independently
// bounded, but large enough that every accepted remote bundle remains usable
// after the wrapper is written.
const MAX_SCHEMA_CACHE_RECORD_BYTES = 512 * 1024;
const MAX_TRUST_ANCHOR_JOURNAL_ENTRIES = 16;
// A journal is local mutable state.  Never enumerate an attacker-created
// directory without a ceiling: the cache reader runs on every compatibility
// decision and must fail closed rather than retain an unbounded filename list.
const MAX_TRUST_ANCHOR_JOURNAL_DIRECTORY_ENTRIES = MAX_TRUST_ANCHOR_JOURNAL_ENTRIES * 2;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_FILE = "opencode-schema-bundle-v1.json";
const REFRESH_TIMEOUT_MS = 5_000;
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_WAIT_MS = 500;
const CACHE_LOCK_POLL_MS = 20;
const REFRESH_FAILURE_BACKOFF_MS = 60_000;
class CacheWriterPendingError extends Error {}
/**
 * Two locally persisted records at one sequence must name exactly one signed
 * payload.  Treat a disagreement as a durable trust failure: returning
 * `null` would make a subsequent remote response appear to be first use and
 * allow either side of the rewrite to win.
 */
class CacheTrustConflictError extends Error {}
const refreshFlights = new Map<string, Promise<LoadedOpenCodeSchemaBundle>>();
const refreshRetryAt = new Map<string, number>();
// A selected schema that emits an unknown or malformed frame is unsafe for
// further structured launches in this process. Keep the bounded quarantine by
// schema identity so a registry update with a new profile can recover without
// replaying the incompatible turn (which may already have run tools).
const quarantinedSchemaRevisions = new Map<string, string>();
const MAX_QUARANTINED_SCHEMA_IDS = 64;
/**
 * The release ships sequence 1 as an immutable registry genesis contract.
 * A remote registry may advance it, but a fresh install must never accept a
 * different signed history at or below this floor just because it has no
 * writable cache yet.
 */
export const OPENCODE_REGISTRY_GENESIS_SEQUENCE = 1;

export function quarantineOpenCodeSchema(schema: OpenCodeEventSchema | undefined): void {
  if (!schema) return;
  const revision = createHash("sha256").update(stableJson(schema)).digest("hex");
  if (quarantinedSchemaRevisions.get(schema.id) === revision) return;
  if (quarantinedSchemaRevisions.size >= MAX_QUARANTINED_SCHEMA_IDS) {
    const oldest = quarantinedSchemaRevisions.keys().next();
    if (!oldest.done) quarantinedSchemaRevisions.delete(oldest.value);
  }
  quarantinedSchemaRevisions.set(schema.id, revision);
}

/**
 * Shipped schemas remain usable offline. Selection is capability-based: a
 * version string is recorded for support, but never used as a compatibility
 * threshold. Remote schemas can be added without releasing Cave.
 */
export const BUILTIN_OPENCODE_SCHEMA_BUNDLE: OpenCodeSchemaBundle = {
  format: 1,
  runtime: "opencode",
  sequence: OPENCODE_REGISTRY_GENESIS_SEQUENCE,
  issuedAt: "2026-07-24T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  schemas: [
    {
      id: "opencode-run-json-v1",
      requires: { json: true, session: true, protocol: "json" },
      eventTypes: {
        ignored: ["step_start", "step_finish", "reasoning"],
        text: ["text"],
        // Current `run --format json` emits only terminal `tool_use` frames
        // with a `part` envelope. Keep old split/root labels in the separately
        // selected legacy profile so an evolved stream fails closed instead of
        // being mistaken for trusted tool activity.
        toolStart: [],
        toolProgress: [],
        toolEnd: [],
        toolComplete: ["tool_use"],
        error: ["error"],
      },
      shape: {
        envelope: ["part", "data", "root"],
        discriminator: { envelope: "root", field: "type" },
        textEnvelope: ["part", "data"],
        toolEnvelope: ["part"],
        payloadKind: { field: "type", text: ["text"], tool: ["tool"] },
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
      requires: { json: true, protocol: "json-legacy" },
      eventTypes: {
        ignored: ["step_start", "step_finish", "reasoning"],
        text: ["message", "assistant_text"],
        toolStart: ["tool"],
        toolProgress: [],
        toolEnd: ["tool_output"],
        toolComplete: ["tool_call"],
        error: ["error", "failed"],
      },
      shape: {
        envelope: ["part", "data", "root"],
        discriminator: { envelope: "root", field: "type" },
        textEnvelope: ["part", "data"],
        toolEnvelope: ["data", "root"],
        payloadKind: { field: "type", text: ["text"], tool: ["tool"] },
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
  if (!Object.keys(value).every((key) => key === "envelope" || key === "textEnvelope" || key === "toolEnvelope" || key === "idEnvelope" || key === "payloadKind" || key === "discriminator" || aliasKeys.includes(key))) return false;
  if (!envelopeFields(value.envelope)
    || (value.textEnvelope !== undefined && !envelopeFields(value.textEnvelope))
    || (value.toolEnvelope !== undefined && !envelopeFields(value.toolEnvelope))
    || (value.idEnvelope !== undefined && !envelopeFields(value.idEnvelope))) return false;
  if (!isRecord(value.discriminator)
    || !Object.keys(value.discriminator).every((key) => key === "envelope" || key === "field")
    || !hasValidEnvelopePath(value.discriminator.envelope)
    || typeof value.discriminator.field !== "string"
    || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value.discriminator.field)) return false;
  if (!isRecord(value.payloadKind)) return false;
  const payloadKind = value.payloadKind;
  if (!Object.keys(payloadKind).every((key) => key === "field" || key === "text" || key === "tool")
    || typeof payloadKind.field !== "string"
    || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(payloadKind.field)) return false;
  const textKinds = payloadKind.text;
  const toolKinds = payloadKind.tool;
  if (!hasBoundedAliases(textKinds) || !hasBoundedAliases(toolKinds)) return false;
  if (textKinds.some((kind) => toolKinds.includes(kind))) return false;
  return aliasKeys.every((key) => hasBoundedAliases(value[key]));
}

const SAFE_STRUCTURED_LAUNCH_OPTION = /^--[a-z0-9-]*(?:format|output|json|event|stream)[a-z0-9-]*$/i;
const UNSAFE_STRUCTURED_LAUNCH_OPTIONS = new Set([
  "--auto", "--permission", "--sandbox", "--skip-permissions", "--dangerously-skip-permissions", "--trust-all-tools", "--yolo",
]);
// Format 1 can add only output-event switches. This constrained grammar and
// denylist keep a signed registry from widening tool permissions or execution
// policy, while allowing a newly documented neutral flag (for example
// `--tool-events`) without requiring an app release. Every flag is separately
// confirmed as a declared *valueless* `opencode run` option before selection.
const SAFE_STRUCTURED_REQUIRED_FLAG = /^--(?:(?:include|emit|output|show)-)?(?:(?:tool-(?:event|events|stream|streams))|(?:(?:event|events|stream|streams)(?:-[a-z0-9]+)*))$/i;
const MAX_SAFE_STRUCTURED_REQUIRED_FLAGS = 4;

function safeStructuredLaunchOption(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 80
    && SAFE_STRUCTURED_LAUNCH_OPTION.test(value)
    && !UNSAFE_STRUCTURED_LAUNCH_OPTIONS.has(value.toLowerCase());
}

function hasValidLaunch(value: unknown, requires: Record<string, unknown>): boolean {
  if (!isRecord(value) || !Array.isArray(value.requiredFlags)) return false;
  if (!Object.keys(value).every((key) => key === "structuredOutput" || key === "sessionOption" || key === "requiredFlags" || key === "endOfOptions")) return false;
  const structuredOutput = value.structuredOutput;
  if (!isRecord(structuredOutput)) return false;
  if (!Object.keys(structuredOutput).every((key) => key === "option" || key === "value")) return false;
  if (!safeStructuredLaunchOption(structuredOutput.option)) return false;
  if (structuredOutput.value !== undefined && (typeof structuredOutput.value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(structuredOutput.value))) return false;
  if (structuredOutput.value !== undefined && structuredOutput.value !== (typeof requires.protocol === "string" ? requires.protocol : "json")) return false;
  // A switch without a value must still be tied to a protocol-specific
  // requirement; otherwise a signed schema could turn any valueless CLI flag
  // into a structured-output request.
  if (structuredOutput.value === undefined && (typeof requires.protocol !== "string" || !structuredOutput.option.toLowerCase().includes("json"))) return false;
  if (value.sessionOption !== undefined && value.sessionOption !== "--session" && value.sessionOption !== "--resume") return false;
  if (value.endOfOptions !== undefined && value.endOfOptions !== true) return false;
  if (requires.session === true && value.sessionOption === undefined) return false;
  return value.requiredFlags.length <= MAX_SAFE_STRUCTURED_REQUIRED_FLAGS
    && value.requiredFlags.every((flag) => typeof flag === "string" && SAFE_STRUCTURED_REQUIRED_FLAG.test(flag) && !UNSAFE_STRUCTURED_LAUNCH_OPTIONS.has(flag.toLowerCase()))
    && new Set(value.requiredFlags).size === value.requiredFlags.length
    && !value.requiredFlags.includes(structuredOutput.option);
}

function isEventSchema(value: unknown): value is OpenCodeEventSchema {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128 || !isRecord(value.eventTypes) || !isRecord(value.requires)) return false;
  if (!Object.keys(value).every((key) => key === "id" || key === "priority" || key === "requires" || key === "eventTypes" || key === "shape" || key === "launch")) return false;
  if (value.priority !== undefined && (typeof value.priority !== "number" || !Number.isSafeInteger(value.priority) || value.priority < 0 || value.priority > 100)) return false;
  if (!hasValidShape(value.shape)) return false;
  if (!hasValidLaunch(value.launch, value.requires)) return false;
  if (!Object.keys(value.requires).every((key) => key === "json" || key === "session" || key === "model" || key === "protocol")) return false;
  if (value.requires.json !== true || (value.requires.session !== undefined && typeof value.requires.session !== "boolean") || (value.requires.model !== undefined && typeof value.requires.model !== "boolean") || (value.requires.protocol !== undefined && (typeof value.requires.protocol !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.requires.protocol)))) return false;
  const requiredEventKeys: Array<keyof OpenCodeEventSchema["eventTypes"]> = ["ignored", "text", "toolStart", "toolEnd", "toolComplete", "error"];
  // `isRecord` deliberately narrows external JSON to unknown values. Keep that
  // boundary while validating, then use the internal shape for the duplicate
  // label checks below.
  const eventTypes = value.eventTypes as unknown as OpenCodeEventSchema["eventTypes"];
  const optionalProgressEventKeys: Array<keyof OpenCodeEventSchema["eventTypes"]> =
    eventTypes.toolProgress === undefined ? [] : ["toolProgress"];
  const eventKeys = [...requiredEventKeys, ...optionalProgressEventKeys];
  if (
    !Object.keys(eventTypes).every((key) => requiredEventKeys.includes(key as keyof OpenCodeEventSchema["eventTypes"]) || key === "toolProgress")
    || !requiredEventKeys.every((key) => Object.hasOwn(eventTypes, key))
    || !eventKeys.every((key) => {
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
  // Event dispatch is category-first, so a label can never safely represent
  // two phases. Reject every cross-category overlap, including start/end,
  // instead of relying on parser order to resolve a publisher mistake.
  const assignedLabels = new Set<string>();
  for (const key of eventKeys) {
    for (const label of eventTypes[key] as string[]) {
      if (assignedLabels.has(label)) return false;
      assignedLabels.add(label);
    }
  }
  return true;
}

function schemaMatches(schema: OpenCodeEventSchema, capabilities: OpenCodeRunCapabilities): boolean {
  if (!capabilities.json) return false;
  // Capability requirements are one-way: a client gaining an unrelated flag
  // must not stop matching a known envelope. Explicit exclusions would need a
  // separately audited contract rather than overloading `false` here.
  if (schema.requires.session === true && !capabilities.session) return false;
  if (schema.requires.model === true && !capabilities.model) return false;
  // Older callers/tests did not carry protocol markers; their documented JSON
  // surface is the v1 `json` protocol. New probes always populate this list.
  const protocols = capabilities.protocols ?? (capabilities.json ? ["json"] : []);
  if (schema.requires.protocol !== undefined && !protocols.includes(schema.requires.protocol)) return false;
  const structuredOutputs = capabilities.structuredOutputs ?? [{ option: "--format", values: protocols }];
  const structuredSwitches = capabilities.structuredSwitches ?? [];
  // Older programmatic callers predate per-option argument evidence; live
  // probes always supply it. Preserve their documented option contract while
  // refusing a current probe that marks an option valueless.
  const valueOptions = new Set(capabilities.valueOptions ?? capabilities.options ?? ["--format", "--output", "--session", "--resume", "--model"]);
  if (schema.launch.structuredOutput.value === undefined) {
    if (!structuredSwitches.some((output) => output.option === schema.launch.structuredOutput.option && output.protocols.includes(schema.requires.protocol ?? "json"))) return false;
  } else if (!valueOptions.has(schema.launch.structuredOutput.option) || !structuredOutputs.some((output) => output.option === schema.launch.structuredOutput.option && output.values.includes(schema.launch.structuredOutput.value!))) return false;
  const options = new Set(capabilities.options ?? ["--format", "--output", "--session", "--resume", "--model"]);
  if (!options.has(schema.launch.structuredOutput.option)) return false;
  if (schema.launch.sessionOption && (!options.has(schema.launch.sessionOption) || !valueOptions.has(schema.launch.sessionOption))) return false;
  const noValueOptions = new Set(capabilities.noValueOptions ?? []);
  if (schema.launch.requiredFlags.some((flag) => !options.has(flag) || !noValueOptions.has(flag))) return false;
  return true;
}

function schemaSpecificity(schema: OpenCodeEventSchema): number {
  // A confirmed output-only flag is also a capability discriminator. This
  // lets a remote schema safely supersede a baseline JSON parser only for a
  // client that advertises the additional event stream it needs, while the
  // baseline remains available to otherwise-compatible older clients.
  return Number(schema.requires.session === true)
    + Number(schema.requires.model === true)
    + Number(schema.requires.protocol !== undefined)
    + schema.launch.requiredFlags.length;
}

function schemaPriority(schema: OpenCodeEventSchema): number {
  return schema.priority ?? 0;
}

/**
 * Select the most specific matching schema rather than trusting registry
 * order. Signed priority selects a client that advertises multiple documented
 * protocols; an equal-priority tie still fails closed instead of guessing.
 */
export function selectOpenCodeSchema(
  schemas: OpenCodeEventSchema[],
  capabilities: OpenCodeRunCapabilities,
): OpenCodeEventSchema | null {
  const matches = schemas.filter((schema) => schemaMatches(schema, capabilities));
  if (!matches.length) return null;
  const specificity = Math.max(...matches.map(schemaSpecificity));
  const mostSpecific = matches.filter((schema) => schemaSpecificity(schema) === specificity);
  const priority = Math.max(...mostSpecific.map(schemaPriority));
  const preferred = mostSpecific.filter((schema) => schemaPriority(schema) === priority);
  return preferred.length === 1 ? preferred[0] : null;
}

const CANONICAL_RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !CANONICAL_RFC3339_UTC.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

function requirementsOverlap(left: OpenCodeEventSchema, right: OpenCodeEventSchema): boolean {
  const compatible = <T>(a: T | undefined, b: T | undefined) => a === undefined || b === undefined || a === b;
  return compatible(left.requires.session === true ? true : undefined, right.requires.session === true ? true : undefined)
    && compatible(left.requires.model === true ? true : undefined, right.requires.model === true ? true : undefined)
    && compatible(left.requires.protocol, right.requires.protocol);
}

export function isOpenCodeSchemaBundle(
  value: unknown,
  now = Date.now(),
  options: { allowExpired?: boolean } = {},
): value is OpenCodeSchemaBundle {
  if (!isRecord(value) || value.format !== 1 || value.runtime !== "opencode") return false;
  if (!Object.keys(value).every((key) => key === "format" || key === "runtime" || key === "sequence" || key === "issuedAt" || key === "expiresAt" || key === "keyId" || key === "retiredSchemaIds" || key === "schemas" || key === "signature")) return false;
  if (typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Array.isArray(value.schemas) || value.schemas.length === 0 || value.schemas.length > 64 || !value.schemas.every(isEventSchema)) return false;
  if (value.keyId !== undefined && (typeof value.keyId !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.keyId))) return false;
  if (value.retiredSchemaIds !== undefined && (
    !Array.isArray(value.retiredSchemaIds)
    || value.retiredSchemaIds.length > BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas.length
    || !value.retiredSchemaIds.every((id) => typeof id === "string" && BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas.some((schema) => schema.id === id))
    || new Set(value.retiredSchemaIds).size !== value.retiredSchemaIds.length
  )) return false;
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
      if (
        schemaSpecificity(schema) === schemaSpecificity(prior)
        && schemaPriority(schema) === schemaPriority(prior)
        && requirementsOverlap(schema, prior)
      ) return false;
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

export function openCodeSchemaBundlePayloadHash(bundle: OpenCodeSchemaBundle): string {
  return createHash("sha256").update(openCodeSchemaBundleSigningPayload(bundle), "utf8").digest("hex");
}

function meetsOpenCodeRegistryGenesisFloor(bundle: OpenCodeSchemaBundle): boolean {
  if (bundle.sequence < OPENCODE_REGISTRY_GENESIS_SEQUENCE) return false;
  // Sequence 1 is a pinned genesis payload, not a registry-controlled slot.
  // This blocks a historical, still-valid signature from defining first-use
  // behavior after the cache has been cleared or corrupted.
  return bundle.sequence !== OPENCODE_REGISTRY_GENESIS_SEQUENCE
    || openCodeSchemaBundleSigningPayload(bundle) === openCodeSchemaBundleSigningPayload(BUILTIN_OPENCODE_SCHEMA_BUNDLE);
}

function meetsOpenCodeRegistryCheckpoint(
  bundle: OpenCodeSchemaBundle,
  checkpoint: OpenCodeRegistryCheckpoint | undefined,
): boolean {
  if (!checkpoint) return true;
  if (bundle.sequence < checkpoint.sequence) return false;
  return bundle.sequence !== checkpoint.sequence
    || openCodeSchemaBundlePayloadHash(bundle) === checkpoint.payloadHash;
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

/** Runtime-only path construction deliberately avoids importing coven-paths:
 * its dynamic filesystem joins are application inputs to Turbopack's tracer. */
function localPathChild(parent: string, child: string): string {
  const separator = process.platform === "win32" ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function cachePath(): string {
  // The registry cache is mutable per-user state, never an application asset.
  const covenRoot = process.env.COVEN_HOME || localPathChild(homedir(), ".coven");
  const caveRoot = process.env.COVEN_CAVE_HOME || localPathChild(covenRoot, "cave");
  return localPathChild(caveRoot, CACHE_FILE);
}

function localPathParent(file: string): string {
  const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return slash > 0 ? file.slice(0, slash) : ".";
}

function cacheTrustPath(file: string): string {
  return `${file}.trust`;
}

/**
 * This is deliberately separate from the replaceable parser cache and its
 * recovery sidecar. It retains only verified signed high-water state, so a
 * damaged cache cannot make an already accepted remote sequence replayable.
 */
function cacheTrustAnchorPath(file: string): string {
  return `${file}.anchor`;
}

/**
 * Immutable sequence-keyed anchor records. A lock lease may be reclaimed
 * while a suspended writer is between a token check and an atomic replace;
 * distinct journal names ensure that writer can never replace a newer
 * high-water record when it resumes.
 */
function cacheTrustAnchorJournalPath(anchorFile: string): string {
  return `${anchorFile}.journal`;
}

function cacheTrustAnchorJournalEntryPath(anchorFile: string, bundle: OpenCodeSchemaBundle): string {
  return `${cacheTrustAnchorJournalPath(anchorFile)}/${bundle.sequence}-${openCodeSchemaBundlePayloadHash(bundle)}.json`;
}

function newestAnchorJournalEntries(entries: string[]): string[] {
  return entries
    .filter((entry) => /^\d{1,16}-[a-f0-9]{64}\.json$/.test(entry))
    .sort((left, right) => {
      const leftSequence = Number(left.slice(0, left.indexOf("-")));
      const rightSequence = Number(right.slice(0, right.indexOf("-")));
      if (leftSequence !== rightSequence) return rightSequence > leftSequence ? 1 : -1;
      return right.localeCompare(left);
    })
    .slice(0, MAX_TRUST_ANCHOR_JOURNAL_ENTRIES);
}

/**
 * `readdir` materializes an entire directory before the existing retention
 * logic can trim it. Use the streaming directory handle instead and treat an
 * overfull journal as a trust failure; selecting a partial listing could miss
 * its true high-water sequence and permit a downgrade.
 */
async function boundedTrustAnchorJournalEntries(anchorFile: string): Promise<string[]> {
  let directory: Awaited<ReturnType<RegistryFs["opendir"]>>;
  try {
    directory = await requireRegistryFs().opendir(/* turbopackIgnore: true */ cacheTrustAnchorJournalPath(anchorFile));
  } catch {
    return [];
  }
  const entries: string[] = [];
  let count = 0;
  try {
    for await (const entry of directory) {
      count += 1;
      if (count > MAX_TRUST_ANCHOR_JOURNAL_DIRECTORY_ENTRIES) {
        throw new CacheTrustConflictError("too many schema trust-anchor journal entries");
      }
      if (entry.isFile()) entries.push(entry.name);
    }
    return entries;
  } finally {
    await directory.close().catch(() => undefined);
  }
}

/**
 * Registry cache paths are per-user runtime state. Keep the atomic writer on
 * the same lazy filesystem boundary as the reader: importing the shared
 * writer statically makes Next trace dynamic cache paths as app assets.
 */
async function writeRegistryJsonAtomic(file: string, value: unknown): Promise<void> {
  const fs = requireRegistryFs();
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(value, null, 2));
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(/* turbopackIgnore: true */ temporary, file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (!(code === "EACCES" || code === "EBUSY" || code === "EPERM") || attempt >= 6) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(50, 2 ** (attempt + 1))));
      }
    }
  } catch (error) {
    await fs.rm(/* turbopackIgnore: true */ temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * The cache is writable local state, so do not let a corrupt or maliciously
 * enlarged file bypass the registry response limit and exhaust process memory
 * before signature verification. Reading from one open handle also bounds the
 * bytes consumed if the pathname is atomically replaced while it is read.
 */
async function readBoundedCacheFile(file: string): Promise<string | null> {
  let handle: Awaited<ReturnType<RegistryFs["open"]>> | null = null;
  try {
    handle = await requireRegistryFs().open(/* turbopackIgnore: true */ file, "r");
    const bytes = Buffer.allocUnsafe(MAX_SCHEMA_CACHE_RECORD_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_SCHEMA_CACHE_RECORD_BYTES) return null;
    return bytes.toString("utf8", 0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Expired bundles are never selected for parsing, but their verified identity
 * remains a trust floor. Without it, expiry would create a downgrade window
 * where a signed lower sequence (or rewritten equal sequence) could replace
 * the durable cache.
 */
async function readTrustedCacheRecord(file: string, publicKey: string | OpenCodeRegistryKeyring, now: number): Promise<CachedBundle | null> {
  try {
    const raw = await readBoundedCacheFile(file);
    if (raw === null) return null;
    const cached = JSON.parse(raw) as CachedBundle;
    if (
      !isRecord(cached)
      || typeof cached.checkedAt !== "number"
      || !Number.isFinite(cached.checkedAt)
      || (cached.verifiedKeyId !== undefined && (typeof cached.verifiedKeyId !== "string" || cached.bundle.keyId !== cached.verifiedKeyId))
      || !meetsOpenCodeRegistryGenesisFloor(cached.bundle)
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
    const info = await requireRegistryFs().stat(/* turbopackIgnore: true */ lock);
    // A PID is not a durable process identity: after a crash it can be reused
    // by an unrelated long-running process. The lock is therefore a bounded
    // lease, not a liveness claim. Release ownership remains token-checked,
    // and atomic cache writes/sequence checks preserve last-known-good state
    // if an unusually slow writer overlaps the next lease holder.
    return Date.now() - info.mtimeMs >= CACHE_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

async function readCachedTrustState(
  file: string,
  publicKey: string | OpenCodeRegistryKeyring,
  now: number,
  checkpoint?: OpenCodeRegistryCheckpoint,
  trustAnchorFile = cacheTrustAnchorPath(file),
): Promise<CachedBundle | null> {
  const [primary, backup, anchor, journal] = await Promise.all([
    readTrustedCacheRecord(file, publicKey, now),
    readTrustedCacheRecord(cacheTrustPath(file), publicKey, now),
    readTrustedCacheRecord(trustAnchorFile, publicKey, now),
    readTrustedAnchorJournal(trustAnchorFile, publicKey, now),
  ]);
  const candidates = [primary, backup, anchor, ...journal].filter((cached): cached is CachedBundle => cached !== null);
  const trusted = candidates.filter((cached) => meetsOpenCodeRegistryCheckpoint(cached.bundle, checkpoint));
  if (!trusted.length) return null;
  const highestSequence = Math.max(...trusted.map((cached) => cached.bundle.sequence));
  const highest = trusted.filter((cached) => cached.bundle.sequence === highestSequence);
  // A same-sequence mutation is not made trustworthy by duplicating it into
  // another local record. A remote response cannot resolve this: it might be
  // either conflicting payload (or a third rewrite), so fail closed before it
  // is considered for this turn or written over the forensic evidence.
  if (new Set(highest.map((cached) => openCodeSchemaBundleSigningPayload(cached.bundle))).size !== 1) {
    throw new CacheTrustConflictError("conflicting schema cache records");
  }
  return highest[0];
}

async function readTrustedAnchorJournal(
  anchorFile: string,
  publicKey: string | OpenCodeRegistryKeyring,
  now: number,
): Promise<CachedBundle[]> {
  const entries = await boundedTrustAnchorJournalEntries(anchorFile);
  // A stale writer can leave a lower immutable record after a newer writer
  // commits. Resolve only a bounded newest window; valid registry sequences
  // are safe integers, so filename ordering is an exact high-water ordering.
  const anchorEntries = newestAnchorJournalEntries(entries);
  return (await Promise.all(anchorEntries.map((entry) => readTrustedCacheRecord(
    `${cacheTrustAnchorJournalPath(anchorFile)}/${entry}`,
    publicKey,
    now,
  )))).filter((cached): cached is CachedBundle => cached !== null);
}

async function pruneTrustAnchorJournal(anchorFile: string): Promise<void> {
  const entries = await boundedTrustAnchorJournalEntries(anchorFile);
  const retained = new Set(newestAnchorJournalEntries(entries));
  await Promise.all(entries
    .filter((entry) => /^\d{1,16}-[a-f0-9]{64}\.json$/.test(entry) && !retained.has(entry))
    .map((entry) => requireRegistryFs().rm(/* turbopackIgnore: true */ `${cacheTrustAnchorJournalPath(anchorFile)}/${entry}`, { force: true }).catch(() => undefined)));
}

async function writeVerifiedCache(
  file: string,
  trustAnchorFile: string,
  publicKey: string | OpenCodeRegistryKeyring,
  now: number,
  cached: CachedBundle,
  assertLockOwner?: () => Promise<void>,
): Promise<void> {
  await assertLockOwner?.();
  const priorAnchor = await readCachedTrustState(file, publicKey, now, undefined, trustAnchorFile);
  if (priorAnchor && priorAnchor.bundle.sequence > cached.bundle.sequence) throw new Error("schema rollback");
  if (
    priorAnchor
    && priorAnchor.bundle.sequence === cached.bundle.sequence
    && openCodeSchemaBundleSigningPayload(priorAnchor.bundle) !== openCodeSchemaBundleSigningPayload(cached.bundle)
  ) throw new Error("schema sequence rewritten");
  // Persist the independent signed high-water anchor first. It is append-only
  // by sequence/payload hash, so a writer whose lease is reclaimed cannot
  // overwrite a newer anchor after it resumes. The mutable primary/backup
  // records may still be replaced by that stale writer, but journal selection
  // retains the highest verified sequence.
  await requireRegistryFs().mkdir(/* turbopackIgnore: true */ cacheTrustAnchorJournalPath(trustAnchorFile), { recursive: true });
  await writeRegistryJsonAtomic(cacheTrustAnchorJournalEntryPath(trustAnchorFile, cached.bundle), cached);
  await pruneTrustAnchorJournal(trustAnchorFile);
  // A stale lock can be reclaimed when an original writer is suspended by a
  // filesystem stall. Recheck before every replace so that old owner cannot
  // subsequently overwrite the new owner's higher sequence.
  await assertLockOwner?.();
  await writeRegistryJsonAtomic(cacheTrustPath(file), cached);
  await assertLockOwner?.();
  await writeRegistryJsonAtomic(file, cached);
}

async function readVerifiedCache(
  file: string,
  publicKey: string | OpenCodeRegistryKeyring,
  now: number,
  checkpoint?: OpenCodeRegistryCheckpoint,
  trustAnchorFile = cacheTrustAnchorPath(file),
): Promise<CachedBundle | null> {
  const cached = await readCachedTrustState(file, publicKey, now, checkpoint, trustAnchorFile);
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
    if ((await requireRegistryFs().readFile(/* turbopackIgnore: true */ lock, "utf8")) !== ownerToken) return;
    await requireRegistryFs().rm(/* turbopackIgnore: true */ lock, { force: true });
  } catch {
    // A concurrent stale-lock recovery or shutdown already cleaned it up.
  }
}

async function withCacheWriteLock<T>(file: string, callback: (assertOwner: () => Promise<void>) => Promise<T>): Promise<T | null> {
  const lock = `${file}.lock`;
  let handle: Awaited<ReturnType<RegistryFs["open"]>> | null = null;
  const ownerToken = `${process.pid}:${randomBytes(16).toString("hex")}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const acquired = await requireRegistryFs().open(/* turbopackIgnore: true */ lock, "wx", 0o600);
      try {
        await acquired.writeFile(ownerToken);
      } catch (error) {
        await acquired.close().catch(() => undefined);
        await requireRegistryFs().rm(/* turbopackIgnore: true */ lock, { force: true }).catch(() => undefined);
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
        await requireRegistryFs().rename(/* turbopackIgnore: true */ lock, stale);
        await requireRegistryFs().rm(/* turbopackIgnore: true */ stale, { force: true });
      } catch {
        return null;
      }
    }
  }
  if (!handle) return null;
  const assertOwner = async () => {
    try {
      if ((await requireRegistryFs().readFile(/* turbopackIgnore: true */ lock, "utf8")) !== ownerToken) {
        throw new CacheWriterPendingError("schema cache lock ownership changed");
      }
    } catch (error) {
      if (error instanceof CacheWriterPendingError) throw error;
      throw new CacheWriterPendingError("schema cache lock ownership changed");
    }
  };
  try {
    return await callback(assertOwner);
  } finally {
    await handle.close().catch(() => undefined);
    await releaseCacheLock(lock, ownerToken);
  }
}

/** Wait briefly for a competing writer before choosing an older remote reply. */
async function waitForConcurrentCacheWriter(
  file: string,
  publicKeys: OpenCodeRegistryKeyring,
  now: number,
  minimumSequence: number,
  checkpoint?: OpenCodeRegistryCheckpoint,
  trustAnchorFile = cacheTrustAnchorPath(file),
): Promise<CachedBundle | null> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + CACHE_LOCK_WAIT_MS;
  let latest: CachedBundle | null = null;
  for (;;) {
    latest = await readVerifiedCache(file, publicKeys, now, checkpoint, trustAnchorFile);
    if (latest && latest.bundle.sequence >= minimumSequence) return latest;
    try {
      await requireRegistryFs().stat(/* turbopackIgnore: true */ lock);
    } catch {
      // Lock release follows the atomic write, so one final verified read sees
      // the owner's result without trusting its in-progress payload.
      return await readVerifiedCache(file, publicKeys, now, checkpoint, trustAnchorFile);
    }
    if (Date.now() >= deadline) return latest;
    await new Promise<void>((resolve) => setTimeout(resolve, CACHE_LOCK_POLL_MS));
  }
}

export type OpenCodeSchemaBundleSource = {
  url?: string;
  publicKey?: string;
  /** Bounded active-plus-previous keyring for staged registry-key rotation. */
  publicKeys?: OpenCodeRegistryKeyring;
  /** Release-pinned minimum registry sequence and canonical payload hash. */
  checkpoint?: OpenCodeRegistryCheckpoint;
  /** Independent durable high-water record; defaults beside the cache file. */
  trustAnchorFile?: string;
  fetch?: typeof fetch;
  now?: () => number;
  cacheFile?: string;
  /** Test-only bounded deadline for the complete fetch and body read. */
  refreshTimeoutMs?: number;
};

// Release builds inject these public values at compile time. A packaged
// process treats them as its immutable trust anchor; mutable COVEN_* values
// are for explicit test/developer configuration only.
const PACKAGED_REGISTRY_URL = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL;
const PACKAGED_REGISTRY_PUBLIC_KEY = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY;
const PACKAGED_REGISTRY_PUBLIC_KEYS = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS;
const PACKAGED_REGISTRY_CHECKPOINT = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_CHECKPOINT;

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
  if (source.publicKeys) return source.publicKeys;
  if (source.publicKey) return { legacy: source.publicKey };
  const configured = parseKeyring(PACKAGED_REGISTRY_PUBLIC_KEYS)
    ?? (process.env.NODE_ENV === "production" ? undefined : parseKeyring(process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS));
  if (configured) return configured;
  const single = PACKAGED_REGISTRY_PUBLIC_KEY
    ?? (process.env.NODE_ENV === "production" ? undefined : process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY);
  return single ? { legacy: single } : undefined;
}

function parseRegistryCheckpoint(value: string | undefined): OpenCodeRegistryCheckpoint | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed)
      && Object.keys(parsed).length === 2
      && typeof parsed.sequence === "number"
      && Number.isSafeInteger(parsed.sequence)
      && parsed.sequence >= OPENCODE_REGISTRY_GENESIS_SEQUENCE
      && typeof parsed.payloadHash === "string"
      && /^[a-f0-9]{64}$/.test(parsed.payloadHash)
      ? { sequence: parsed.sequence, payloadHash: parsed.payloadHash }
      : undefined;
  } catch {
    return undefined;
  }
}

function registryUrl(source: OpenCodeSchemaBundleSource): string | undefined {
  return source.url
    ?? PACKAGED_REGISTRY_URL
    ?? (process.env.NODE_ENV === "production" ? undefined : process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_URL);
}

function registryCheckpoint(source: OpenCodeSchemaBundleSource): OpenCodeRegistryCheckpoint | undefined {
  if (source.checkpoint) return source.checkpoint;
  return parseRegistryCheckpoint(PACKAGED_REGISTRY_CHECKPOINT)
    ?? (process.env.NODE_ENV === "production" ? undefined : parseRegistryCheckpoint(process.env.COVEN_OPENCODE_SCHEMA_REGISTRY_CHECKPOINT));
}

function schemaRefreshKey(file: string, trustAnchorFile: string, url: string, publicKeys: OpenCodeRegistryKeyring, checkpoint: OpenCodeRegistryCheckpoint | undefined): string {
  return createHash("sha256").update(`${file}\0${trustAnchorFile}\0${url}\0${stableJson(publicKeys)}\0${stableJson(checkpoint ?? null)}`).digest("hex");
}

async function refreshOpenCodeSchemaBundle(
  file: string,
  url: string,
  publicKeys: OpenCodeRegistryKeyring,
  checkpoint: OpenCodeRegistryCheckpoint | undefined,
  trustAnchorFile: string,
  fetcher: typeof fetch,
  now: number,
  refreshTimeoutMs?: number,
): Promise<LoadedOpenCodeSchemaBundle> {
  const raw = await fetchSchemaBundle(url, fetcher, refreshTimeoutMs);
  const remote = JSON.parse(raw) as unknown;
  if (!verifyOpenCodeSchemaBundle(remote, publicKeys, now)) throw new Error("invalid schema signature");
  if (!meetsOpenCodeRegistryGenesisFloor(remote)) throw new Error("schema registry genesis mismatch");
  if (!meetsOpenCodeRegistryCheckpoint(remote, checkpoint)) throw new Error("schema registry checkpoint mismatch");
  if (Object.keys(publicKeys).length > 1 && remote.keyId === undefined) throw new Error("missing schema signing key id");
  const cachedTrust = await readCachedTrustState(file, publicKeys, now, checkpoint, trustAnchorFile);
  if (cachedTrust && remote.sequence < cachedTrust.bundle.sequence) throw new Error("schema rollback");
  await requireRegistryFs().mkdir(/* turbopackIgnore: true */ localPathParent(file), { recursive: true });
  const writeResult = await withCacheWriteLock(file, async (assertLockOwner) => {
    // Re-read after acquiring the lock. Another process may have refreshed
    // while this request was in flight, and the cache must never move back.
    const currentTrust = await readCachedTrustState(file, publicKeys, now, checkpoint, trustAnchorFile);
    if (currentTrust && remote.sequence < currentTrust.bundle.sequence) throw new Error("schema rollback");
    if (currentTrust && remote.sequence === currentTrust.bundle.sequence) {
      if (openCodeSchemaBundleSigningPayload(remote) !== openCodeSchemaBundleSigningPayload(currentTrust.bundle)) throw new Error("schema sequence rewritten");
      // The just-verified remote payload is byte-for-byte the same signed
      // contract, so it is safe to refresh only the unsigned cache freshness.
      await writeVerifiedCache(file, trustAnchorFile, publicKeys, now, { checkedAt: now, bundle: remote, verifiedKeyId: remote.keyId }, assertLockOwner);
      return { bundle: remote, source: "remote" as const };
    }
    await writeVerifiedCache(file, trustAnchorFile, publicKeys, now, { checkedAt: now, bundle: remote, verifiedKeyId: remote.keyId }, assertLockOwner);
    return { bundle: remote, source: "remote" as const };
  });
  if (writeResult) return writeResult;
  // A concurrent writer can have installed a newer sequence while this
  // request held an older verified response. Never select that older parser
  // for this turn merely because the lock was busy.
  const current = await waitForConcurrentCacheWriter(file, publicKeys, now, remote.sequence, checkpoint, trustAnchorFile);
  if (current && current.bundle.sequence >= remote.sequence) {
    return { bundle: current.bundle, source: "cache" };
  }
  // Selecting the fetched payload here could race a still-running writer with
  // a newer sequence. Keep the protocol boundary fail-closed until that
  // writer commits or a later refresh can make an ordered decision.
  throw new CacheWriterPendingError("schema cache writer did not settle");
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
  const trustAnchorFile = source.trustAnchorFile ?? cacheTrustAnchorPath(file);
  const url = registryUrl(source);
  const publicKeys = registryKeyring(source);
  const checkpoint = registryCheckpoint(source);
  if (!url || !publicKeys) return { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in" };
  // Packaged releases require a current checkpoint before their first remote
  // fetch. A missing build-time value fails safely to the bundled parser;
  // explicit source injection remains available for tests and local dev.
  if (process.env.NODE_ENV === "production" && source.checkpoint === undefined && !checkpoint) {
    return { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "schema-registry-refresh-rejected" };
  }

  let cached: CachedBundle | null;
  let cacheTrust: CachedBundle | null;
  try {
    cached = await readVerifiedCache(file, publicKeys, now, checkpoint, trustAnchorFile);
    // An expired signed cache cannot parse a turn, but it records that this
    // client previously trusted a newer registry contract. Do not silently
    // regress to the compiled parser if refresh fails; a first offline launch
    // without any cache can still use that source-trusted baseline.
    cacheTrust = cached ?? await readCachedTrustState(file, publicKeys, now, checkpoint, trustAnchorFile);
  } catch (error) {
    if (error instanceof CacheTrustConflictError) {
      return {
        bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE,
        source: "built-in",
        diagnostic: "schema-registry-refresh-rejected",
        remoteSchemaRequired: true,
      };
    }
    throw error;
  }
  const cacheFresh = cached && now - cached.checkedAt < CACHE_TTL_MS;
  if (cacheFresh && cached) return { bundle: cached.bundle, source: "cache" };
  const key = schemaRefreshKey(file, trustAnchorFile, url, publicKeys, checkpoint);
  if ((refreshRetryAt.get(key) ?? 0) > now) {
    return cached
      ? { bundle: cached.bundle, source: "cache", diagnostic: "schema-registry-refresh-rejected" }
      : cacheTrust
        ? { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "cached-schema-unavailable", remoteSchemaRequired: true }
        : { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "schema-registry-refresh-rejected" };
  }
  const refresh = startSchemaRefresh(
    key,
    () => refreshOpenCodeSchemaBundle(file, url, publicKeys, checkpoint, trustAnchorFile, source.fetch ?? fetch, now, source.refreshTimeoutMs),
    now,
  );
  try {
    return await refresh;
  } catch (error) {
    if (error instanceof CacheWriterPendingError || error instanceof CacheTrustConflictError) {
      return {
        bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE,
        source: "built-in",
        diagnostic: "schema-registry-refresh-rejected",
        remoteSchemaRequired: true,
      };
    }
    // Another process may have installed a newer verified contract after this
    // invocation captured `cached` but before its refresh lost the cache lock
    // to a rollback rejection. Re-read first so this turn cannot regress to
    // the stale parser that initiated the race.
    let current: CachedBundle | null;
    try {
      current = await readVerifiedCache(file, publicKeys, now, checkpoint, trustAnchorFile);
    } catch (currentError) {
      if (currentError instanceof CacheTrustConflictError) {
        return {
          bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE,
          source: "built-in",
          diagnostic: "schema-registry-refresh-rejected",
          remoteSchemaRequired: true,
        };
      }
      throw currentError;
    }
    if (current && (!cached || current.bundle.sequence >= cached.bundle.sequence)) {
      return { bundle: current.bundle, source: "cache", diagnostic: "schema-registry-refresh-rejected" };
    }
    // A verified stale bundle is still valid for its own expiry window. Keep
    // using it, but surface this turn's rejected refresh instead of hiding the
    // first recovery failure until the retry backoff path runs.
    if (cached) return { bundle: cached.bundle, source: "cache", diagnostic: "schema-registry-refresh-rejected" };
    return cacheTrust
      ? { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "cached-schema-unavailable", remoteSchemaRequired: true }
      : { bundle: BUILTIN_OPENCODE_SCHEMA_BUNDLE, source: "built-in", diagnostic: "schema-registry-refresh-rejected" };
  }
}

export async function resolveOpenCodeCompatibility(
  capabilities: OpenCodeRunCapabilities,
  source?: OpenCodeSchemaBundleSource,
): Promise<OpenCodeCompatibility> {
  if (capabilities.probeStatus === "unavailable") {
    return {
      mode: "plain",
      capabilities,
      bundleSource: "built-in",
      diagnostic: "capability-probe-unavailable",
    };
  }
  if (!capabilities.json) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: "built-in",
      diagnostic: "json-format-unavailable",
    };
  }
  const loaded = await loadOpenCodeSchemaBundle(source);
  // A verified remote schema that has expired proves this client may require a
  // newer envelope than the compiled baseline. Do not revive that baseline
  // merely because refresh is temporarily offline or rejected.
  if (loaded.remoteSchemaRequired) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: loaded.source,
      diagnostic: loaded.diagnostic ?? "cached-schema-unavailable",
    };
  }
  // The compiled baseline remains a safe first-launch fallback while it is
  // within its own explicit validity window. Once that baseline expires, do
  // not extend an old parser merely because a remote cache is unavailable.
  if (
    loaded.source === "built-in"
    && Date.parse(BUILTIN_OPENCODE_SCHEMA_BUNDLE.expiresAt) <= (source?.now?.() ?? Date.now())
  ) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: loaded.source,
      diagnostic: loaded.diagnostic ?? "cached-schema-unavailable",
    };
  }
  // Remote registries publish additive compatibility profiles by default.
  // Select their schemas and non-retired compiled baselines together, so a
  // broad remote profile cannot preempt a more-specific known-safe parser.
  // A remote replacement must therefore win the same specificity/priority
  // comparison as every other candidate, rather than merely appearing first.
  const remoteSchemas = loaded.source === "built-in" ? new Set<OpenCodeEventSchema>() : new Set(loaded.bundle.schemas);
  const remoteById = new Map(loaded.bundle.schemas.map((schema) => [schema.id, schema]));
  const candidates = loaded.source === "built-in"
    ? loaded.bundle.schemas
    : [
        ...loaded.bundle.schemas,
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas.filter((builtIn) => {
          if (loaded.bundle.retiredSchemaIds?.includes(builtIn.id)) return false;
          const remoteRevision = remoteById.get(builtIn.id);
          // Reusing a baseline id is an explicit signed revision. A distinct
          // remote profile must instead win globally by specificity/priority.
          return !remoteRevision || schemaSpecificity(remoteRevision) < schemaSpecificity(builtIn);
        }),
      ];
  const schema = selectOpenCodeSchema(candidates, capabilities);
  if (!schema) {
    return {
      mode: "plain",
      capabilities,
      bundleSource: loaded.source,
      diagnostic: "no-compatible-schema",
    };
  }
  const schemaRevision = createHash("sha256").update(stableJson(schema)).digest("hex");
  if (quarantinedSchemaRevisions.get(schema.id) === schemaRevision) {
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
    bundleSource: schema && remoteSchemas.has(schema) ? loaded.source : "built-in",
    // The shipped parser is a source-trusted offline baseline. A failed
    // registry refresh must not remove otherwise compatible tool activity,
    // but callers still surface the value-free recovery state.
    diagnostic: capabilities.probeStatus === "fallback"
      ? "capability-probe-fallback"
      : loaded.diagnostic,
  };
}
