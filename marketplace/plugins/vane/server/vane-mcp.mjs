#!/usr/bin/env node
/**
 * Vane MCP server — a zero-dependency stdio bridge to a self-hosted Vane
 * (formerly Perplexica) instance. Speaks newline-delimited JSON-RPC 2.0 on
 * stdin/stdout: initialize, notifications/initialized, ping, tools/list,
 * tools/call. Everything diagnostic goes to stderr so stdout stays protocol.
 *
 * Configuration (environment):
 *   VANE_URL                     base URL of the Vane instance (default http://127.0.0.1:3030)
 *   VANE_TIMEOUT_MS              per-request timeout (default 120000)
 *   VANE_ALLOW_REMOTE=1          permit a non-loopback VANE_URL (queries leave the machine
 *                                through that instance's SearXNG, so this is explicit opt-in)
 *   VANE_CHAT_PROVIDER_ID        pin the chat provider (uuid from GET /api/providers)
 *   VANE_CHAT_MODEL              pin the chat model key
 *   VANE_EMBEDDING_PROVIDER_ID   pin the embedding provider (uuid)
 *   VANE_EMBEDDING_MODEL         pin the embedding model key
 * Without pins the first provider exposing a chat model and the first exposing
 * an embedding model are used; the lookup is cached for the process lifetime.
 */

import { createInterface } from "node:readline";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SERVER_NAME = "vane-mcp";
export const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_VANE_URL = "http://127.0.0.1:3030";
const DEFAULT_TIMEOUT_MS = 120_000;
export const DOCKER_HINT =
  "docker run -d -p 127.0.0.1:3030:3000 -v vane-data:/home/vane/data --name vane itzcrazykns1337/vane:latest";
export const SEARCH_SOURCES = ["web", "academic", "discussions"];
export const OPTIMIZATION_MODES = ["speed", "balanced", "quality"];
const SNIPPET_MAX_CHARS = 200;
const BODY_PREVIEW_CHARS = 240;

class ToolError extends Error {}

