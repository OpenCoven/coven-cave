import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import * as registryFs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { AgentEventSchema, HelloOkSchema } from "@openclaw/gateway-protocol";
import { Value } from "typebox/value";

import { writeJsonAtomic } from "./server/atomic-write.ts";

const MAX_OPENCLAW_TOOL_PROFILES = 32;
const MAX_OPENCLAW_PROFILE_LIST = 16;
const MAX_OPENCLAW_STRING_BYTES = 256;
const MAX_BUNDLE_BYTES = 256 * 1024;
const MAX_CACHE_BYTES = 512 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 5_000;
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_WAIT_MS = 500;
const CACHE_LOCK_POLL_MS = 20;
const MAX_TRUST_ANCHORS = 16;
const MAX_TRUST_ANCHOR_SCAN = 32;
const MAX_REGISTRY_KEYS = 16;
const CACHE_FILE = "openclaw-schema-bundle-v1.json";
const OPENCLAW_ALLOWED_EVENT_NAMES = ["agent", "session.tool"] as const;
const OPENCLAW_ALLOWED_STREAMS = ["tool"] as const;
const OPENCLAW_ALLOWED_CLIENT_CAPABILITIES = ["tool-events"] as const;
const OPENCLAW_DIRECT_ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,255}$/;
const OPENCLAW_HEX_40_OR_64 = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OPENCLAW_SHA256_HEX = /^[a-f0-9]{64}$/;
const INVALID_OPENCLAW_METADATA = Symbol("invalid-openclaw-metadata");
const OPENCLAW_SAFE_FINGERPRINT_KEYS = new Set([
  "runId",
  "seq",
  "stream",
  "ts",
  "phase",
  "toolCallId",
  "name",
  "status",
  "isError",
  "exitCode",
]);
const OPENCLAW_KEY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CANONICAL_RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const quarantinedOpenClawProfileRevisions = new Map<string, string>();
const MAX_QUARANTINED_OPENCLAW_PROFILE_IDS = 64;
const refreshFlights = new Map<string, Promise<LoadedOpenClawSchemaBundle>>();

class OpenClawCacheTrustConflictError extends Error {}
class OpenClawCacheWriterPendingError extends Error {}

type OpenClawMetadataValue<T> = T | null | typeof INVALID_OPENCLAW_METADATA;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export const OPENCLAW_AGENT_EVENT_SCHEMA_HASH = createHash("sha256")
  .update(JSON.stringify(canonicalize(AgentEventSchema)))
  .digest("hex");

export type OpenClawGatewayDiscovery = {
  serverVersion: string;
  protocol: number;
  methods: string[];
  events: string[];
  serverCapabilities: string[];
  clientCapabilities: string[];
  agentEventSchemaHash: string;
};

export type OpenClawToolProfile = {
  id: string;
  priority?: number;
  requires: {
    serverVersions: string[];
    protocol: number;
    agentEventSchemaHash: string;
    methods: string[];
    events: string[];
    serverCapabilities: string[];
    clientCapabilities: string[];
  };
  eventNames: Array<(typeof OPENCLAW_ALLOWED_EVENT_NAMES)[number]>;
  streams: Array<(typeof OPENCLAW_ALLOWED_STREAMS)[number]>;
  phases: {
    start: string[];
    update: string[];
    result: string[];
  };
  aliases: {
    phase: string[];
    toolCallId: string[];
    name: string[];
    args: string[];
    partialResult: string[];
    result: string[];
    isError: string[];
    status: string[];
    exitCode: string[];
  };
  errorStates: string[];
  source: {
    repo: string;
    package: string;
    blobSha: string;
  };
};

export type OpenClawSchemaBundle = {
  format: 1;
  runtime: "openclaw";
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  keyId?: string;
  retiredProfileIds?: string[];
  profiles: OpenClawToolProfile[];
  signature?: { algorithm: "ed25519"; value: string };
};

export type OpenClawRegistryCheckpoint = {
  sequence: number;
  payloadHash: string;
};

export type OpenClawRegistryKeyring = Record<string, string>;

export type OpenClawCompatibilityDiagnostic =
  | "capability-probe-unavailable"
  | "no-compatible-profile"
  | "profile-registry-refresh-rejected"
  | "cached-profile-unavailable"
  | "profile-quarantined";

export type OpenClawCompatibility =
  | {
      mode: "structured";
      discovery: OpenClawGatewayDiscovery;
      profile: OpenClawToolProfile;
      bundleSource: "built-in" | "cache" | "remote";
    }
  | {
      mode: "plain";
      discovery: OpenClawGatewayDiscovery;
      bundleSource: "built-in" | "cache" | "remote";
      diagnostic: OpenClawCompatibilityDiagnostic;
    };

export type OpenClawCompatibilitySource = {
  cacheDir?: string;
  url?: string;
  publicKeys?: OpenClawRegistryKeyring;
  checkpoint?: OpenClawRegistryCheckpoint;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type OpenClawParsedToolEvent =
  | { kind: "tool_start"; id: string; name: string; input: unknown; seq: number }
  | { kind: "tool_progress"; id: string; output: unknown; seq: number }
  | { kind: "tool_end"; id: string; name: string; output: unknown; isError: boolean; seq: number }
  | { kind: "unknown"; fingerprint: string };

export const BUILTIN_OPENCLAW_TOOL_PROFILES: OpenClawToolProfile[] = [{
  id: "openclaw-agent-tool-v1",
  priority: 100,
  requires: {
    serverVersions: ["2026.7.2-beta.5"],
    protocol: 4,
    agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
    methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"],
    events: ["chat", "agent", "session.tool"],
    serverCapabilities: ["chat-send-routing-contract"],
    clientCapabilities: ["tool-events"],
  },
  eventNames: ["agent", "session.tool"],
  streams: ["tool"],
  phases: {
    start: ["start"],
    update: ["update"],
    result: ["result"],
  },
  aliases: {
    phase: ["phase"],
    toolCallId: ["toolCallId"],
    name: ["name"],
    args: ["args"],
    partialResult: ["partialResult"],
    result: ["result"],
    isError: ["isError"],
    status: ["status"],
    exitCode: ["exitCode"],
  },
  errorStates: ["error", "failed", "failure"],
  source: {
    repo: "openclaw/openclaw",
    package: "@openclaw/gateway-protocol@2026.7.2-beta.5",
    blobSha: "d66b514a7e7565d89c87ab6f1a509623128093f0",
  },
}];

export const BUILTIN_OPENCLAW_SCHEMA_BUNDLE: OpenClawSchemaBundle = {
  format: 1,
  runtime: "openclaw",
  sequence: 1,
  issuedAt: "2026-07-31T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  profiles: BUILTIN_OPENCLAW_TOOL_PROFILES,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && utf8Bytes(value) <= MAX_OPENCLAW_STRING_BYTES;
}

function validDirectAlias(value: unknown): value is string {
  return validBoundedString(value) && OPENCLAW_DIRECT_ALIAS_PATTERN.test(value);
}

function validateStringList(
  value: unknown,
  {
    allowedValues,
    itemValidator,
    allowEmpty = false,
  }: {
    allowedValues?: readonly string[];
    itemValidator?: (value: unknown) => value is string;
    allowEmpty?: boolean;
  } = {},
): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_OPENCLAW_PROFILE_LIST || (!allowEmpty && value.length < 1)) return null;
  const validator = itemValidator ?? validBoundedString;
  const result: string[] = [];
  for (const item of value) {
    if (!validator(item)) return null;
    if (allowedValues && !allowedValues.includes(item)) return null;
    result.push(item);
  }
  return new Set(result).size === result.length ? result : null;
}

