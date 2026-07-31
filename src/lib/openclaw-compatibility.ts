import { createHash } from "node:crypto";

import { AgentEventSchema, HelloOkSchema } from "@openclaw/gateway-protocol";
import { Value } from "typebox/value";

const MAX_OPENCLAW_TOOL_PROFILES = 32;
const MAX_OPENCLAW_PROFILE_LIST = 16;
const MAX_OPENCLAW_STRING_BYTES = 256;
const OPENCLAW_ALLOWED_EVENT_NAMES = ["agent", "session.tool"] as const;
const OPENCLAW_ALLOWED_STREAMS = ["tool"] as const;
const OPENCLAW_ALLOWED_CLIENT_CAPABILITIES = ["tool-events"] as const;
const OPENCLAW_DIRECT_ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,255}$/;
const OPENCLAW_HEX_40_OR_64 = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OPENCLAW_SHA256_HEX = /^[a-f0-9]{64}$/;
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
  priority: number;
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

function validateOpenClawToolProfile(value: unknown): OpenClawToolProfile | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "priority", "requires", "eventNames", "streams", "phases", "aliases", "errorStates", "source"])) return null;
  if (!validBoundedString(value.id) || typeof value.priority !== "number" || !Number.isSafeInteger(value.priority)) return null;

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

  const errorStates = validateStringList(value.errorStates);
  if (!errorStates) return null;

  if (!isRecord(value.source) || !hasOnlyKeys(value.source, ["repo", "package", "blobSha"])) return null;
  if (!validBoundedString(value.source.repo) || !validBoundedString(value.source.package) || typeof value.source.blobSha !== "string" || !OPENCLAW_HEX_40_OR_64.test(value.source.blobSha)) return null;

  return {
    id: value.id,
    priority: value.priority,
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
  const priorities = profiles.map((profile) => profile.priority);
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

function firstNumber(record: Record<string, unknown>, aliases: string[]): number | null {
  const value = firstPresent(record, aliases);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  return [...matches].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0] ?? null;
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

function toolResultStatus(data: Record<string, unknown>, profile: OpenClawToolProfile): string | null {
  const direct = firstString(data, profile.aliases.status);
  if (direct) return direct;
  return resultRecord(data, profile)?.status && validBoundedString(resultRecord(data, profile)!.status)
    ? resultRecord(data, profile)!.status as string
    : null;
}

function toolResultExitCode(data: Record<string, unknown>, profile: OpenClawToolProfile): number | null {
  const direct = firstNumber(data, profile.aliases.exitCode);
  if (direct !== null) return direct;
  const nested = resultRecord(data, profile)?.exitCode;
  return typeof nested === "number" && Number.isFinite(nested) ? nested : null;
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
  const status = toolResultStatus(data, profile);
  const exitCode = toolResultExitCode(data, profile);
  return {
    kind: "tool_end",
    id,
    name,
    output: output.value,
    isError: firstPresent(data, profile.aliases.isError) === true
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