/** True for hosts that only ever resolve to this machine. */
export function isLoopbackHost(hostname) {
  const host = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1") return true;
  const v4 = host.startsWith("::ffff:") ? host.slice(7) : host;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

function envText(env, key) {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Parse the process environment into a config object (or `{ error }`). */
export function readConfig(env = process.env) {
  const rawUrl = envText(env, "VANE_URL") ?? DEFAULT_VANE_URL;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: `VANE_URL is not a valid URL: ${JSON.stringify(rawUrl)}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: `VANE_URL must use http or https, got ${url.protocol}` };
  }
  const rawTimeout = envText(env, "VANE_TIMEOUT_MS");
  const parsedTimeout = rawTimeout === undefined ? NaN : Number(rawTimeout);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? Math.floor(parsedTimeout) : DEFAULT_TIMEOUT_MS;
  return {
    baseUrl: url.origin + url.pathname.replace(/\/+$/, ""),
    hostname: url.hostname,
    loopback: isLoopbackHost(url.hostname),
    allowRemote: envText(env, "VANE_ALLOW_REMOTE") === "1",
    timeoutMs,
    pinned: {
      chatProviderId: envText(env, "VANE_CHAT_PROVIDER_ID"),
      chatModel: envText(env, "VANE_CHAT_MODEL"),
      embeddingProviderId: envText(env, "VANE_EMBEDDING_PROVIDER_ID"),
      embeddingModel: envText(env, "VANE_EMBEDDING_MODEL"),
    },
  };
}

function describeError(error) {
  const cause = error && typeof error === "object" ? error.cause : undefined;
  if (cause && typeof cause === "object" && typeof cause.code === "string") return cause.code;
  if (error && typeof error === "object" && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.message : String(error);
}

function preview(text) {
  const collapsed = String(text ?? "").replace(/\s+/g, " ").trim();
  return collapsed.length > BODY_PREVIEW_CHARS ? `${collapsed.slice(0, BODY_PREVIEW_CHARS)}…` : collapsed;
}

async function vaneRequest(config, route, init = {}) {
  const url = `${config.baseUrl}${route}`;
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const name = error && typeof error === "object" ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ToolError(
        `Vane did not answer ${route} within ${config.timeoutMs} ms. Raise VANE_TIMEOUT_MS or use mode "speed".`,
      );
    }
    throw new ToolError(
      [
        `Vane is unreachable at ${config.baseUrl} (${describeError(error)}).`,
        "Start it with docker:",
        `  ${DOCKER_HINT}`,
        `then open ${config.baseUrl} in a browser and configure a provider.`,
      ].join("\n"),
    );
  }
  const text = await response.text();
  if (!response.ok) {
    const detail = preview(text);
    throw new ToolError(`Vane returned HTTP ${response.status} for ${route}${detail ? `: ${detail}` : ""}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolError(`Vane returned a non-JSON response for ${route}: ${preview(text) || "(empty body)"}`);
  }
}

function normalizeModels(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((model) => model && typeof model === "object" && typeof model.key === "string" && model.key.length > 0)
    .map((model) => ({ key: model.key, name: typeof model.name === "string" && model.name ? model.name : model.key }));
}

async function listProviders(config) {
  const data = await vaneRequest(config, "/api/providers");
  const providers = data && typeof data === "object" && Array.isArray(data.providers) ? data.providers : [];
  return providers
    .filter((provider) => provider && typeof provider === "object" && typeof provider.id === "string")
    .map((provider) => ({
      id: provider.id,
      name: typeof provider.name === "string" && provider.name ? provider.name : provider.id,
      chatModels: normalizeModels(provider.chatModels),
      embeddingModels: normalizeModels(provider.embeddingModels),
    }));
}

function noProvidersError(config) {
  return new ToolError(
    `No providers configured in Vane at ${config.baseUrl}. Open it in a browser, add a provider with a chat model and an embedding model under Settings, then retry.`,
  );
}

function pickModel(providers, kind, pinnedProviderId, pinnedKey) {
  const listKey = kind === "chat" ? "chatModels" : "embeddingModels";
  let provider;
  if (pinnedProviderId) {
    provider = providers.find((candidate) => candidate.id === pinnedProviderId);
    if (!provider) {
      const known = providers.map((candidate) => `${candidate.name} (${candidate.id})`).join(", ") || "none";
      throw new ToolError(`Pinned ${kind} provider ${pinnedProviderId} is not configured in Vane. Known providers: ${known}.`);
    }
  } else {
    provider = providers.find((candidate) => candidate[listKey].length > 0);
    if (!provider) {
      throw new ToolError(
        `No Vane provider exposes a ${kind === "chat" ? "chat" : "embedding"} model. Add one under Settings in Vane, then retry.`,
      );
    }
  }
  const models = provider[listKey];
  if (pinnedKey) {
    if (models.length > 0 && !models.some((model) => model.key === pinnedKey)) {
      throw new ToolError(
        `Pinned ${kind} model "${pinnedKey}" is not offered by provider ${provider.name}. Available: ${models.map((model) => model.key).join(", ")}.`,
      );
    }
    return { providerId: provider.id, key: pinnedKey };
  }
  if (models.length === 0) {
    throw new ToolError(`Provider ${provider.name} exposes no ${kind} model in Vane.`);
  }
  return { providerId: provider.id, key: models[0].key };
}

let modelCache = null;

async function resolveModels(config) {
  if (modelCache) return modelCache;
  const pinned = config.pinned;
  if (pinned.chatProviderId && pinned.chatModel && pinned.embeddingProviderId && pinned.embeddingModel) {
    modelCache = {
      chatModel: { providerId: pinned.chatProviderId, key: pinned.chatModel },
      embeddingModel: { providerId: pinned.embeddingProviderId, key: pinned.embeddingModel },
    };
    return modelCache;
  }
  const providers = await listProviders(config);
  if (providers.length === 0) throw noProvidersError(config);
  const resolved = {
    chatModel: pickModel(providers, "chat", pinned.chatProviderId, pinned.chatModel),
    embeddingModel: pickModel(providers, "embedding", pinned.embeddingProviderId, pinned.embeddingModel),
  };
  modelCache = resolved;
  return resolved;
}

function snippetOf(content) {
  const collapsed = String(content ?? "").replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_MAX_CHARS ? `${collapsed.slice(0, SNIPPET_MAX_CHARS - 1)}…` : collapsed;
}

/** Normalize Vane's `sources` array into `{ title, url, snippet }` rows. */
export function normalizeSources(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((source) => source && typeof source === "object")
    .map((source) => {
      const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
      const url = typeof metadata.url === "string" ? metadata.url.trim() : "";
      const title = typeof metadata.title === "string" && metadata.title.trim() ? metadata.title.trim() : url || "Untitled source";
      return { title, url, snippet: snippetOf(source.content) };
    });
}

/** Render the answer plus a numbered Sources list for the text content block. */
export function formatSearchResult(message, sources) {
  const lines = [message && message.trim() ? message.trim() : "(Vane returned no answer text.)", ""];
  if (sources.length === 0) {
    lines.push("Sources: none returned.");
  } else {
    lines.push("Sources:");
    sources.forEach((source, index) => {
      lines.push(`${index + 1}. ${source.title}${source.url ? ` — ${source.url}` : ""}`);
      if (source.snippet) lines.push(`   ${source.snippet}`);
    });
  }
  return lines.join("\n");
}

function requireLoopbackOrOptIn(config) {
  if (config.error) throw new ToolError(config.error);
  if (!config.loopback && !config.allowRemote) {
    throw new ToolError(
      `Refusing to query the non-loopback Vane URL ${config.baseUrl}: every query is forwarded to public search engines through that instance's SearXNG. Set VANE_ALLOW_REMOTE=1 to opt in explicitly.`,
    );
  }
}

function parseHistory(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ToolError('history must be an array of ["human" | "assistant", text] pairs');
  return value.map((turn, index) => {
    if (!Array.isArray(turn) || turn.length !== 2 || typeof turn[0] !== "string" || typeof turn[1] !== "string") {
      throw new ToolError(`history[${index}] must be a ["human" | "assistant", text] pair`);
    }
    const role = turn[0].trim().toLowerCase();
    if (role !== "human" && role !== "assistant") {
      throw new ToolError(`history[${index}] role must be "human" or "assistant", got ${JSON.stringify(turn[0])}`);
    }
    return [role, turn[1]];
  });
}

function parseSources(value) {
  if (value === undefined || value === null) return ["web"];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolError(`sources must be a non-empty array drawn from ${SEARCH_SOURCES.join(", ")}`);
  }
  const unique = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !SEARCH_SOURCES.includes(entry)) {
      throw new ToolError(`Unknown source ${JSON.stringify(entry)}; expected one of ${SEARCH_SOURCES.join(", ")}`);
    }
    if (!unique.includes(entry)) unique.push(entry);
  }
  return unique;
}