function hasBucketOverlap(buckets: readonly string[][]): boolean {
  const seen = new Set<string>();
  for (const bucket of buckets) {
    for (const entry of bucket) {
      if (seen.has(entry)) return true;
      seen.add(entry);
    }
  }
  return false;
}

function effectiveOpenClawToolProfilePriority(profile: Pick<OpenClawToolProfile, "priority">): number {
  return profile.priority ?? 0;
}

function validateOpenClawToolProfile(value: unknown): OpenClawToolProfile | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "priority", "requires", "eventNames", "streams", "phases", "aliases", "errorStates", "source"])) return null;
  const priority = effectiveOpenClawToolProfilePriority(value);
  if (!validBoundedString(value.id) || !Number.isSafeInteger(priority)) return null;

  if (!isRecord(value.requires) || !hasOnlyKeys(value.requires, ["serverVersions", "protocol", "agentEventSchemaHash", "methods", "events", "serverCapabilities", "clientCapabilities"])) return null;
  if (typeof value.requires.protocol !== "number" || !Number.isSafeInteger(value.requires.protocol) || value.requires.protocol < 1) return null;
  if (typeof value.requires.agentEventSchemaHash !== "string" || !OPENCLAW_SHA256_HEX.test(value.requires.agentEventSchemaHash)) return null;
  const serverVersions = validateStringList(value.requires.serverVersions);
  const methods = validateStringList(value.requires.methods);
  const events = validateStringList(value.requires.events);
  const serverCapabilities = validateStringList(value.requires.serverCapabilities);
  const clientCapabilities = validateStringList(value.requires.clientCapabilities, { allowedValues: OPENCLAW_ALLOWED_CLIENT_CAPABILITIES });
  if (!serverVersions || !methods || !events || !serverCapabilities || !clientCapabilities) return null;

  const eventNames = validateStringList(value.eventNames, { allowedValues: OPENCLAW_ALLOWED_EVENT_NAMES }) as OpenClawToolProfile["eventNames"] | null;
  const streams = validateStringList(value.streams, { allowedValues: OPENCLAW_ALLOWED_STREAMS }) as OpenClawToolProfile["streams"] | null;
  if (!eventNames || !streams) return null;

  if (!isRecord(value.phases) || !hasOnlyKeys(value.phases, ["start", "update", "result"])) return null;
  const start = validateStringList(value.phases.start);
  const update = validateStringList(value.phases.update);
  const result = validateStringList(value.phases.result);
  if (!start || !update || !result) return null;
  if (hasBucketOverlap([start, update, result])) return null;

  if (!isRecord(value.aliases) || !hasOnlyKeys(value.aliases, ["phase", "toolCallId", "name", "args", "partialResult", "result", "isError", "status", "exitCode"])) return null;
  const phase = validateStringList(value.aliases.phase, { itemValidator: validDirectAlias });
  const toolCallId = validateStringList(value.aliases.toolCallId, { itemValidator: validDirectAlias });
  const name = validateStringList(value.aliases.name, { itemValidator: validDirectAlias });
  const args = validateStringList(value.aliases.args, { itemValidator: validDirectAlias });
  const partialResult = validateStringList(value.aliases.partialResult, { itemValidator: validDirectAlias });
  const resultAliases = validateStringList(value.aliases.result, { itemValidator: validDirectAlias });
  const isError = validateStringList(value.aliases.isError, { itemValidator: validDirectAlias });
  const status = validateStringList(value.aliases.status, { itemValidator: validDirectAlias });
  const exitCode = validateStringList(value.aliases.exitCode, { itemValidator: validDirectAlias });
  if (!phase || !toolCallId || !name || !args || !partialResult || !resultAliases || !isError || !status || !exitCode) return null;
  if (hasBucketOverlap([phase, toolCallId, name, args, partialResult, resultAliases, isError, status, exitCode])) return null;

  const errorStates = validateStringList(value.errorStates);
  if (!errorStates) return null;

  if (!isRecord(value.source) || !hasOnlyKeys(value.source, ["repo", "package", "blobSha"])) return null;
  if (!validBoundedString(value.source.repo) || !validBoundedString(value.source.package) || typeof value.source.blobSha !== "string" || !OPENCLAW_HEX_40_OR_64.test(value.source.blobSha)) return null;

  return {
    id: value.id,
    priority,
    requires: {
      serverVersions,
      protocol: value.requires.protocol,
      agentEventSchemaHash: value.requires.agentEventSchemaHash,
      methods,
      events,
      serverCapabilities,
      clientCapabilities,
    },
    eventNames,
    streams,
    phases: { start, update, result },
    aliases: { phase, toolCallId, name, args, partialResult, result: resultAliases, isError, status, exitCode },
    errorStates,
    source: {
      repo: value.source.repo,
      package: value.source.package,
      blobSha: value.source.blobSha,
    },
  };
}

export function validateOpenClawToolProfiles(value: unknown): OpenClawToolProfile[] | null {
  if (!Array.isArray(value) || value.length > MAX_OPENCLAW_TOOL_PROFILES) return null;
  const profiles: OpenClawToolProfile[] = [];
  for (const entry of value) {
    const profile = validateOpenClawToolProfile(entry);
    if (!profile) return null;
    profiles.push(profile);
  }
  const ids = profiles.map((profile) => profile.id);
  const priorities = profiles.map((profile) => effectiveOpenClawToolProfilePriority(profile));
  if (new Set(ids).size !== ids.length || new Set(priorities).size !== priorities.length) return null;
  return profiles;
}

function firstPresent(record: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) return record[alias];
  }
  return undefined;
}

function firstOwnValue(record: Record<string, unknown>, aliases: string[]): { found: boolean; value: unknown } {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) {
      return { found: true, value: record[alias] };
    }
  }
  return { found: false, value: undefined };
}

function firstNonEmptyString(record: Record<string, unknown>, aliases: string[]): string | null {
  const value = firstPresent(record, aliases);
  return validBoundedString(value) ? value : null;
}

