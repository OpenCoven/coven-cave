/**
 * Grok Build's streaming protocol is deliberately treated as a compatibility
 * contract, not an invitation to guess at future event names.  The compiled
 * baseline below is restricted to the frames documented by xAI; a signed
 * registry can add a tool envelope only after a local capability probe has
 * established that the installed launcher advertises that protocol.
 */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
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

function optionStanza(help: string, option: string): string {
  return help.match(new RegExp(`^\\s*(?:-[A-Za-z],?\\s+)?${option}\\b[^\\n]*(?:\\n(?!\\s*(?:-[A-Za-z],?\\s+)?--)[^\\n]*){0,2}`, "im"))?.[0] ?? "";
}

function optionTakesValue(help: string, option: string): boolean {
  const stanza = optionStanza(help, option);
  if (!stanza) return false;
  const declaration = stanza.split(/\r?\n/, 1)[0].slice(stanza.indexOf(option) + option.length);
  return /(?:^|\s)(?:<[^>]+>|\[[^\]]+\]|[A-Z][A-Z_-]*)(?:\s|$)/.test(declaration)
    || /\[(?:string|number|boolean|array|count)\]/i.test(stanza);
}

export function grokRunCapabilitiesFromHelp(help: string, version: string | null = null): GrokRunCapabilities {
  const options = [...help.matchAll(/^\s*(--[a-z][a-z0-9-]*)\b/gim)].map((match) => match[1]);
  const unique = [...new Set(options)];
  const valueOptions = unique.filter((option) => optionTakesValue(help, option));
  return {
    version,
    // The protocol must be documented in the output option's own stanza;
    // a banner or another option mentioning JSON is not launch evidence.
    streamingJson: unique.includes("--output-format")
      && valueOptions.includes("--output-format")
      && /\bstreaming-json\b/i.test(optionStanza(help, "--output-format")),
    options: unique,
    valueOptions,
  };
}

/** Help/version probes never receive API keys or other secret-bearing vars. */
export function grokProbeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const probeEnv = { ...env };
  for (const key of Object.keys(probeEnv)) {
    if (/(?:key|token|secret|password|credential|auth(?:orization)?|cookie|proxy|^xai_|^grok_.*(?:auth|api))/i.test(key)) delete probeEnv[key];
  }
  return probeEnv;
}

function terminateGrokProbeTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (grace) clearTimeout(grace);
      resolve();
    };
    grace = setTimeout(finish, 1_000);
    child.once("close", () => { clearTimeout(grace); finish(); });
    try {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        killer.once("close", finish);
        killer.once("error", () => { try { child.kill("SIGTERM"); } catch { /* best effort */ } });
      } else if (child.pid) {
        // Probes use their own process group on POSIX so a shim cannot leave
        // a helper running after a capability timeout.
        process.kill(-child.pid, "SIGTERM");
      } else {
        child.kill("SIGTERM");
      }
    } catch { try { child.kill("SIGTERM"); } catch { /* already exited */ } }
  });
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
      const child = spawn(launch.command, [...launch.fixedArgs, ...args], {
        env: grokProbeEnvironment(env),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      }) as unknown as ChildProcessWithoutNullStreams;
      let overflowed = false;
      const append = (chunk: Buffer) => {
        if (output.length >= 64 * 1024) { overflowed = true; return; }
        output += chunk.toString().slice(0, 64 * 1024 - output.length);
        if (output.length >= 64 * 1024) overflowed = true;
      };
      child.stdout.on("data", append); child.stderr.on("data", append);
      const timer = setTimeout(() => { void terminateGrokProbeTree(child).finally(() => finish(null)); }, timeoutMs);
      child.once("error", () => { clearTimeout(timer); finish(null); });
      child.once("close", (code) => { clearTimeout(timer); finish(code === 0 && !overflowed ? output : null); });
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
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_WAIT_MS = 500;
const CACHE_LOCK_POLL_MS = 20;
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
  const errorValue = valueField(raw, fields.error);
  const isError = fields.errorStates.includes(stringField(raw, fields.state) ?? "")
    || errorValue === true
    || (typeof errorValue === "string" && errorValue.length > 0)
    || (isRecord(errorValue) && Object.keys(errorValue).length > 0);
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
  if (!Object.keys(value).every((key) => ["id", "priority", "requires", "eventTypes", "fields", "launch"].includes(key))) return false;
  if (!Object.keys(value.requires).every((key) => key === "streamingJson" || key === "options")) return false;
  if (!Object.keys(value.eventTypes).every((key) => ["ignored", "text", "end", "error", "toolStart", "toolProgress", "toolEnd", "toolComplete"].includes(key))) return false;
  if (!Object.keys(value.fields).every((key) => ["type", "text", "sessionId", "message", "usage", "totalCostUsd", "id", "name", "input", "output", "state", "error", "terminalStates", "errorStates"].includes(key))) return false;
  if (!Object.keys(value.launch).every((key) => key === "outputOption" || key === "outputValue")) return false;
  if (value.priority !== undefined && (typeof value.priority !== "number" || !Number.isSafeInteger(value.priority) || Math.abs(value.priority) > 1_000)) return false;
  if (value.requires.options !== undefined && !validOptions(value.requires.options)) return false;
  if (value.launch.outputOption !== "--output-format" || value.launch.outputValue !== "streaming-json") return false;
  const events = value.eventTypes;
  const eventGroups = [events.ignored, events.text, events.end, events.error, events.toolStart, events.toolProgress ?? [], events.toolEnd, events.toolComplete];
  if (!eventGroups.every((items) => validAliases(items, true))) return false;
  // A signed schema is still untrusted input: reject ambiguous event names and
  // incomplete tool envelopes before selection rather than quarantining only
  // after a real user's stream reaches the parser.
  if (new Set(eventGroups.flat()).size !== eventGroups.flat().length) return false;
  const f = value.fields;
  if (![f.type, f.text, f.sessionId, f.message, f.usage, f.totalCostUsd, f.id, f.name, f.input, f.output, f.state, f.error, f.terminalStates, f.errorStates].every((items) => validAliases(items, true))) return false;
  const typedEvents = events as GrokEventSchema["eventTypes"];
  const typedFields = f as GrokEventSchema["fields"];
  if (!typedFields.type.length) return false;
  if (typedEvents.text.length && !typedFields.text.length) return false;
  if ((typedEvents.toolStart.length || typedEvents.toolEnd.length || typedEvents.toolComplete.length || (typedEvents.toolProgress?.length ?? 0)) && !typedFields.id.length) return false;
  return !(typedEvents.toolStart.length || typedEvents.toolComplete.length) || typedFields.name.length > 0;
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
  if (value.signature !== undefined && (!isRecord(value.signature) || !Object.keys(value.signature).every((key) => key === "algorithm" || key === "value") || value.signature.algorithm !== "ed25519" || typeof value.signature.value !== "string")) return false;
  const ids = value.schemas.map((schema) => schema.id);
  return new Set(ids).size === ids.length;
}

