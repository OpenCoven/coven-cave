// What a local inference server can run for Codex local mode (#6049).
//
// Each probe asks the server itself: Ollama through /api/version, /api/tags
// and /api/show, LM Studio through /api/v0/models. A model counts only when the
// server reports it as a chat model with tool support, because Codex's agent
// loop works through tool calls. Nothing here starts, stops or downloads
// anything; it reads, with short timeouts and a short cache, so a stopped
// server cannot stall a chat turn.
//
// Endpoints default to this machine. An address comes from the backend's
// environment variable, then from Settings → Local models, then from the
// backend default. A server on another computer is refused unless Settings or
// CAVE_LOCAL_MODELS_ALLOW_REMOTE=1 allows it: "local" must not quietly send
// prompts across the network.

import {
  LOCAL_CODEX_BACKENDS,
  localCodexBackendInfo,
  localCodexConfigArgs,
  localCodexNativeModel,
  type LocalCodexBackend,
  type LocalCodexBackendInfo,
  type LocalModelsBackendStatus,
  type LocalModelsStatus,
  type LocalSettingSource,
} from "../local-codex.ts";
import {
  EMPTY_LOCAL_MODEL_SETTINGS,
  readLocalModelSettings,
  type LocalModelSettings,
} from "./local-models-settings.ts";

export type { LocalSettingSource };

export const LOCAL_MODELS_ALLOW_REMOTE_ENV = "CAVE_LOCAL_MODELS_ALLOW_REMOTE";

type Env = Readonly<Record<string, string | undefined>>;
const REQUEST_TIMEOUT_MS = 2_500;
const MAX_MODELS = 50;
const SHOW_CONCURRENCY = 3;
const CACHE_TTL_MS = 15_000;
const FAILURE_TTL_MS = 3_000;

export type LocalEndpointResolution =
  | { ok: true; endpoint: string; isDefault: boolean; source: LocalSettingSource }
  | { ok: false; reason: string; source: LocalSettingSource };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Whether a server on another computer is allowed, and who allowed it. */
export function localModelsAllowRemote(
  env: Env = process.env,
  settings: LocalModelSettings = EMPTY_LOCAL_MODEL_SETTINGS,
): { value: boolean; source: LocalSettingSource } {
  if (env[LOCAL_MODELS_ALLOW_REMOTE_ENV] === "1") return { value: true, source: "environment" };
  if (settings.allowRemote) return { value: true, source: "settings" };
  return { value: false, source: "default" };
}

/**
 * Validate one base URL for a backend. `subject` names the value in the
 * message: the environment variable, the saved address, or the field being
 * saved.
 */
export function parseLocalEndpoint(
  info: LocalCodexBackendInfo,
  raw: string,
  options: { allowRemote: boolean; subject: string },
): { ok: true; endpoint: string; isDefault: boolean } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: `${options.subject} isn't a URL. Use a base URL such as ${info.defaultEndpoint}.` };
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
    (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { ok: false, reason: `${options.subject} must be a plain http(s) base URL with no path, credentials or query, such as ${info.defaultEndpoint}.` };
  }
  // `origin` is the normalized scheme, host and port: no quotes or spaces,
  // so it is safe inside Codex's `key="value"` overrides.
  const endpoint = url.origin;
  if (!LOOPBACK_HOSTS.has(url.hostname) && !options.allowRemote) {
    return {
      ok: false,
      reason: `${options.subject} points at ${url.host}, which isn't this computer. To send prompts to a ${info.product} server there, turn on “Allow servers on other computers” in Settings → Local models, or set ${LOCAL_MODELS_ALLOW_REMOTE_ENV}=1.`,
    };
  }
  return { ok: true, endpoint, isDefault: endpoint === info.defaultEndpoint };
}

/** The server's base URL: its environment override, then the saved Settings address, then the backend default. */
export function resolveLocalCodexEndpoint(
  info: LocalCodexBackendInfo,
  env: Env = process.env,
  settings: LocalModelSettings = EMPTY_LOCAL_MODEL_SETTINGS,
): LocalEndpointResolution {
  const allowRemote = localModelsAllowRemote(env, settings).value;
  const fromEnvironment = env[info.endpointEnv]?.trim();
  if (fromEnvironment) {
    return { ...parseLocalEndpoint(info, fromEnvironment, { allowRemote, subject: info.endpointEnv }), source: "environment" };
  }
  const saved = settings.endpoints[info.backend];
  if (saved) {
    return { ...parseLocalEndpoint(info, saved, { allowRemote, subject: `The saved ${info.product} address` }), source: "settings" };
  }
  return { ok: true, endpoint: info.defaultEndpoint, isDefault: true, source: "default" };
}