function firstString(record: Record<string, unknown>, aliases: string[]): string | null {
  const value = firstPresent(record, aliases);
  return validBoundedString(value) ? value : null;
}

function firstBooleanMetadata(record: Record<string, unknown>, aliases: string[]): OpenClawMetadataValue<boolean> {
  const value = firstOwnValue(record, aliases);
  if (!value.found) return null;
  return typeof value.value === "boolean" ? value.value : INVALID_OPENCLAW_METADATA;
}

function exactSetMatch(left: string[], right: string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((entry) => right.includes(entry));
}

export function selectOpenClawToolProfile(profiles: unknown, discovery: OpenClawGatewayDiscovery): OpenClawToolProfile | null {
  const valid = validateOpenClawToolProfiles(profiles);
  if (!valid) return null;
  const matches = valid.filter((profile) =>
    profile.requires.serverVersions.includes(discovery.serverVersion)
    && profile.requires.protocol === discovery.protocol
    && profile.requires.agentEventSchemaHash === discovery.agentEventSchemaHash
    && exactSetMatch(discovery.methods, profile.requires.methods)
    && exactSetMatch(discovery.events, profile.requires.events)
    && exactSetMatch(discovery.serverCapabilities, profile.requires.serverCapabilities)
    && exactSetMatch(discovery.clientCapabilities, profile.requires.clientCapabilities),
  );
  if (!matches.length) return null;
  return [...matches].sort((left, right) =>
    effectiveOpenClawToolProfilePriority(right) - effectiveOpenClawToolProfilePriority(left) || left.id.localeCompare(right.id))[0] ?? null;
}

function openClawFingerprintShape(input: unknown, depth = 0): unknown {
  if (depth >= 3) {
    if (Array.isArray(input)) return "array";
    if (isRecord(input)) return "object";
    return typeof input;
  }
  if (Array.isArray(input)) return input.length ? [openClawFingerprintShape(input[0], depth + 1)] : ["empty"];
  if (!isRecord(input)) return typeof input;
  const safeEntries = Object.entries(input)
    .filter(([key]) => OPENCLAW_SAFE_FINGERPRINT_KEYS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, openClawFingerprintShape(value, depth + 1)]);
  const nested = Object.entries(input)
    .filter(([key]) => !OPENCLAW_SAFE_FINGERPRINT_KEYS.has(key))
    .map(([, value]) => (Array.isArray(value) || isRecord(value) ? openClawFingerprintShape(value, depth + 1) : null))
    .filter((value) => value !== null)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (!safeEntries.length && !nested.length) return "object";
  if (!safeEntries.length) return nested.length === 1 ? nested[0] : nested;
  if (!nested.length) return Object.fromEntries(safeEntries);
  return { safe: Object.fromEntries(safeEntries), nested };
}

export function redactedOpenClawToolFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(openClawFingerprintShape(value)))
    .digest("hex")
    .slice(0, 16);
}

function unknownToolEvent(payload: unknown): OpenClawParsedToolEvent {
  return { kind: "unknown", fingerprint: redactedOpenClawToolFingerprint(payload) };
}

function profileAllowsEvent(profile: OpenClawToolProfile, eventName: string, stream: unknown): boolean {
  return profile.eventNames.includes(eventName as OpenClawToolProfile["eventNames"][number])
    && typeof stream === "string"
    && profile.streams.includes(stream as OpenClawToolProfile["streams"][number]);
}

function profilePhase(profile: OpenClawToolProfile, data: Record<string, unknown>): "start" | "update" | "result" | null {
  const phase = firstString(data, profile.aliases.phase);
  if (!phase) return null;
  if (profile.phases.start.includes(phase)) return "start";
  if (profile.phases.update.includes(phase)) return "update";
  if (profile.phases.result.includes(phase)) return "result";
  return null;
}

function resultRecord(data: Record<string, unknown>, profile: OpenClawToolProfile): Record<string, unknown> | null {
  const result = firstPresent(data, profile.aliases.result);
  return isRecord(result) ? result : null;
}

function toolResultStatus(data: Record<string, unknown>, profile: OpenClawToolProfile): OpenClawMetadataValue<string> {
  const direct = firstOwnValue(data, profile.aliases.status);
  if (direct.found) return validBoundedString(direct.value) ? direct.value : INVALID_OPENCLAW_METADATA;
  const result = resultRecord(data, profile);
  if (result && Object.prototype.hasOwnProperty.call(result, "status")) {
    return validBoundedString(result.status) ? result.status as string : INVALID_OPENCLAW_METADATA;
  }
  return null;
}

function toolResultExitCode(data: Record<string, unknown>, profile: OpenClawToolProfile): OpenClawMetadataValue<number> {
  const direct = firstOwnValue(data, profile.aliases.exitCode);
  if (direct.found) return typeof direct.value === "number" && Number.isFinite(direct.value) ? direct.value : INVALID_OPENCLAW_METADATA;
  const result = resultRecord(data, profile);
  if (result && Object.prototype.hasOwnProperty.call(result, "exitCode")) {
    return typeof result.exitCode === "number" && Number.isFinite(result.exitCode) ? result.exitCode : INVALID_OPENCLAW_METADATA;
  }
  return null;
}

export function parseOpenClawToolEvent(
  eventName: string,
  payload: unknown,
  profile: OpenClawToolProfile,
): OpenClawParsedToolEvent {
  if (!validateOpenClawToolProfile(profile)) return unknownToolEvent(payload);
  if (!Value.Check(AgentEventSchema, payload) || !profileAllowsEvent(profile, eventName, payload.stream) || !isRecord(payload.data)) {
    return unknownToolEvent(payload);
  }
  const data = payload.data;
  const id = firstNonEmptyString(data, profile.aliases.toolCallId);
  const phase = profilePhase(profile, data);
  if (!id || !phase) return unknownToolEvent(payload);
  if (phase === "start") {
    const name = firstNonEmptyString(data, profile.aliases.name);
    const input = firstOwnValue(data, profile.aliases.args);
    return name && input.found ? { kind: "tool_start", id, name, input: input.value, seq: payload.seq } : unknownToolEvent(payload);
  }
  if (phase === "update") {
    const progress = firstOwnValue(data, profile.aliases.partialResult);
    return progress.found ? { kind: "tool_progress", id, output: progress.value, seq: payload.seq } : unknownToolEvent(payload);
  }
  const name = firstNonEmptyString(data, profile.aliases.name);
  if (!name) return unknownToolEvent(payload);
  const output = firstOwnValue(data, profile.aliases.result);
  if (!output.found) return unknownToolEvent(payload);
  const explicitIsError = firstBooleanMetadata(data, profile.aliases.isError);
  const status = toolResultStatus(data, profile);
  const exitCode = toolResultExitCode(data, profile);
  if (explicitIsError === INVALID_OPENCLAW_METADATA || status === INVALID_OPENCLAW_METADATA || exitCode === INVALID_OPENCLAW_METADATA) {
    return unknownToolEvent(payload);
  }
  return {
    kind: "tool_end",
    id,
    name,
    output: output.value,
    isError: explicitIsError === true
      || (status !== null && profile.errorStates.includes(status))
      || (exitCode !== null && exitCode !== 0),
    seq: payload.seq,
  };
}