export function verifyGrokSchemaBundle(value: unknown, publicKeys: string | GrokRegistryKeyring, now = Date.now()): value is GrokSchemaBundle {
  if (!isGrokSchemaBundle(value, now) || !value.signature) return false;
  const keys = typeof publicKeys === "string" ? { legacy: publicKeys } : publicKeys;
  if (Object.keys(keys).length > 1 && value.keyId === undefined) return false;
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
  const valueOptions = new Set(capabilities.valueOptions);
  const matches = schemas.filter((schema) =>
    (schema.requires.options?.every((option) => options.has(option)) ?? true)
    && options.has(schema.launch.outputOption)
    && valueOptions.has(schema.launch.outputOption),
  );
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
type TrustAnchor = { sequence: number; payloadHash: string };

function configuredGrokRegistrySource(): RegistrySource {
  const url = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_URL || process.env.COVEN_GROK_SCHEMA_REGISTRY_URL;
  const single = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEY || process.env.COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEY;
  const rawKeyring = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS || process.env.COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS;
  const rawCheckpoint = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT || process.env.COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT;
  let publicKeys: GrokRegistryKeyring | undefined;
  let checkpoint: GrokRegistryCheckpoint | undefined;
  try { publicKeys = rawKeyring ? JSON.parse(rawKeyring) : single ? { legacy: single } : undefined; } catch { /* invalid config fails closed */ }
  try { checkpoint = rawCheckpoint ? JSON.parse(rawCheckpoint) : undefined; } catch { /* invalid config fails closed */ }
  try {
    const parsed = url ? new URL(url) : null;
    if (parsed && (parsed.protocol !== "https:" || parsed.username || parsed.password)) return {};
  } catch { return {}; }
  if (!checkpoint || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 1 || !/^[a-f0-9]{64}$/.test(checkpoint.payloadHash)) return {};
  return { url, publicKeys, checkpoint };
}

function defaultCachePath(): string {
  return path.join(process.env.COVEN_CAVE_HOME || path.join(process.env.COVEN_HOME || homedir(), ".coven", "cave"), "grok-schema-bundle-v1.json");
}

function trustAnchorPath(file: string): string { return `${file}.anchor`; }
function cacheLockPath(file: string): string { return `${file}.lock`; }

function validTrustAnchor(value: unknown): value is TrustAnchor {
  return isRecord(value) && Object.keys(value).length === 2 && typeof value.sequence === "number" && Number.isSafeInteger(value.sequence) && value.sequence >= 1 && typeof value.payloadHash === "string" && /^[a-f0-9]{64}$/.test(value.payloadHash);
}

function isSafeRegistryUrl(value: string | undefined): value is string {
  try {
    const parsed = value ? new URL(value) : null;
    return !!parsed && parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch { return false; }
}

async function readBoundedRegistryBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BUNDLE_BYTES)) throw new Error("oversized registry response");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BUNDLE_BYTES) throw new Error("oversized registry response");
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function readTrustAnchor(file: string): Promise<TrustAnchor | null> {
  try {
    const raw = await fs.readFile(trustAnchorPath(file), "utf8");
    if (Buffer.byteLength(raw) > 1024) return null;
    const anchor = JSON.parse(raw);
    return validTrustAnchor(anchor) ? anchor : null;
  } catch { return null; }
}

async function cacheRecordExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

function meetsTrustAnchor(bundle: GrokSchemaBundle, anchor: TrustAnchor | null): boolean {
  return !anchor || bundle.sequence > anchor.sequence || (bundle.sequence === anchor.sequence && grokSchemaBundlePayloadHash(bundle) === anchor.payloadHash);
}

async function readCache(file: string, keys: GrokRegistryKeyring, now: number, anchor: TrustAnchor | null): Promise<Cached | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    if (Buffer.byteLength(raw) > MAX_CACHE_BYTES) return null;
    const cached = JSON.parse(raw) as Cached;
    return isRecord(cached) && Object.keys(cached).length === 2 && Number.isSafeInteger(cached.checkedAt)
      && verifyGrokSchemaBundle(cached.bundle, keys, now) && meetsTrustAnchor(cached.bundle, anchor)
      ? cached
      : null;
  } catch { return null; }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<boolean> {
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, file);
    return true;
  } catch { return false; /* Cache is an optimization; a failed write never broadens parsing. */ }
}

type CacheLock = {
  owns: () => Promise<boolean>;
  release: () => Promise<void>;
};

async function acquireCacheLock(file: string): Promise<CacheLock | null> {
  const lock = cacheLockPath(file);
  const deadline = Date.now() + CACHE_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const handle = await fs.open(lock, "wx", 0o600);
      const token = `${process.pid}:${randomBytes(8).toString("hex")}`;
      await handle.writeFile(token);
      await handle.close();
      const owns = async () => {
        try { return await fs.readFile(lock, "utf8") === token; } catch { return false; }
      };
      return {
        owns,
        // A stale-lock taker may install its own lock before this writer
        // resumes. Never let the former owner remove that newer lock.
        release: async () => { if (await owns()) await fs.rm(lock, { force: true }); },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
      try {
        const stat = await fs.stat(lock);
        if (Date.now() - stat.mtimeMs > CACHE_LOCK_STALE_MS) await fs.rm(lock, { force: true });
      } catch { /* another writer released or replaced the lock */ }
      await new Promise((resolve) => setTimeout(resolve, CACHE_LOCK_POLL_MS));
    }
  }
  return null;
}