export type LocalModel = {
  /** The server's own model name, as Codex receives it. */
  name: string;
  /** The server reports tool-calling support for this model. */
  tools: boolean;
  contextLength: number | null;
};

export type LocalBackendProbe =
  | { kind: "available"; endpoint: string; version: string | null; models: LocalModel[] }
  | { kind: "unreachable"; endpoint: string }
  | { kind: "invalid-response"; endpoint: string }
  | { kind: "invalid-endpoint"; reason: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

class ProbeError extends Error {
  readonly kind: "unreachable" | "invalid-response";
  constructor(kind: "unreachable" | "invalid-response") {
    super(kind);
    this.kind = kind;
  }
}

async function getJson(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new ProbeError("unreachable");
  }
  if (!response.ok) throw new ProbeError("invalid-response");
  try {
    return await response.json();
  } catch {
    throw new ProbeError("invalid-response");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelName(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,199}$/.test(value) && !value.includes("..") ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function probeOllama(endpoint: string, fetchImpl: FetchLike): Promise<LocalBackendProbe> {
  const version = await getJson(fetchImpl, `${endpoint}/api/version`);
  const tags = await getJson(fetchImpl, `${endpoint}/api/tags`);
  if (!record(tags) || !Array.isArray(tags.models)) throw new ProbeError("invalid-response");
  const names = tags.models.map((entry) => modelName(record(entry) ? entry.name : null)).filter((name): name is string => name !== null).slice(0, MAX_MODELS);
  const models: LocalModel[] = [];
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++];
      try {
        const show = await getJson(fetchImpl, `${endpoint}/api/show`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: name }),
        });
        if (!record(show)) continue;
        const capabilities = Array.isArray(show.capabilities) ? show.capabilities : [];
        // Embedding models and anything else that cannot chat are not choices.
        if (!capabilities.includes("completion")) continue;
        const info = record(show.model_info) ? show.model_info : {};
        const contextKey = Object.keys(info).find((key) => key.endsWith(".context_length"));
        models.push({ name, tools: capabilities.includes("tools"), contextLength: contextKey ? positiveInt(info[contextKey]) : null });
      } catch (error) {
        if (error instanceof ProbeError && error.kind === "unreachable") throw error;
        // One model the server cannot describe is left out, not guessed at.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHOW_CONCURRENCY, names.length) }, worker));
  models.sort((a, b) => a.name.localeCompare(b.name));
  return {
    kind: "available",
    endpoint,
    version: record(version) && typeof version.version === "string" && version.version.length <= 40 ? version.version : null,
    models,
  };
}