export function openClawDiscoveryFromHello(value: unknown): OpenClawGatewayDiscovery {
  if (!Value.Check(HelloOkSchema, value)) {
    throw new TypeError("Invalid OpenClaw HelloOk payload");
  }
  return {
    serverVersion: value.server.version,
    protocol: value.protocol,
    methods: [...value.features.methods],
    events: [...value.features.events],
    serverCapabilities: [...(value.features.capabilities ?? [])],
    clientCapabilities: ["tool-events"],
    agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  };
}

type CachedOpenClawSchemaBundle = {
  fetchedAt: number;
  verifiedKeyId: string;
  bundle: OpenClawSchemaBundle;
};

type OpenClawTrustAnchor = {
  sequence: number;
  payloadHash: string;
};

type LoadedOpenClawSchemaBundle = {
  bundle: OpenClawSchemaBundle;
  source: "built-in" | "cache" | "remote";
  diagnostic?: "profile-registry-refresh-rejected" | "cached-profile-unavailable";
  remoteProfileRequired?: boolean;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value) ?? "null";
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function openClawSchemaBundleSigningPayload(bundle: OpenClawSchemaBundle): string {
  const { signature: _signature, ...unsigned } = bundle;
  return stableJson(unsigned);
}

export function openClawSchemaBundlePayloadHash(bundle: OpenClawSchemaBundle): string {
  return createHash("sha256")
    .update(openClawSchemaBundleSigningPayload(bundle), "utf8")
    .digest("hex");
}

function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !CANONICAL_RFC3339_UTC.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

export function isOpenClawSchemaBundle(
  value: unknown,
  now = Date.now(),
  options: { allowExpired?: boolean } = {},
): value is OpenClawSchemaBundle {
  if (!isRecord(value) || value.format !== 1 || value.runtime !== "openclaw") return false;
  if (!hasOnlyKeys(value, [
    "format",
    "runtime",
    "sequence",
    "issuedAt",
    "expiresAt",
    "keyId",
    "retiredProfileIds",
    "profiles",
    "signature",
  ])) return false;
  if (
    typeof value.sequence !== "number"
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 1
    || !Array.isArray(value.profiles)
    || value.profiles.length < 1
    || value.profiles.length > MAX_OPENCLAW_TOOL_PROFILES
    || !validateOpenClawToolProfiles(value.profiles)
  ) return false;
  if (
    value.keyId !== undefined
    && (typeof value.keyId !== "string" || !OPENCLAW_KEY_ID_PATTERN.test(value.keyId))
  ) return false;
  if (value.retiredProfileIds !== undefined) {
    if (
      !Array.isArray(value.retiredProfileIds)
      || value.retiredProfileIds.length > BUILTIN_OPENCLAW_TOOL_PROFILES.length
      || new Set(value.retiredProfileIds).size !== value.retiredProfileIds.length
      || !value.retiredProfileIds.every((id) =>
        typeof id === "string"
        && BUILTIN_OPENCLAW_TOOL_PROFILES.some((profile) => profile.id === id))
    ) return false;
  }
  if (
    value.signature !== undefined
    && (
      !isRecord(value.signature)
      || !hasOnlyKeys(value.signature, ["algorithm", "value"])
      || value.signature.algorithm !== "ed25519"
      || typeof value.signature.value !== "string"
    )
  ) return false;
  const issuedAt = parseCanonicalTimestamp(value.issuedAt);
  const expiresAt = parseCanonicalTimestamp(value.expiresAt);
  return issuedAt !== null
    && expiresAt !== null
    && issuedAt <= now
    && expiresAt > issuedAt
    && (options.allowExpired === true || expiresAt > now);
}

function normalizedRegistryKeyring(
  value: string | OpenClawRegistryKeyring,
): OpenClawRegistryKeyring | null {
  const keyring = typeof value === "string" ? { legacy: value } : value;
  if (!isRecord(keyring)) return null;
  const entries = Object.entries(keyring);
  if (entries.length < 1 || entries.length > MAX_REGISTRY_KEYS) return null;
  try {
    for (const [id, pem] of entries) {
      if (
        !OPENCLAW_KEY_ID_PATTERN.test(id)
        || typeof pem !== "string"
        || createPublicKey(pem).asymmetricKeyType !== "ed25519"
      ) return null;
    }
    return Object.fromEntries(entries) as OpenClawRegistryKeyring;
  } catch {
    return null;
  }
}

function verifiedOpenClawBundleKeyId(
  value: unknown,
  publicKeys: string | OpenClawRegistryKeyring,
  now: number,
  options: { allowExpired?: boolean } = {},
): string | null {
  if (!isOpenClawSchemaBundle(value, now, options) || !value.signature) return null;
  const keyring = normalizedRegistryKeyring(publicKeys);
  if (!keyring) return null;
  const entries = Object.entries(keyring);
  if (value.keyId === undefined && entries.length !== 1) return null;
  const candidates = value.keyId === undefined
    ? entries
    : entries.filter(([id]) => id === value.keyId);
  if (candidates.length !== 1) return null;
  const encoded = value.signature.value;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    return null;
  }
  try {
    const signature = Buffer.from(encoded, "base64");
    if (
      signature.byteLength !== 64
      || signature.toString("base64") !== encoded
    ) return null;
    const [id, pem] = candidates[0];
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === "ed25519"
      && verify(
        null,
        Buffer.from(openClawSchemaBundleSigningPayload(value), "utf8"),
        key,
        signature,
      )
      ? id
      : null;
  } catch {
    return null;
  }
}

export function verifyOpenClawSchemaBundle(
  value: unknown,
  publicKeys: string | OpenClawRegistryKeyring,
  now = Date.now(),
  options: { allowExpired?: boolean } = {},
): value is OpenClawSchemaBundle {
  return verifiedOpenClawBundleKeyId(value, publicKeys, now, options) !== null;
}

function meetsOpenClawGenesisFloor(bundle: OpenClawSchemaBundle): boolean {
  return bundle.sequence > BUILTIN_OPENCLAW_SCHEMA_BUNDLE.sequence
    || (
      bundle.sequence === BUILTIN_OPENCLAW_SCHEMA_BUNDLE.sequence
      && openClawSchemaBundleSigningPayload(bundle)
        === openClawSchemaBundleSigningPayload(BUILTIN_OPENCLAW_SCHEMA_BUNDLE)
    );
}