async function vaneSearch(config, args) {
  requireLoopbackOrOptIn(config);
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new ToolError("query must be a non-empty string");
  const sources = parseSources(args.sources);
  const mode = args.mode === undefined || args.mode === null ? "speed" : args.mode;
  if (typeof mode !== "string" || !OPTIMIZATION_MODES.includes(mode)) {
    throw new ToolError(`mode must be one of ${OPTIMIZATION_MODES.join(", ")}`);
  }
  if (args.systemInstructions !== undefined && args.systemInstructions !== null && typeof args.systemInstructions !== "string") {
    throw new ToolError("systemInstructions must be a string");
  }
  const history = parseHistory(args.history);
  const models = await resolveModels(config);
  const body = {
    chatModel: models.chatModel,
    embeddingModel: models.embeddingModel,
    optimizationMode: mode,
    sources,
    query,
    stream: false,
    ...(history && history.length > 0 ? { history } : {}),
    ...(typeof args.systemInstructions === "string" && args.systemInstructions.trim()
      ? { systemInstructions: args.systemInstructions }
      : {}),
  };
  const data = await vaneRequest(config, "/api/search", { method: "POST", body: JSON.stringify(body) });
  const message = data && typeof data === "object" && typeof data.message === "string" ? data.message : "";
  const normalized = normalizeSources(data && typeof data === "object" ? data.sources : []);
  return {
    content: [{ type: "text", text: formatSearchResult(message, normalized) }],
    structuredContent: { query, sources: normalized, message, mode, searched: sources },
  };
}

async function vaneProviders(config) {
  requireLoopbackOrOptIn(config);
  const providers = await listProviders(config);
  if (providers.length === 0) throw noProvidersError(config);
  const lines = [`Vane providers at ${config.baseUrl}:`];
  providers.forEach((provider, index) => {
    lines.push(`${index + 1}. ${provider.name} (id: ${provider.id})`);
    lines.push(`   chat: ${provider.chatModels.map((model) => model.key).join(", ") || "none"}`);
    lines.push(`   embedding: ${provider.embeddingModels.map((model) => model.key).join(", ") || "none"}`);
  });
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { providers },
  };
}