async function probeLmStudio(endpoint: string, fetchImpl: FetchLike): Promise<LocalBackendProbe> {
  const listing = await getJson(fetchImpl, `${endpoint}/api/v0/models`);
  if (!record(listing) || !Array.isArray(listing.data)) throw new ProbeError("invalid-response");
  const models: LocalModel[] = [];
  for (const entry of listing.data.slice(0, MAX_MODELS)) {
    if (!record(entry)) continue;
    const name = modelName(entry.id);
    // Embedding models cannot chat; `vlm` models can.
    if (!name || (entry.type !== "llm" && entry.type !== "vlm")) continue;
    const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : [];
    models.push({ name, tools: capabilities.includes("tool_use"), contextLength: positiveInt(entry.max_context_length) });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return { kind: "available", endpoint, version: null, models };
}

type CacheEntry = { at: number; ttl: number; promise: Promise<LocalBackendProbe> };
const cache = new Map<string, CacheEntry>();

/** Forget cached probes; tests and an explicit "check again" use this. */
export function clearLocalCodexProbeCache(): void {
  cache.clear();
}

/** Probe one backend, cached briefly per endpoint so a chat turn and a model menu share one read. */
export async function probeLocalCodexBackend(
  info: LocalCodexBackendInfo,
  options: { env?: Env; settings?: LocalModelSettings; fetchImpl?: FetchLike; now?: () => number; fresh?: boolean } = {},
): Promise<LocalBackendProbe> {
  const settings = options.settings ?? await readLocalModelSettings();
  const resolution = resolveLocalCodexEndpoint(info, options.env, settings);
  if (!resolution.ok) return { kind: "invalid-endpoint", reason: resolution.reason };
  const now = options.now ?? Date.now;
  const key = `${info.backend}\0${resolution.endpoint}`;
  const cached = cache.get(key);
  if (!options.fresh && cached && now() - cached.at < cached.ttl) return cached.promise;
  const fetchImpl = options.fetchImpl ?? fetch;
  const entry: CacheEntry = {
    at: now(),
    ttl: CACHE_TTL_MS,
    promise: (info.backend === "ollama" ? probeOllama : probeLmStudio)(resolution.endpoint, fetchImpl).catch((error) => {
      entry.ttl = FAILURE_TTL_MS;
      return error instanceof ProbeError && error.kind === "invalid-response"
        ? { kind: "invalid-response" as const, endpoint: resolution.endpoint }
        : { kind: "unreachable" as const, endpoint: resolution.endpoint };
    }),
  };
  cache.set(key, entry);
  return entry.promise;
}

export type LocalCodexPreflight =
  | {
    ok: true;
    info: LocalCodexBackendInfo;
    endpoint: string;
    /** The backend's default endpoint, which Codex's built-in provider already targets. */
    isDefault: boolean;
    source: LocalSettingSource;
    version: string | null;
    /** The model name Codex receives. */
    nativeModel: string;
    /** `-c` overrides for both fresh and resumed turns. */
    configArgs: string[];
  }
  | { ok: false; code: LocalCodexFailureCode; message: string };

export type LocalCodexFailureCode =
  | "local_endpoint_invalid"
  | "local_server_unreachable"
  | "local_server_invalid"
  | "local_model_unselected"
  | "local_model_missing"
  | "local_model_no_tools";

/**
 * Whether this turn can run on the local server, and the exact Codex
 * overrides when it can. Every refusal names what to do next; none of them
 * falls back to a cloud model.
 */
export async function preflightLocalCodex(
  harness: string,
  modelId: string | null | undefined,
  options: { env?: Env; settings?: LocalModelSettings; fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<LocalCodexPreflight | null> {
  const info = localCodexBackendInfo(harness);
  if (!info) return null;
  const nativeModel = localCodexNativeModel(info, modelId);
  if (!nativeModel) {
    return {
      ok: false,
      code: "local_model_unselected",
      message: `Choose a model for ${info.label}. Local sessions run only the model you pick; Cave never substitutes a cloud model.`,
    };
  }
  const settings = options.settings ?? await readLocalModelSettings();
  const probe = await probeLocalCodexBackend(info, { ...options, settings });
  if (probe.kind === "invalid-endpoint") return { ok: false, code: "local_endpoint_invalid", message: probe.reason };
  if (probe.kind === "unreachable") {
    return { ok: false, code: "local_server_unreachable", message: `${info.product} isn't reachable at ${probe.endpoint}. ${info.startHint} Then send again.` };
  }
  if (probe.kind === "invalid-response") {
    return { ok: false, code: "local_server_invalid", message: `The server at ${probe.endpoint} didn't answer like ${info.product}. Check the address in Settings → Local models.` };
  }
  const model = probe.models.find((entry) => entry.name === nativeModel);
  if (!model) {
    return { ok: false, code: "local_model_missing", message: `${info.product} doesn't have ${nativeModel}. ${info.addModelHint} Or choose another model.` };
  }
  if (!model.tools) {
    return { ok: false, code: "local_model_no_tools", message: `${nativeModel} doesn't support tool calling, which Codex needs to work. Choose a model ${info.product} marks as tool-capable.` };
  }
  const resolution = resolveLocalCodexEndpoint(info, options.env, settings);
  const endpoint = resolution.ok ? resolution.endpoint : probe.endpoint;
  const isDefault = resolution.ok && resolution.isDefault;
  return {
    ok: true,
    info,
    endpoint,
    isDefault,
    source: resolution.source,
    version: probe.version,
    nativeModel,
    configArgs: localCodexConfigArgs(info, isDefault ? null : endpoint),
  };
}

/**
 * Point the spawned Codex at this session's server. Codex's built-in Ollama
 * and LM Studio providers read CODEX_OSS_BASE_URL, so a value inherited from
 * Cave's own environment would redirect even a default-endpoint session; it
 * is always cleared first. The direct transport names a custom endpoint with
 * `-c` overrides. Cave's adapter manifest for `coven run` is fixed, so that
 * transport takes a custom endpoint from the environment instead (Coven
 * passes it through to Codex; verified with Codex 0.163.0).
 */
export function applyLocalCodexSpawnEnv(
  env: Record<string, string | undefined>,
  target: { endpoint: string; isDefault: boolean },
  transport: "direct" | "coven",
): void {
  delete env.CODEX_OSS_BASE_URL;
  delete env.CODEX_OSS_PORT;
  if (transport === "coven" && !target.isDefault) env.CODEX_OSS_BASE_URL = `${target.endpoint}/v1`;
}

/** Everything Settings → Local models shows, read from both servers in parallel. */
export async function readLocalModelsStatus(options: {
  editable: boolean;
  env?: Env;
  settings?: LocalModelSettings;
  fetchImpl?: FetchLike;
  fresh?: boolean;
}): Promise<LocalModelsStatus> {
  const env = options.env ?? process.env;
  const settings = options.settings ?? await readLocalModelSettings();
  const backends = await Promise.all(Object.values(LOCAL_CODEX_BACKENDS).map(async (info): Promise<LocalModelsBackendStatus> => {
    const resolution = resolveLocalCodexEndpoint(info, env, settings);
    const probe = await probeLocalCodexBackend(info, { env, settings, fetchImpl: options.fetchImpl, fresh: options.fresh });
    return {
      backend: info.backend,
      harness: info.harness,
      product: info.product,
      label: info.label,
      defaultEndpoint: info.defaultEndpoint,
      endpointEnv: info.endpointEnv,
      startHint: info.startHint,
      addModelHint: info.addModelHint,
      endpoint: resolution.ok ? resolution.endpoint : null,
      source: resolution.source,
      savedEndpoint: settings.endpoints[info.backend] ?? null,
      server: probe.kind === "available"
        ? { state: "running", version: probe.version, models: probe.models.map(({ name, tools, contextLength }) => ({ name, tools, contextLength })) }
        : probe.kind === "unreachable" ? { state: "stopped" }
        : probe.kind === "invalid-response" ? { state: "unexpected" }
        : { state: "invalid-address", reason: probe.reason },
    };
  }));
  return { ok: true, editable: options.editable, allowRemote: localModelsAllowRemote(env, settings), backends };
}

/**
 * Apply a Settings change, validating every address against the permission
 * that will hold afterwards: turning remote servers off while an address
 * points at another computer is refused rather than leaving a broken saved
 * address behind.
 */
export function applyLocalModelsSettingsPatch(
  current: LocalModelSettings,
  patch: unknown,
  env: Env = process.env,
): { ok: true; settings: LocalModelSettings } | { ok: false; error: string; field?: string } {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return { ok: false, error: "Send an object with endpoints or allowRemote." };
  const record = patch as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => key !== "endpoints" && key !== "allowRemote");
  if (unknownKey) return { ok: false, error: `Unknown setting: ${unknownKey}.` };
  if (record.allowRemote !== undefined && typeof record.allowRemote !== "boolean") return { ok: false, error: "allowRemote must be true or false.", field: "allowRemote" };
  const allowRemote = typeof record.allowRemote === "boolean" ? record.allowRemote : current.allowRemote;
  const endpoints: Partial<Record<LocalCodexBackend, string>> = { ...current.endpoints };
  if (record.endpoints !== undefined) {
    if (typeof record.endpoints !== "object" || record.endpoints === null || Array.isArray(record.endpoints)) {
      return { ok: false, error: "endpoints must be an object.", field: "endpoints" };
    }
    for (const [backend, value] of Object.entries(record.endpoints as Record<string, unknown>)) {
      if (backend !== "ollama" && backend !== "lmstudio") return { ok: false, error: `Unknown backend: ${backend}.` };
      if (value === null || value === "") {
        delete endpoints[backend];
        continue;
      }
      if (typeof value !== "string" || value.length > 2_048) return { ok: false, error: "An address must be a URL.", field: backend };
      endpoints[backend] = value.trim();
    }
  }
  const remoteAllowed = env[LOCAL_MODELS_ALLOW_REMOTE_ENV] === "1" || allowRemote;
  for (const info of Object.values(LOCAL_CODEX_BACKENDS)) {
    const value = endpoints[info.backend];
    if (!value) continue;
    const parsed = parseLocalEndpoint(info, value, { allowRemote: remoteAllowed, subject: `The ${info.product} address` });
    if (!parsed.ok) return { ok: false, error: parsed.reason, field: info.backend };
    // Saving the default address is the same as using the default.
    if (parsed.isDefault) delete endpoints[info.backend];
    else endpoints[info.backend] = parsed.endpoint;
  }
  return { ok: true, settings: { endpoints, allowRemote } };
}
