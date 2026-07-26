/**
 * Grok Build's streaming protocol is deliberately treated as a compatibility
 * contract, not an invitation to guess at future event names.  The compiled
 * baseline below is restricted to the frames documented by xAI; a signed
 * registry can add a tool envelope only after a local capability probe has
 * established that the installed launcher advertises that protocol.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type GrokRunCapabilities = {
  version: string | null;
  streamingJson: boolean;
  options: string[];
  valueOptions: string[];
};

export function grokRunCapabilitiesFromHelp(help: string, version: string | null = null): GrokRunCapabilities {
  const options = [...help.matchAll(/^\s*(--[a-z][a-z0-9-]*)\b/gim)].map((match) => match[1]);
  const unique = [...new Set(options)];
  const valueOptions = unique.filter((option) => new RegExp(`${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|=)+(?:<[^>]+>|\\[[^\\]]+\\]|[A-Z][A-Z_-]*)`, "i").test(help));
  return {
    version,
    streamingJson: /--output-format(?:\s|=)+(?:<[^>]+>|\[[^\]]+\]|[A-Z][A-Z_-]*)?[\s\S]{0,240}\bstreaming-json\b/i.test(help),
    options: unique,
    valueOptions,
  };
}

/** Bounded, credential-free local contract probe. It never invokes a run. */
export async function probeGrokRunCapabilities(
  launch: { command: string; fixedArgs: string[] },
  env: NodeJS.ProcessEnv,
  timeoutMs = process.platform === "win32" ? 6_000 : 2_500,
): Promise<GrokRunCapabilities> {
  const probe = (args: string[]): Promise<string | null> => new Promise((resolve) => {
    let output = ""; let settled = false;
    const finish = (value: string | null) => { if (!settled) { settled = true; resolve(value); } };
    try {
      const child = spawn(launch.command, [...launch.fixedArgs, ...args], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) as unknown as ChildProcessWithoutNullStreams;
      const append = (chunk: Buffer) => { if (output.length < 64 * 1024) output += chunk.toString().slice(0, 64 * 1024 - output.length); };
      child.stdout.on("data", append); child.stderr.on("data", append);
      const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* bounded best effort */ } finish(null); }, timeoutMs);
      child.once("error", () => { clearTimeout(timer); finish(null); });
      child.once("close", (code) => { clearTimeout(timer); finish(code === 0 ? output : null); });
    } catch { finish(null); }
  });
  const [help, versionOutput] = await Promise.all([probe(["--help"]), probe(["--version"])]);
  const version = versionOutput?.match(/\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?/)?.[0] ?? null;
  return help ? grokRunCapabilitiesFromHelp(help, version) : { version, streamingJson: false, options: [], valueOptions: [] };
}

export type GrokRegistryKeyring = Record<string, string>;
export type GrokRegistryCheckpoint = { sequence: number; payloadHash: string };

/** Data only: registries cannot supply selectors, paths, code, or argv. */
export type GrokEventSchema = {
  id: string;
  priority?: number;
  requires: { streamingJson: true; options?: string[] };
  eventTypes: {
    ignored: string[];
    text: string[];
    end: string[];
    error: string[];
    toolStart: string[];
    toolProgress?: string[];
    toolEnd: string[];
    toolComplete: string[];
  };
  fields: {
    type: string[];
    text: string[];
    sessionId: string[];
    message: string[];
    usage: string[];
    totalCostUsd: string[];
    id: string[];
    name: string[];
    input: string[];
    output: string[];
    state: string[];
    error: string[];
    terminalStates: string[];
    errorStates: string[];
  };
  /** Only the documented output option/value may be selected by a schema. */
  launch: { outputOption: "--output-format"; outputValue: "streaming-json" };
};

export type GrokSchemaBundle = {
  format: 1;
  runtime: "grok-build";
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  keyId?: string;
  retiredSchemaIds?: string[];
  schemas: GrokEventSchema[];
  signature?: { algorithm: "ed25519"; value: string };
};