function validRegistryCheckpoint(value: unknown): value is OpenClawRegistryCheckpoint {
  return isRecord(value)
    && Object.keys(value).length === 2
    && typeof value.sequence === "number"
    && Number.isSafeInteger(value.sequence)
    && value.sequence >= BUILTIN_OPENCLAW_SCHEMA_BUNDLE.sequence
    && typeof value.payloadHash === "string"
    && OPENCLAW_SHA256_HEX.test(value.payloadHash);
}

function meetsOpenClawCheckpoint(
  bundle: OpenClawSchemaBundle,
  checkpoint: OpenClawRegistryCheckpoint | undefined,
): boolean {
  if (!checkpoint || bundle.sequence > checkpoint.sequence) return true;
  return bundle.sequence === checkpoint.sequence
    && openClawSchemaBundlePayloadHash(bundle) === checkpoint.payloadHash;
}

function defaultOpenClawCacheDir(): string {
  const covenRoot = process.env.COVEN_HOME || path.join(homedir(), ".coven");
  return process.env.COVEN_CAVE_HOME || path.join(covenRoot, "cave");
}

function openClawCacheFile(cacheDir?: string): string {
  return path.join(cacheDir || defaultOpenClawCacheDir(), CACHE_FILE);
}

function trustAnchorFile(file: string): string {
  return `${file}.anchor`;
}

function trustAnchorJournalDir(file: string): string {
  return `${trustAnchorFile(file)}.journal`;
}

function trustAnchorJournalEntry(file: string, anchor: OpenClawTrustAnchor): string {
  return path.join(
    trustAnchorJournalDir(file),
    `${anchor.sequence}-${anchor.payloadHash}.json`,
  );
}

function cacheLockFile(file: string): string {
  return `${file}.lock`;
}

function validTrustAnchor(value: unknown): value is OpenClawTrustAnchor {
  return isRecord(value)
    && Object.keys(value).length === 2
    && typeof value.sequence === "number"
    && Number.isSafeInteger(value.sequence)
    && value.sequence >= BUILTIN_OPENCLAW_SCHEMA_BUNDLE.sequence
    && typeof value.payloadHash === "string"
    && OPENCLAW_SHA256_HEX.test(value.payloadHash);
}

