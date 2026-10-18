// What a local inference server can run for Codex local mode (#6049).
//
// Each probe asks the server itself: Ollama through /api/version, /api/tags
// and /api/show, LM Studio through /api/v0/models. A model counts only when the
// server reports it as a chat model with tool support, because Codex's agent
// loop works through tool calls. Nothing here starts, stops or downloads
// anything; it reads, with short timeouts and a short cache, so a stopped
// server cannot stall a chat turn.
//
// Endpoints default to this machine. A remote endpoint is refused unless
// CAVE_LOCAL_MODELS_ALLOW_REMOTE=1 says otherwise: "local" must not quietly
// send prompts across the network.

import {
  localCodexBackendInfo,
  localCodexConfigArgs,
  localCodexNativeModel,
  type LocalCodexBackendInfo,
} from "../local-codex.ts";

export const LOCAL_MODELS_ALLOW_REMOTE_ENV = "CAVE_LOCAL_MODELS_ALLOW_REMOTE";

type Env = Readonly<Record<string, string | undefined>>;
const REQUEST_TIMEOUT_MS = 2_500;
const MAX_MODELS = 50;
const SHOW_CONCURRENCY = 3;
const CACHE_TTL_MS = 15_000;
const FAILURE_TTL_MS = 3_000;

export type LocalEndpointResolution =
  | { ok: true; endpoint: string; isDefault: boolean }
  | { ok: false; reason: string };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** The server's base URL from its environment override, or the backend default. */
export function resolveLocalCodexEndpoint(
  info: LocalCodexBackendInfo,
  env: Env = process.env,
): LocalEndpointResolution {
  const raw = env[info.endpointEnv]?.trim();
  if (!raw) return { ok: true, endpoint: info.defaultEndpoint, isDefault: true };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `${info.endpointEnv} is not a URL. Use a base URL such as ${info.defaultEndpoint}.` };
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
    (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { ok: false, reason: `${info.endpointEnv} must be a plain http(s) base URL with no path, credentials or query, such as ${info.defaultEndpoint}.` };
  }
  // `origin` is the normalized scheme, host and port: no quotes or spaces,
  // so it is safe inside Codex's `key="value"` overrides.
  const endpoint = url.origin;
  if (!LOOPBACK_HOSTS.has(url.hostname) && env[LOCAL_MODELS_ALLOW_REMOTE_ENV] !== "1") {
    return {
      ok: false,
      reason: `${info.endpointEnv} points at ${url.host}, which is not this machine. Set ${LOCAL_MODELS_ALLOW_REMOTE_ENV}=1 to send prompts to a remote ${info.product} server.`,
    };
  }
  return { ok: true, endpoint, isDefault: endpoint === info.defaultEndpoint };
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
  options: { env?: Env; fetchImpl?: FetchLike; now?: () => number; fresh?: boolean } = {},
): Promise<LocalBackendProbe> {
  const resolution = resolveLocalCodexEndpoint(info, options.env);
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
  options: { env?: Env; fetchImpl?: FetchLike; now?: () => number } = {},
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
  const probe = await probeLocalCodexBackend(info, options);
  if (probe.kind === "invalid-endpoint") return { ok: false, code: "local_endpoint_invalid", message: probe.reason };
  if (probe.kind === "unreachable") {
    return { ok: false, code: "local_server_unreachable", message: `${info.product} isn't reachable at ${probe.endpoint}. ${info.startHint} Then send again.` };
  }
  if (probe.kind === "invalid-response") {
    return { ok: false, code: "local_server_invalid", message: `The server at ${probe.endpoint} didn't answer like ${info.product}. Check ${info.endpointEnv}, or unset it to use ${info.defaultEndpoint}.` };
  }
  const model = probe.models.find((entry) => entry.name === nativeModel);
  if (!model) {
    return { ok: false, code: "local_model_missing", message: `${info.product} doesn't have ${nativeModel}. ${info.addModelHint} Or choose another model.` };
  }
  if (!model.tools) {
    return { ok: false, code: "local_model_no_tools", message: `${nativeModel} doesn't support tool calling, which Codex needs to work. Choose a model ${info.product} marks as tool-capable.` };
  }
  const resolution = resolveLocalCodexEndpoint(info, options.env);
  const endpoint = resolution.ok ? resolution.endpoint : probe.endpoint;
  return {
    ok: true,
    info,
    endpoint,
    version: probe.version,
    nativeModel,
    configArgs: localCodexConfigArgs(info, resolution.ok && resolution.isDefault ? null : endpoint),
  };
}