export type GrokCompatibilityDiagnostic =
  | "streaming-json-unavailable"
  | "no-compatible-schema"
  | "schema-quarantined"
  | "schema-registry-refresh-rejected"
  | "cached-schema-unavailable";

export type GrokCompatibility = {
  mode: "structured" | "plain";
  capabilities: GrokRunCapabilities;
  schema?: GrokEventSchema;
  bundleSource: "built-in" | "cache" | "remote";
  diagnostic?: GrokCompatibilityDiagnostic;
};

export type GrokParsedEvent =
  | { kind: "text"; text: string }
  | { kind: "end"; sessionId?: string; usage?: unknown; totalCostUsd?: unknown }
  | { kind: "error"; message: string; usage?: unknown; totalCostUsd?: unknown }
  | { kind: "tool_start"; id: string; name: string; input: unknown }
  | { kind: "tool_progress"; id: string; output: unknown }
  | { kind: "tool_end"; id: string; output: unknown; isError: boolean }
  | { kind: "tool_complete"; id: string; name: string; input: unknown; output: unknown; isError: boolean }
  | { kind: "ignore" }
  | { kind: "unknown" };

const MAX_BUNDLE_BYTES = 256 * 1024;
const MAX_CACHE_BYTES = 512 * 1024;
const MAX_SCHEMAS = 32;
const schemaQuarantine = new Map<string, string>();

/** The only source-verified built-in Grok frame contract as of 2026-07-26. */
export const BUILTIN_GROK_SCHEMA_BUNDLE: GrokSchemaBundle = {
  format: 1,
  runtime: "grok-build",
  sequence: 1,
  issuedAt: "2026-07-26T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  schemas: [{
    id: "grok-build-streaming-json-v1",
    requires: { streamingJson: true, options: ["--output-format"] },
    eventTypes: {
      ignored: ["thought", "max_turns_reached", "auto_compact_start", "auto_compact_end"],
      text: ["text"], end: ["end"], error: ["error"],
      toolStart: [], toolProgress: [], toolEnd: [], toolComplete: [],
    },
    fields: {
      type: ["type"], text: ["data"], sessionId: ["sessionId", "session_id"],
      message: ["message"], usage: ["usage"], totalCostUsd: ["total_cost_usd"],
      id: ["id", "tool_call_id"], name: ["name", "tool_name"], input: ["input"],
      output: ["output", "result"], state: ["state", "status"], error: ["error"],
      terminalStates: ["completed", "complete", "failed", "error"], errorStates: ["failed", "error"],
    },
    launch: { outputOption: "--output-format", outputValue: "streaming-json" },
  }],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, aliases: string[]): string | undefined {
  for (const alias of aliases) if (typeof value[alias] === "string") return value[alias];
  return undefined;
}

function valueField(value: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) if (alias in value) return value[alias];
  return undefined;
}

export function redactedGrokEventFingerprint(value: unknown): string {
  const safe = ["type", "data", "sessionId", "session_id", "id", "tool_call_id", "name", "tool_name", "state", "status"];
  const shape = isRecord(value)
    ? Object.fromEntries(safe.filter((key) => key in value).map((key) => [key, typeof value[key]]))
    : typeof value;
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 16);
}