async function readBoundedFile(file: string, maximumBytes: number): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof registryFs.open>> | null = null;
  try {
    handle = await registryFs.open(file, "r");
    const bytes = Buffer.allocUnsafe(maximumBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytesRead > maximumBytes ? null : bytes.toString("utf8", 0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readLegacyTrustAnchor(file: string): Promise<OpenClawTrustAnchor | null> {
  try {
    const raw = await readBoundedFile(trustAnchorFile(file), 1024);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return validTrustAnchor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readJournalTrustAnchors(file: string): Promise<OpenClawTrustAnchor[]> {
  let directory: Awaited<ReturnType<typeof registryFs.opendir>>;
  try {
    directory = await registryFs.opendir(trustAnchorJournalDir(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new OpenClawCacheTrustConflictError("OpenClaw trust journal unavailable");
  }
  const anchors: OpenClawTrustAnchor[] = [];
  let count = 0;
  try {
    for await (const entry of directory) {
      count += 1;
      if (count > MAX_TRUST_ANCHOR_SCAN) {
        throw new OpenClawCacheTrustConflictError("OpenClaw trust journal overfull");
      }
      const match = /^(\d{1,16})-([a-f0-9]{64})\.json$/.exec(entry.name);
      if (!entry.isFile() || !match) {
        throw new OpenClawCacheTrustConflictError("Invalid OpenClaw trust journal entry");
      }
      const raw = await readBoundedFile(path.join(trustAnchorJournalDir(file), entry.name), 1024);
      const parsed = raw === null ? null : JSON.parse(raw) as unknown;
      const anchor = parsed && validTrustAnchor(parsed) ? parsed : null;
      if (
        !anchor
        || anchor.sequence !== Number(match[1])
        || anchor.payloadHash !== match[2]
      ) {
        throw new OpenClawCacheTrustConflictError("Corrupt OpenClaw trust journal entry");
      }
      anchors.push(anchor);
    }
  } catch (error) {
    if (error instanceof OpenClawCacheTrustConflictError) throw error;
    throw new OpenClawCacheTrustConflictError("OpenClaw trust journal unreadable");
  } finally {
    await directory.close().catch(() => undefined);
  }
  return anchors;
}

async function readTrustAnchor(file: string): Promise<OpenClawTrustAnchor | null> {
  const [legacy, journal] = await Promise.all([
    readLegacyTrustAnchor(file),
    readJournalTrustAnchors(file),
  ]);
  const anchors = legacy ? [...journal, legacy] : journal;
  if (!anchors.length) return null;
  const highestSequence = Math.max(...anchors.map((anchor) => anchor.sequence));
  const highest = anchors.filter((anchor) => anchor.sequence === highestSequence);
  if (new Set(highest.map((anchor) => anchor.payloadHash)).size !== 1) {
    throw new OpenClawCacheTrustConflictError("Conflicting OpenClaw trust anchors");
  }
  return highest[0];
}

function anchorForBundle(bundle: OpenClawSchemaBundle): OpenClawTrustAnchor {
  return {
    sequence: bundle.sequence,
    payloadHash: openClawSchemaBundlePayloadHash(bundle),
  };
}

function anchorAcceptsBundle(
  anchor: OpenClawTrustAnchor | null,
  bundle: OpenClawSchemaBundle,
): boolean {
  if (!anchor) return true;
  if (bundle.sequence > anchor.sequence) return true;
  return bundle.sequence === anchor.sequence
    && openClawSchemaBundlePayloadHash(bundle) === anchor.payloadHash;
}

function anchorMatchesBundle(
  anchor: OpenClawTrustAnchor | null,
  bundle: OpenClawSchemaBundle,
): boolean {
  return !!anchor
    && anchor.sequence === bundle.sequence
    && anchor.payloadHash === openClawSchemaBundlePayloadHash(bundle);
}

async function pruneTrustAnchorJournal(file: string): Promise<void> {
  const anchors = await readJournalTrustAnchors(file);
  const retained = new Set(anchors
    .sort((left, right) =>
      right.sequence - left.sequence
      || right.payloadHash.localeCompare(left.payloadHash))
    .slice(0, MAX_TRUST_ANCHORS)
    .map((anchor) => `${anchor.sequence}-${anchor.payloadHash}.json`));
  await Promise.all(anchors
    .filter((anchor) => !retained.has(`${anchor.sequence}-${anchor.payloadHash}.json`))
    .map((anchor) => registryFs.rm(trustAnchorJournalEntry(file, anchor), { force: true })
      .catch(() => undefined)));
}

async function writeTrustAnchor(
  file: string,
  anchor: OpenClawTrustAnchor,
): Promise<boolean> {
  const prior = await readTrustAnchor(file);
  if (
    prior
    && (
      anchor.sequence < prior.sequence
      || (anchor.sequence === prior.sequence && anchor.payloadHash !== prior.payloadHash)
    )
  ) return false;
  const entry = trustAnchorJournalEntry(file, anchor);
  await registryFs.mkdir(path.dirname(entry), { recursive: true });
  try {
    await registryFs.writeFile(entry, JSON.stringify(anchor), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
    const raw = await readBoundedFile(entry, 1024);
    const existing = raw === null ? null : JSON.parse(raw) as unknown;
    if (
      !existing
      || !validTrustAnchor(existing)
      || existing.sequence !== anchor.sequence
      || existing.payloadHash !== anchor.payloadHash
    ) return false;
  }
  const accepted = await readTrustAnchor(file);
  if (
    !accepted
    || accepted.sequence > anchor.sequence
    || (accepted.sequence === anchor.sequence && accepted.payloadHash !== anchor.payloadHash)
  ) return false;
  await pruneTrustAnchorJournal(file);
  await writeJsonAtomic(trustAnchorFile(file), anchor);
  return true;
}

async function cacheRecordExists(file: string): Promise<boolean> {
  try {
    return (await registryFs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function readTrustedCacheRecord(
  file: string,
  publicKeys: OpenClawRegistryKeyring,
  checkpoint: OpenClawRegistryCheckpoint | undefined,
  now: number,
): Promise<CachedOpenClawSchemaBundle | null> {
  try {
    const raw = await readBoundedFile(file, MAX_CACHE_BYTES);
    if (raw === null) return null;
    const cached = JSON.parse(raw) as unknown;
    if (
      !isRecord(cached)
      || !hasOnlyKeys(cached, ["fetchedAt", "verifiedKeyId", "bundle"])
      || typeof cached.fetchedAt !== "number"
      || !Number.isSafeInteger(cached.fetchedAt)
      || cached.fetchedAt < 0
      || typeof cached.verifiedKeyId !== "string"
      || !OPENCLAW_KEY_ID_PATTERN.test(cached.verifiedKeyId)
    ) return null;
    const bundle = cached.bundle;
    if (!verifyOpenClawSchemaBundle(
      bundle,
      publicKeys,
      now,
      { allowExpired: true },
    )) return null;
    const verifiedKeyId = verifiedOpenClawBundleKeyId(
      bundle,
      publicKeys,
      now,
      { allowExpired: true },
    );
    if (
      verifiedKeyId !== cached.verifiedKeyId
      || !meetsOpenClawGenesisFloor(bundle)
      || !meetsOpenClawCheckpoint(bundle, checkpoint)
    ) return null;
    return {
      fetchedAt: cached.fetchedAt,
      verifiedKeyId: cached.verifiedKeyId,
      bundle,
    };
  } catch {
    return null;
  }
}

async function readVerifiedCache(
  file: string,
  publicKeys: OpenClawRegistryKeyring,
  checkpoint: OpenClawRegistryCheckpoint | undefined,
  now: number,
  anchor: OpenClawTrustAnchor | null,
): Promise<CachedOpenClawSchemaBundle | null> {
  const cached = await readTrustedCacheRecord(file, publicKeys, checkpoint, now);
  if (
    !cached
    || cached.fetchedAt > now
    || !anchorMatchesBundle(anchor, cached.bundle)
    || !verifyOpenClawSchemaBundle(cached.bundle, publicKeys, now)
  ) return null;
  return cached;
}

type OpenClawCacheLock = {
  owns: () => Promise<boolean>;
  release: () => Promise<void>;
};

async function acquireOpenClawCacheLock(file: string): Promise<OpenClawCacheLock | null> {
  const lock = cacheLockFile(file);
  const deadline = Date.now() + CACHE_LOCK_WAIT_MS;
  await registryFs.mkdir(path.dirname(file), { recursive: true });
  while (Date.now() <= deadline) {
    try {
      const handle = await registryFs.open(lock, "wx", 0o600);
      const ownerToken = `${process.pid}:${randomBytes(16).toString("hex")}`;
      try {
        await handle.writeFile(ownerToken);
      } catch (error) {
        await handle.close().catch(() => undefined);
        await registryFs.rm(lock, { force: true }).catch(() => undefined);
        throw error;
      }
      await handle.close();
      const owns = async () => {
        try {
          return await registryFs.readFile(lock, "utf8") === ownerToken;
        } catch {
          return false;
        }
      };
      return {
        owns,
        release: async () => {
          if (await owns()) await registryFs.rm(lock, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
      try {
        const stat = await registryFs.stat(lock);
        if (Date.now() - stat.mtimeMs >= CACHE_LOCK_STALE_MS) {
          const stale = `${lock}.${process.pid}.${randomBytes(6).toString("hex")}.stale`;
          try {
            await registryFs.rename(lock, stale);
            await registryFs.rm(stale, { force: true });
            continue;
          } catch {
            // Another contender reclaimed or replaced it.
          }
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => setTimeout(resolve, CACHE_LOCK_POLL_MS));
    }
  }
  return null;
}

async function writeVerifiedCache(
  file: string,
  publicKeys: OpenClawRegistryKeyring,
  cached: CachedOpenClawSchemaBundle,
): Promise<boolean> {
  const lock = await acquireOpenClawCacheLock(file);
  if (!lock) return false;
  try {
    if (!await lock.owns()) return false;
    const currentAnchor = await readTrustAnchor(file);
    if (!anchorAcceptsBundle(currentAnchor, cached.bundle)) return false;
    if (!await writeTrustAnchor(file, anchorForBundle(cached.bundle))) return false;
    if (!await lock.owns()) return false;
    const acceptedAnchor = await readTrustAnchor(file);
    if (!anchorMatchesBundle(acceptedAnchor, cached.bundle)) return false;
    const currentCache = await readTrustedCacheRecord(file, publicKeys, undefined, cached.fetchedAt);
    if (
      currentCache
      && (
        currentCache.bundle.sequence > cached.bundle.sequence
        || (
          currentCache.bundle.sequence === cached.bundle.sequence
          && openClawSchemaBundleSigningPayload(currentCache.bundle)
            !== openClawSchemaBundleSigningPayload(cached.bundle)
        )
      )
    ) return false;
    if (!await lock.owns()) return false;
    await writeJsonAtomic(file, cached);
    return true;
  } finally {
    await lock.release();
  }
}

async function waitForOpenClawCacheWriter(
  file: string,
  publicKeys: OpenClawRegistryKeyring,
  checkpoint: OpenClawRegistryCheckpoint | undefined,
  now: number,
  minimumSequence: number,
): Promise<CachedOpenClawSchemaBundle | null> {
  const lock = cacheLockFile(file);
  const deadline = Date.now() + CACHE_LOCK_WAIT_MS;
  for (;;) {
    const anchor = await readTrustAnchor(file);
    const cached = await readVerifiedCache(file, publicKeys, checkpoint, now, anchor);
    if (cached && cached.bundle.sequence >= minimumSequence) return cached;
    try {
      await registryFs.stat(lock);
    } catch {
      const finalAnchor = await readTrustAnchor(file);
      return readVerifiedCache(file, publicKeys, checkpoint, now, finalAnchor);
    }
    if (Date.now() >= deadline) return cached;
    await new Promise<void>((resolve) => setTimeout(resolve, CACHE_LOCK_POLL_MS));
  }
}

function safeOpenClawRegistryUrl(value: string | undefined): value is string {
  try {
    const parsed = value ? new URL(value) : null;
    return !!parsed
      && parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === "";
  } catch {
    return false;
  }
}

async function readOpenClawRegistryBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BUNDLE_BYTES)
  ) throw new Error("OpenClaw registry body too large");
  if (!response.body) {
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
      throw new Error("OpenClaw registry body too large");
    }
    return raw;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BUNDLE_BYTES) throw new Error("OpenClaw registry body too large");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function fetchOpenClawSchemaBundle(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  let response: Response | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      void response?.body?.cancel().catch(() => undefined);
      reject(new Error("OpenClaw registry refresh timed out"));
    }, REFRESH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        response = await fetchImpl(url, {
          credentials: "omit",
          redirect: "error",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (
          timedOut
          || !response.ok
          || response.redirected
          || response.type === "opaqueredirect"
        ) throw new Error("Untrusted OpenClaw registry response");
        return readOpenClawRegistryBody(response);
      })(),
      deadline,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const PACKAGED_URL = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL;
const PACKAGED_PUBLIC_KEY = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY;
const PACKAGED_PUBLIC_KEYS = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS;
const PACKAGED_CHECKPOINT = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT;

function parseOpenClawKeyring(value: string | undefined): OpenClawRegistryKeyring | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed as OpenClawRegistryKeyring : undefined;
  } catch {
    return undefined;
  }
}

function parseOpenClawCheckpoint(value: string | undefined): OpenClawRegistryCheckpoint | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return validRegistryCheckpoint(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function configuredOpenClawRegistryUrl(
  source: OpenClawCompatibilitySource,
): string | undefined {
  return source.url
    ?? PACKAGED_URL
    ?? (
      process.env.NODE_ENV === "production"
        ? undefined
        : process.env.COVEN_OPENCLAW_SCHEMA_REGISTRY_URL
    );
}

function configuredOpenClawRegistryKeyring(
  source: OpenClawCompatibilitySource,
): OpenClawRegistryKeyring | undefined {
  if (source.publicKeys !== undefined) return source.publicKeys;
  const packaged = parseOpenClawKeyring(PACKAGED_PUBLIC_KEYS)
    ?? (PACKAGED_PUBLIC_KEY ? { legacy: PACKAGED_PUBLIC_KEY } : undefined);
  if (packaged || process.env.NODE_ENV === "production") return packaged;
  return parseOpenClawKeyring(process.env.COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS)
    ?? (
      process.env.COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY
        ? { legacy: process.env.COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY }
        : undefined
    );
}

function configuredOpenClawCheckpoint(
  source: OpenClawCompatibilitySource,
): OpenClawRegistryCheckpoint | undefined {
  if (source.checkpoint !== undefined) return source.checkpoint;
  return parseOpenClawCheckpoint(PACKAGED_CHECKPOINT)
    ?? (
      process.env.NODE_ENV === "production"
        ? undefined
        : parseOpenClawCheckpoint(process.env.COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT)
    );
}

function openClawRefreshKey(
  file: string,
  url: string,
  publicKeys: OpenClawRegistryKeyring,
  checkpoint: OpenClawRegistryCheckpoint | undefined,
): string {
  return createHash("sha256")
    .update(`${file}\0${url}\0${stableJson(publicKeys)}\0${stableJson(checkpoint ?? null)}`)
    .digest("hex");
}

async function refreshOpenClawSchemaBundle(
  file: string,
  url: string,
  publicKeys: OpenClawRegistryKeyring,
  checkpoint: OpenClawRegistryCheckpoint | undefined,
  fetchImpl: typeof fetch,
  now: number,
): Promise<LoadedOpenClawSchemaBundle> {
  const raw = await fetchOpenClawSchemaBundle(url, fetchImpl);
  const remote = JSON.parse(raw) as unknown;
  if (!verifyOpenClawSchemaBundle(remote, publicKeys, now)) {
    throw new Error("Invalid OpenClaw registry signature");
  }
  const verifiedKeyId = verifiedOpenClawBundleKeyId(remote, publicKeys, now);
  if (
    verifiedKeyId === null
    || !meetsOpenClawGenesisFloor(remote)
    || !meetsOpenClawCheckpoint(remote, checkpoint)
  ) throw new Error("Invalid OpenClaw registry bundle");
  const anchor = await readTrustAnchor(file);
  if (!anchorAcceptsBundle(anchor, remote)) {
    throw new Error("OpenClaw registry rollback or rewrite");
  }
  const cached = {
    fetchedAt: now,
    verifiedKeyId,
    bundle: remote,
  };
  if (await writeVerifiedCache(file, publicKeys, cached)) {
    return { bundle: remote, source: "remote" };
  }
  const current = await waitForOpenClawCacheWriter(
    file,
    publicKeys,
    checkpoint,
    now,
    remote.sequence,
  );
  if (current && current.bundle.sequence >= remote.sequence) {
    return { bundle: current.bundle, source: "cache" };
  }
  throw new OpenClawCacheWriterPendingError("OpenClaw cache writer did not settle");
}

function startOpenClawRefresh(
  key: string,
  refresh: () => Promise<LoadedOpenClawSchemaBundle>,
): Promise<LoadedOpenClawSchemaBundle> {
  const running = refreshFlights.get(key);
  if (running) return running;
  const flight = refresh().finally(() => refreshFlights.delete(key));
  refreshFlights.set(key, flight);
  return flight;
}

function builtInOpenClawBundle(
  diagnostic?: "profile-registry-refresh-rejected" | "cached-profile-unavailable",
  remoteProfileRequired = false,
): LoadedOpenClawSchemaBundle {
  return {
    bundle: BUILTIN_OPENCLAW_SCHEMA_BUNDLE,
    source: "built-in",
    diagnostic,
    remoteProfileRequired,
  };
}

async function loadOpenClawSchemaBundle(
  source: OpenClawCompatibilitySource,
): Promise<LoadedOpenClawSchemaBundle> {
  const now = source.now?.() ?? Date.now();
  const file = openClawCacheFile(source.cacheDir);
  const url = configuredOpenClawRegistryUrl(source);
  const configuredKeys = configuredOpenClawRegistryKeyring(source);
  const checkpoint = configuredOpenClawCheckpoint(source);
  const publicKeys = configuredKeys
    ? normalizedRegistryKeyring(configuredKeys)
    : null;
  if (!url && !configuredKeys) return builtInOpenClawBundle();
  if (
    !safeOpenClawRegistryUrl(url)
    || !publicKeys
    || (source.checkpoint !== undefined && !validRegistryCheckpoint(source.checkpoint))
    || (
      process.env.NODE_ENV === "production"
      && source.checkpoint === undefined
      && checkpoint === undefined
    )
  ) return builtInOpenClawBundle("profile-registry-refresh-rejected");

  let anchor: OpenClawTrustAnchor | null;
  try {
    anchor = await readTrustAnchor(file);
  } catch (error) {
    if (error instanceof OpenClawCacheTrustConflictError) {
      return builtInOpenClawBundle("profile-registry-refresh-rejected", true);
    }
    throw error;
  }
  const trustedCache = await readTrustedCacheRecord(file, publicKeys, checkpoint, now);
  const cacheExists = await cacheRecordExists(file);
  const cacheAnchorMissing = !!trustedCache && !anchor;
  const builtInAnchor = anchorForBundle(BUILTIN_OPENCLAW_SCHEMA_BUNDLE);
  let remoteProfileRequired = cacheAnchorMissing || (
    !!anchor
    && (
      anchor.sequence !== builtInAnchor.sequence
      || anchor.payloadHash !== builtInAnchor.payloadHash
    )
  );
  const cached = anchor
    ? await readVerifiedCache(file, publicKeys, checkpoint, now, anchor)
    : null;
  const cacheFresh = !!cached
    && now - cached.fetchedAt >= 0
    && now - cached.fetchedAt < CACHE_TTL_MS;
  if (cacheFresh && cached) {
    return { bundle: cached.bundle, source: "cache" };
  }

  const refresh = startOpenClawRefresh(
    openClawRefreshKey(file, url, publicKeys, checkpoint),
    () => refreshOpenClawSchemaBundle(
      file,
      url,
      publicKeys,
      checkpoint,
      source.fetchImpl ?? fetch,
      now,
    ),
  );
  try {
    return await refresh;
  } catch {
    let currentAnchor: OpenClawTrustAnchor | null;
    try {
      currentAnchor = await readTrustAnchor(file);
    } catch (error) {
      if (error instanceof OpenClawCacheTrustConflictError) {
        return builtInOpenClawBundle("profile-registry-refresh-rejected", true);
      }
      throw error;
    }
    const current = await readVerifiedCache(
      file,
      publicKeys,
      checkpoint,
      now,
      currentAnchor,
    );
    if (current) {
      return {
        bundle: current.bundle,
        source: "cache",
        diagnostic: "profile-registry-refresh-rejected",
      };
    }
    remoteProfileRequired = remoteProfileRequired || (
      !!currentAnchor
      && (
        currentAnchor.sequence !== builtInAnchor.sequence
        || currentAnchor.payloadHash !== builtInAnchor.payloadHash
      )
    );
    if (remoteProfileRequired || (trustedCache && !cached)) {
      return builtInOpenClawBundle("cached-profile-unavailable", true);
    }
    if (cacheExists && trustedCache) {
      return builtInOpenClawBundle("cached-profile-unavailable", true);
    }
    return builtInOpenClawBundle("profile-registry-refresh-rejected");
  }
}

function openClawProfileRevision(profile: OpenClawToolProfile): string {
  return createHash("sha256").update(stableJson(profile)).digest("hex");
}

export function quarantineOpenClawProfile(profile: OpenClawToolProfile): void {
  const valid = validateOpenClawToolProfiles([profile])?.[0];
  if (!valid) return;
  const revision = openClawProfileRevision(valid);
  if (quarantinedOpenClawProfileRevisions.get(valid.id) === revision) return;
  if (quarantinedOpenClawProfileRevisions.has(valid.id)) {
    quarantinedOpenClawProfileRevisions.delete(valid.id);
  } else if (
    quarantinedOpenClawProfileRevisions.size >= MAX_QUARANTINED_OPENCLAW_PROFILE_IDS
  ) {
    const oldest = quarantinedOpenClawProfileRevisions.keys().next();
    if (!oldest.done) quarantinedOpenClawProfileRevisions.delete(oldest.value);
  }
  quarantinedOpenClawProfileRevisions.set(valid.id, revision);
}

export function clearOpenClawProfileQuarantineForTests(): void {
  quarantinedOpenClawProfileRevisions.clear();
}

export async function loadOpenClawCompatibility(
  discovery: OpenClawGatewayDiscovery,
  source: OpenClawCompatibilitySource = {},
): Promise<OpenClawCompatibility> {
  const loaded = await loadOpenClawSchemaBundle(source);
  if (loaded.remoteProfileRequired) {
    return {
      mode: "plain",
      discovery,
      bundleSource: loaded.source,
      diagnostic: loaded.diagnostic ?? "cached-profile-unavailable",
    };
  }
  const now = source.now?.() ?? Date.now();
  if (
    loaded.source === "built-in"
    && Date.parse(BUILTIN_OPENCLAW_SCHEMA_BUNDLE.expiresAt) <= now
  ) {
    return {
      mode: "plain",
      discovery,
      bundleSource: "built-in",
      diagnostic: loaded.diagnostic ?? "cached-profile-unavailable",
    };
  }
  const remoteProfiles = validateOpenClawToolProfiles(loaded.bundle.profiles) ?? [];
  const remoteById = new Map(remoteProfiles.map((profile) => [profile.id, profile]));
  const builtInProfiles = validateOpenClawToolProfiles(BUILTIN_OPENCLAW_TOOL_PROFILES) ?? [];
  const candidates = loaded.source === "built-in"
    ? builtInProfiles
    : [
        ...remoteProfiles,
        ...builtInProfiles.filter((profile) =>
          !loaded.bundle.retiredProfileIds?.includes(profile.id)
          && !remoteById.has(profile.id)),
      ];
  const profile = selectOpenClawToolProfile(candidates, discovery);
  if (!profile) {
    return {
      mode: "plain",
      discovery,
      bundleSource: loaded.source,
      diagnostic: loaded.diagnostic ?? "no-compatible-profile",
    };
  }
  const revision = openClawProfileRevision(profile);
  if (quarantinedOpenClawProfileRevisions.get(profile.id) === revision) {
    return {
      mode: "plain",
      discovery,
      bundleSource: loaded.source,
      diagnostic: "profile-quarantined",
    };
  }
  const selectedFromRegistry = loaded.source !== "built-in"
    && remoteProfiles.some((candidate) =>
      candidate.id === profile.id
      && openClawProfileRevision(candidate) === revision);
  return {
    mode: "structured",
    discovery,
    profile,
    bundleSource: selectedFromRegistry ? loaded.source : "built-in",
  };
}