export const TOOLS = [
  {
    name: "vane_search",
    description:
      "Ask a self-hosted Vane instance a question. Returns Vane's synthesized answer plus the numbered web sources it drew on. Treat the answer as a lead and verify the cited URLs before relying on it.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question or search query." },
        sources: {
          type: "array",
          items: { type: "string", enum: SEARCH_SOURCES },
          default: ["web"],
          description: 'Which Vane source groups to search: "web", "academic", and/or "discussions".',
        },
        mode: {
          type: "string",
          enum: OPTIMIZATION_MODES,
          default: "speed",
          description: 'Vane optimization mode: "speed" (fast), "balanced", or "quality" (slow, thorough).',
        },
        systemInstructions: {
          type: "string",
          description: "Optional extra instructions for Vane's answer synthesis (format, focus, language).",
        },
        history: {
          type: "array",
          items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
          description: 'Optional prior turns as ["human" | "assistant", text] pairs for follow-up questions.',
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "vane_providers",
    description:
      "List the model providers configured in the Vane instance with their chat and embedding model keys. Use it to choose values for VANE_CHAT_MODEL / VANE_EMBEDDING_MODEL pins.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const HANDLERS = {
  vane_search: vaneSearch,
  vane_providers: vaneProviders,
};

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function createDispatcher(config, { log = () => {} } = {}) {
  async function callTool(id, params) {
    const name = params && typeof params === "object" && typeof params.name === "string" ? params.name : "";
    const handler = HANDLERS[name];
    if (!handler) return rpcError(id, -32602, `Unknown tool: ${name || "(missing name)"}`);
    const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
      ? params.arguments
      : {};
    try {
      return rpcResult(id, await handler(config, args));
    } catch (error) {
      if (error instanceof ToolError) {
        return rpcResult(id, { content: [{ type: "text", text: error.message }], isError: true });
      }
      log(`tool ${name} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      return rpcResult(id, {
        content: [{ type: "text", text: `Unexpected error in ${name}: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      });
    }
  }

  /** Handle one parsed JSON-RPC message. Resolves to a response, or null for notifications. */
  return async function dispatch(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return rpcError(null, -32600, "Invalid Request");
    }
    const { id, method, params } = message;
    if (typeof method !== "string") {
      // A response to something we never sent, or garbage: nothing to answer.
      return id === undefined ? null : rpcError(id, -32600, "Invalid Request");
    }
    if (id === undefined || id === null) {
      // Notifications never get a reply; initialized/cancelled/progress are all fine to ignore.
      return null;
    }
    switch (method) {
      case "initialize": {
        const requested = params && typeof params === "object" && typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : PROTOCOL_VERSION;
        return rpcResult(id, {
          protocolVersion: requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            "vane_search answers questions through a self-hosted Vane instance and returns cited sources. Treat the synthesized answer as a lead; cite and verify the returned URLs.",
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      case "tools/call":
        return callTool(id, params);
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  };
}

export function main({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  const log = (line) => process.stderr.write(`[${SERVER_NAME}] ${line}\n`);
  const config = readConfig(env);
  if (config.error) log(config.error);
  else if (!config.loopback && !config.allowRemote) log(`non-loopback VANE_URL ${config.baseUrl}; tool calls refuse until VANE_ALLOW_REMOTE=1`);
  const dispatch = createDispatcher(config, { log });
  const send = (message) => {
    output.write(`${JSON.stringify(message)}\n`);
  };
  // Serialize handling so responses leave in request order even when a tool
  // call awaits the network; MCP clients correlate by id, but ordered output
  // keeps logs readable and avoids interleaving partial writes.
  let chain = Promise.resolve();
  const handle = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      send(rpcError(null, -32700, "Parse error"));
      return;
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const responses = [];
    for (const message of messages) {
      const response = await dispatch(message);
      if (response) responses.push(response);
    }
    if (Array.isArray(parsed)) {
      if (responses.length > 0) send(responses);
    } else if (responses.length > 0) {
      send(responses[0]);
    }
  };
  const reader = createInterface({ input, crlfDelay: Infinity });
  reader.on("line", (line) => {
    chain = chain.then(() => handle(line)).catch((error) => log(`unhandled: ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
  });
  reader.on("close", () => {
    chain.finally(() => process.exit(0));
  });
  return { dispatch, config };
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (invokedDirectly) main();