/** A frame only becomes tool activity after the selected schema explicitly names it. */
export function parseGrokCompatibilityEvent(raw: unknown, schema?: GrokEventSchema): GrokParsedEvent {
  if (!schema || !isRecord(raw)) return { kind: "unknown" };
  const type = stringField(raw, schema.fields.type);
  if (!type) return { kind: "unknown" };
  const fields = schema.fields;
  if (schema.eventTypes.ignored.includes(type)) return { kind: "ignore" };
  if (schema.eventTypes.text.includes(type)) {
    const text = stringField(raw, fields.text);
    return text === undefined ? { kind: "unknown" } : { kind: "text", text };
  }
  if (schema.eventTypes.end.includes(type)) return { kind: "end", sessionId: stringField(raw, fields.sessionId), usage: valueField(raw, fields.usage), totalCostUsd: valueField(raw, fields.totalCostUsd) };
  if (schema.eventTypes.error.includes(type)) return { kind: "error", message: stringField(raw, fields.message) ?? "Grok Build returned an error.", usage: valueField(raw, fields.usage), totalCostUsd: valueField(raw, fields.totalCostUsd) };
  const id = stringField(raw, fields.id);
  if (!id) return { kind: "unknown" };
  if (schema.eventTypes.toolStart.includes(type)) {
    const name = stringField(raw, fields.name);
    return name === undefined ? { kind: "unknown" } : { kind: "tool_start", id, name, input: valueField(raw, fields.input) };
  }
  if ((schema.eventTypes.toolProgress ?? []).includes(type)) return { kind: "tool_progress", id, output: valueField(raw, fields.output) };
  const isError = fields.errorStates.includes(stringField(raw, fields.state) ?? "") || valueField(raw, fields.error) === true;
  if (schema.eventTypes.toolEnd.includes(type)) return { kind: "tool_end", id, output: valueField(raw, fields.output), isError };
  if (schema.eventTypes.toolComplete.includes(type)) {
    const name = stringField(raw, fields.name);
    return name === undefined ? { kind: "unknown" } : { kind: "tool_complete", id, name, input: valueField(raw, fields.input), output: valueField(raw, fields.output), isError };
  }
  return { kind: "unknown" };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function grokSchemaBundleSigningPayload(bundle: GrokSchemaBundle): string {
  const { signature: _signature, ...unsigned } = bundle;
  return stableJson(unsigned);
}

export function grokSchemaBundlePayloadHash(bundle: GrokSchemaBundle): string {
  return createHash("sha256").update(grokSchemaBundleSigningPayload(bundle)).digest("hex");
}

function validName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,95}$/i.test(value);
}

function validAliases(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= 8 && value.every(validName) && new Set(value).size === value.length;
}

function validOptions(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 16 && value.every((option) => typeof option === "string" && /^--[a-z][a-z0-9-]{0,63}$/.test(option)) && new Set(value).size === value.length;
}

function validSchema(value: unknown): value is GrokEventSchema {
  if (!isRecord(value) || !validName(value.id) || !isRecord(value.requires) || value.requires.streamingJson !== true || !isRecord(value.eventTypes) || !isRecord(value.fields) || !isRecord(value.launch)) return false;
  if (value.priority !== undefined && (typeof value.priority !== "number" || !Number.isSafeInteger(value.priority) || Math.abs(value.priority) > 1_000)) return false;
  if (value.requires.options !== undefined && !validOptions(value.requires.options)) return false;
  if (value.launch.outputOption !== "--output-format" || value.launch.outputValue !== "streaming-json") return false;
  const events = value.eventTypes;
  if (![events.ignored, events.text, events.end, events.error, events.toolStart, events.toolEnd, events.toolComplete].every((items) => validAliases(items, true)) || (events.toolProgress !== undefined && !validAliases(events.toolProgress, true))) return false;
  const f = value.fields;
  return [f.type, f.text, f.sessionId, f.message, f.usage, f.totalCostUsd, f.id, f.name, f.input, f.output, f.state, f.error, f.terminalStates, f.errorStates].every((items) => validAliases(items, true));
}

function canonicalTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}