/** Returns false when another process has already committed a newer anchor. */
async function writeCache(file: string, bundle: GrokSchemaBundle, checkedAt = Date.now()): Promise<boolean> {
  const lock = await acquireCacheLock(file);
  if (!lock) return false;
  try {
    if (!await lock.owns()) return false;
    if (!meetsTrustAnchor(bundle, await readTrustAnchor(file))) return false;
  // Anchor first: an interruption can make the cache unavailable, never make
  // an older cache appear acceptable after a newer bundle was trusted.
    if (!await writeJsonAtomic(trustAnchorPath(file), { sequence: bundle.sequence, payloadHash: grokSchemaBundlePayloadHash(bundle) })) return false;
    if (!await lock.owns()) return false;
    return writeJsonAtomic(file, { checkedAt, bundle });
  } finally { await lock.release(); }
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
  const anchor = Object.keys(keys).length ? await readTrustAnchor(cacheFile) : null;
  // A verified remote cache without its matching high-water anchor is not a
  // valid offline contract. Treat it as a trust failure rather than allowing
  // a lower signed response to establish a new history after the anchor was
  // deleted or corrupted.
  const cacheAnchorMissing = Object.keys(keys).length > 0 && !anchor && await cacheRecordExists(cacheFile);
  const cached = Object.keys(keys).length && !cacheAnchorMissing ? await readCache(cacheFile, keys, now, anchor) : null;
  if (cached && trustedBundle(cached.bundle, source.checkpoint)) { bundle = cached.bundle; bundleSource = "cache"; }
  const cacheFresh = !!cached && trustedBundle(cached.bundle, source.checkpoint)
    && now - cached.checkedAt >= 0 && now - cached.checkedAt < CACHE_TTL_MS;
  if (cacheAnchorMissing) {
    diagnostic = "cached-schema-unavailable";
  } else if (source.url && Object.keys(keys).length && !cacheFresh) {
    try {
      if (!isSafeRegistryUrl(source.url)) throw new Error("unsafe registry URL");
      const response = await (source.fetch ?? fetch)(source.url, { signal: AbortSignal.timeout(5_000), credentials: "omit", redirect: "error" });
      const body = await readBoundedRegistryBody(response);
      if (!response.ok) throw new Error("untrusted registry response");
      const remote = JSON.parse(body);
      if (!verifyGrokSchemaBundle(remote, keys, now) || !trustedBundle(remote, source.checkpoint) || !meetsTrustAnchor(remote, anchor)) throw new Error("untrusted registry bundle");
      if (await writeCache(cacheFile, remote, now)) {
        bundle = remote; bundleSource = "remote";
      } else {
        const currentAnchor = await readTrustAnchor(cacheFile);
        const currentCache = await readCache(cacheFile, keys, now, currentAnchor);
        if (!currentCache || !trustedBundle(currentCache.bundle, source.checkpoint)) throw new Error("registry cache write rejected");
        bundle = currentCache.bundle; bundleSource = "cache"; diagnostic = "schema-registry-refresh-rejected";
      }
    } catch {
      // `writeCache` commits the high-water anchor before its cache record.
      // If the process loses the cache write after that point, the bundle that
      // was read before the refresh is now below the durable anchor and cannot
      // remain selected for this turn.
      const currentAnchor = await readTrustAnchor(cacheFile);
      if (bundleSource !== "built-in" && !meetsTrustAnchor(bundle, currentAnchor)) {
        bundle = BUILTIN_GROK_SCHEMA_BUNDLE;
        bundleSource = "built-in";
      }
      diagnostic = "schema-registry-refresh-rejected";
    }
  }
  const remoteById = new Map(bundle.schemas.map((schema) => [schema.id, schema]));
  const candidates = bundleSource === "built-in" ? bundle.schemas : [...bundle.schemas, ...BUILTIN_GROK_SCHEMA_BUNDLE.schemas.filter((schema) => !bundle.retiredSchemaIds?.includes(schema.id) && !remoteById.has(schema.id))];
  const schema = selectGrokSchema(candidates, capabilities);
  if (!schema) return { mode: "plain", capabilities, bundleSource, diagnostic: diagnostic ?? "no-compatible-schema" };
  if (schemaQuarantine.get(schema.id) === createHash("sha256").update(stableJson(schema)).digest("hex")) return { mode: "plain", capabilities, bundleSource, diagnostic: "schema-quarantined" };
  return { mode: "structured", capabilities, schema, bundleSource, diagnostic };
}