export function isGrokSchemaBundle(value: unknown, now = Date.now(), allowExpired = false): value is GrokSchemaBundle {
  if (!isRecord(value) || value.format !== 1 || value.runtime !== "grok-build" || typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Array.isArray(value.schemas) || value.schemas.length < 1 || value.schemas.length > MAX_SCHEMAS || !value.schemas.every(validSchema)) return false;
  if (!Object.keys(value).every((key) => ["format", "runtime", "sequence", "issuedAt", "expiresAt", "keyId", "retiredSchemaIds", "schemas", "signature"].includes(key))) return false;
  const issued = canonicalTime(value.issuedAt); const expires = canonicalTime(value.expiresAt);
  if (issued === null || expires === null || issued > now || expires <= issued || (!allowExpired && expires <= now)) return false;
  if (value.keyId !== undefined && !validName(value.keyId)) return false;
  if (value.retiredSchemaIds !== undefined && (!validAliases(value.retiredSchemaIds, true) || !value.retiredSchemaIds.every((id) => BUILTIN_GROK_SCHEMA_BUNDLE.schemas.some((schema) => schema.id === id)))) return false;
  if (value.signature !== undefined && (!isRecord(value.signature) || value.signature.algorithm !== "ed25519" || typeof value.signature.value !== "string")) return false;
  const ids = value.schemas.map((schema) => schema.id);
  return new Set(ids).size === ids.length;
}

export function verifyGrokSchemaBundle(value: unknown, publicKeys: string | GrokRegistryKeyring, now = Date.now()): value is GrokSchemaBundle {
  if (!isGrokSchemaBundle(value, now) || !value.signature) return false;
  const keys = typeof publicKeys === "string" ? { legacy: publicKeys } : publicKeys;
  const candidates = Object.entries(keys).filter(([id, pem]) => validName(id) && typeof pem === "string" && (value.keyId === undefined || value.keyId === id));
  if (candidates.length === 0 || candidates.length > 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.signature.value)) return false;
  try {
    const signature = Buffer.from(value.signature.value, "base64");
    return signature.toString("base64") === value.signature.value && candidates.some(([, pem]) => {
      const key = createPublicKey(pem);
      return key.asymmetricKeyType === "ed25519" && verify(null, Buffer.from(grokSchemaBundleSigningPayload(value)), key, signature);
    });
  } catch { return false; }
}

export function selectGrokSchema(schemas: GrokEventSchema[], capabilities: GrokRunCapabilities): GrokEventSchema | null {
  if (!capabilities.streamingJson) return null;
  const options = new Set(capabilities.options);
  const matches = schemas.filter((schema) => schema.requires.options?.every((option) => options.has(option)) ?? true);
  if (!matches.length) return null;
  const specificity = Math.max(...matches.map((schema) => schema.requires.options?.length ?? 0));
  const preferred = matches.filter((schema) => (schema.requires.options?.length ?? 0) === specificity);
  const priority = Math.max(...preferred.map((schema) => schema.priority ?? 0));
  const winners = preferred.filter((schema) => (schema.priority ?? 0) === priority);
  return winners.length === 1 ? winners[0] : null;
}

export function quarantineGrokSchema(schema: GrokEventSchema | undefined): void {
  if (!schema) return;
  if (schemaQuarantine.size >= 64 && !schemaQuarantine.has(schema.id)) schemaQuarantine.delete(schemaQuarantine.keys().next().value!);
  schemaQuarantine.set(schema.id, createHash("sha256").update(stableJson(schema)).digest("hex"));
}

type RegistrySource = { url?: string; publicKeys?: GrokRegistryKeyring; checkpoint?: GrokRegistryCheckpoint; now?: () => number; fetch?: typeof globalThis.fetch; cachePath?: string };
type Cached = { bundle: GrokSchemaBundle; checkedAt: number };

function configuredGrokRegistrySource(): RegistrySource {
  const url = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_URL || process.env.COVEN_GROK_SCHEMA_REGISTRY_URL;
  const single = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEY || process.env.COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEY;
  const rawKeyring = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS || process.env.COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS;
  const rawCheckpoint = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT || process.env.COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT;
  let publicKeys: GrokRegistryKeyring | undefined;
  let checkpoint: GrokRegistryCheckpoint | undefined;
  try { publicKeys = rawKeyring ? JSON.parse(rawKeyring) : single ? { legacy: single } : undefined; } catch { /* invalid config fails closed */ }
  try { checkpoint = rawCheckpoint ? JSON.parse(rawCheckpoint) : undefined; } catch { /* invalid config fails closed */ }
  return { url, publicKeys, checkpoint };
}

function defaultCachePath(): string {
  return path.join(process.env.COVEN_CAVE_HOME || path.join(process.env.COVEN_HOME || homedir(), ".coven", "cave"), "grok-schema-bundle-v1.json");
}

async function readCache(file: string, keys: GrokRegistryKeyring, now: number): Promise<GrokSchemaBundle | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    if (Buffer.byteLength(raw) > MAX_CACHE_BYTES) return null;
    const cached = JSON.parse(raw) as Cached;
    return verifyGrokSchemaBundle(cached?.bundle, keys, now) ? cached.bundle : null;
  } catch { return null; }
}

async function writeCache(file: string, bundle: GrokSchemaBundle): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ checkedAt: Date.now(), bundle }), { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch { /* Cache is an optimization; a failed write never broadens parsing. */ }
}

function trustedBundle(bundle: GrokSchemaBundle, checkpoint?: GrokRegistryCheckpoint): boolean {
  if (bundle.sequence < BUILTIN_GROK_SCHEMA_BUNDLE.sequence) return false;
  if (bundle.sequence === BUILTIN_GROK_SCHEMA_BUNDLE.sequence && grokSchemaBundleSigningPayload(bundle) !== grokSchemaBundleSigningPayload(BUILTIN_GROK_SCHEMA_BUNDLE)) return false;
  return !checkpoint || bundle.sequence > checkpoint.sequence || (bundle.sequence === checkpoint.sequence && grokSchemaBundlePayloadHash(bundle) === checkpoint.payloadHash);
}

export async function resolveGrokCompatibility(capabilities: GrokRunCapabilities, source: RegistrySource = configuredGrokRegistrySource()): Promise<GrokCompatibility> {
  if (!capabilities.streamingJson) return { mode: "plain", capabilities, bundleSource: "built-in", diagnostic: "streaming-json-unavailable" };
  const now = source.now?.() ?? Date.now();
  const keys = source.publicKeys ?? {};
  const cacheFile = source.cachePath ?? defaultCachePath();
  let bundle = BUILTIN_GROK_SCHEMA_BUNDLE; let bundleSource: GrokCompatibility["bundleSource"] = "built-in"; let diagnostic: GrokCompatibilityDiagnostic | undefined;
  const cached = Object.keys(keys).length ? await readCache(cacheFile, keys, now) : null;
  if (cached && trustedBundle(cached, source.checkpoint)) { bundle = cached; bundleSource = "cache"; }
  if (source.url && Object.keys(keys).length) {
    try {
      const response = await (source.fetch ?? fetch)(source.url, { signal: AbortSignal.timeout(5_000) });
      const body = await response.text();
      if (!response.ok || Buffer.byteLength(body) > MAX_BUNDLE_BYTES) throw new Error("untrusted registry response");
      const remote = JSON.parse(body);
      if (!verifyGrokSchemaBundle(remote, keys, now) || !trustedBundle(remote, source.checkpoint)) throw new Error("untrusted registry bundle");
      bundle = remote; bundleSource = "remote"; await writeCache(cacheFile, remote);
    } catch { diagnostic = "schema-registry-refresh-rejected"; }
  }
  const remoteById = new Map(bundle.schemas.map((schema) => [schema.id, schema]));
  const candidates = bundleSource === "built-in" ? bundle.schemas : [...bundle.schemas, ...BUILTIN_GROK_SCHEMA_BUNDLE.schemas.filter((schema) => !bundle.retiredSchemaIds?.includes(schema.id) && !remoteById.has(schema.id))];
  const schema = selectGrokSchema(candidates, capabilities);
  if (!schema) return { mode: "plain", capabilities, bundleSource, diagnostic: diagnostic ?? "no-compatible-schema" };
  if (schemaQuarantine.get(schema.id) === createHash("sha256").update(stableJson(schema)).digest("hex")) return { mode: "plain", capabilities, bundleSource, diagnostic: "schema-quarantined" };
  return { mode: "structured", capabilities, schema, bundleSource, diagnostic };
}
