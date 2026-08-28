import { createHash } from "node:crypto";
import net from "node:net";

import { canonicalJson } from "../research-protocol/digest.ts";
import { RESEARCH_LEXICAL_CHUNKER_VERSION } from "./research-resource-lexical-index.ts";

export const RESEARCH_EMBEDDING_ADAPTER_VERSION = "research-loopback-embeddings-v1";
export const RESEARCH_VECTOR_ENCODING_VERSION = "float32le-v1";
export const MAX_RESEARCH_EMBEDDING_INPUTS = 64;
export const MAX_RESEARCH_EMBEDDING_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_RESEARCH_EMBEDDING_RESPONSE_BYTES = 32 * 1024 * 1024;
export const MAX_RESEARCH_EMBEDDING_DIMENSIONS = 65_536;
export const DEFAULT_RESEARCH_EMBEDDING_TIMEOUT_MS = 30_000;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export type ResearchEmbeddingProtocol = "openai" | "ollama";

export type ResearchEmbeddingProviderConfig = {
  providerId: string;
  protocol: ResearchEmbeddingProtocol;
  endpoint: string;
  modelId: string;
  dimensions: number;
};

export type ValidatedResearchEmbeddingProviderConfig = ResearchEmbeddingProviderConfig & {
  endpoint: string;
  modelRevision: string;
};

export type ResearchEmbeddingAvailability =
  | { state: "unavailable"; code: ResearchEmbeddingUnavailableCode }
  | ({ state: "ready" } & ValidatedResearchEmbeddingProviderConfig);

export type ResearchEmbeddingUnavailableCode =
  | "not_configured"
  | "invalid_configuration"
  | "provider_offline";

export type ResearchEmbeddingFailureCode =
  | "aborted"
  | "provider_offline"
  | "provider_rejected"
  | "response_too_large"
  | "invalid_media_type"
  | "invalid_response";

export class ResearchEmbeddingProviderError extends Error {
  readonly code: ResearchEmbeddingFailureCode | "invalid_configuration" | "invalid_input";
  readonly disposition: "unavailable" | "failed";

  constructor(
    code: ResearchEmbeddingProviderError["code"],
    disposition: ResearchEmbeddingProviderError["disposition"],
    message: string,
  ) {
    super(message);
    this.name = "ResearchEmbeddingProviderError";
    this.code = code;
    this.disposition = disposition;
  }
}

export type ResearchEmbeddingRequestOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

function invalidConfiguration(message: string): never {
  throw new ResearchEmbeddingProviderError("invalid_configuration", "unavailable", message);
}

function invalidInput(message: string): never {
  throw new ResearchEmbeddingProviderError("invalid_input", "failed", message);
}

function validateId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) invalidConfiguration(`${label} is invalid`);
}

function validateModelId(value: string): void {
  if (!SAFE_MODEL_ID.test(value)) invalidConfiguration("model id is invalid");
}

function literalLoopback(hostname: string): boolean {
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (net.isIP(host) === 4) return host.split(".")[0] === "127";
  if (net.isIP(host) === 6) return host.toLowerCase() === "::1";
  return false;
}

function canonicalEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return invalidConfiguration("embedding endpoint must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    invalidConfiguration("embedding endpoint must use HTTP or HTTPS");
  }
  if (url.username || url.password) invalidConfiguration("embedding endpoint must not contain credentials");
  if (url.search || url.hash) invalidConfiguration("embedding endpoint must not contain a query or fragment");
  if (!literalLoopback(url.hostname)) {
    invalidConfiguration("embedding endpoint must use a literal loopback address");
  }
  if (url.pathname === "/") invalidConfiguration("embedding endpoint must name the embedding API path");
  return url.toString();
}

export function researchEmbeddingModelRevision(
  config: ResearchEmbeddingProviderConfig,
): string {
  const endpoint = canonicalEndpoint(config.endpoint);
  validateId(config.providerId, "provider id");
  validateModelId(config.modelId);
  if (config.protocol !== "openai" && config.protocol !== "ollama") {
    invalidConfiguration("embedding protocol is invalid");
  }
  if (!Number.isSafeInteger(config.dimensions)
      || config.dimensions < 1
      || config.dimensions > MAX_RESEARCH_EMBEDDING_DIMENSIONS) {
    invalidConfiguration("embedding dimensions are invalid");
  }
  return createHash("sha256").update(canonicalJson({
    adapterVersion: RESEARCH_EMBEDDING_ADAPTER_VERSION,
    protocol: config.protocol,
    providerId: config.providerId,
    endpoint,
    modelId: config.modelId,
    dimensions: config.dimensions,
    vectorEncodingVersion: RESEARCH_VECTOR_ENCODING_VERSION,
    lexicalChunkerVersion: RESEARCH_LEXICAL_CHUNKER_VERSION,
  })).digest("hex");
}

export function validateResearchEmbeddingProviderConfig(
  config: ResearchEmbeddingProviderConfig,
): ValidatedResearchEmbeddingProviderConfig {
  const endpoint = canonicalEndpoint(config.endpoint);
  const modelRevision = researchEmbeddingModelRevision({ ...config, endpoint });
  return { ...config, endpoint, modelRevision };
}

export function configuredResearchEmbeddingProvider(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ResearchEmbeddingAvailability {
  const providerId = environment.CAVE_RESEARCH_EMBEDDING_PROVIDER_ID?.trim();
  const protocol = environment.CAVE_RESEARCH_EMBEDDING_PROTOCOL?.trim();
  const endpoint = environment.CAVE_RESEARCH_EMBEDDING_ENDPOINT?.trim();
  const modelId = environment.CAVE_RESEARCH_EMBEDDING_MODEL_ID?.trim();
  const dimensionsText = environment.CAVE_RESEARCH_EMBEDDING_DIMENSIONS?.trim();
  if (!providerId && !protocol && !endpoint && !modelId && !dimensionsText) {
    return { state: "unavailable", code: "not_configured" };
  }
  if (!providerId || !protocol || !endpoint || !modelId || !dimensionsText) {
    return { state: "unavailable", code: "invalid_configuration" };
  }
  const dimensions = Number(dimensionsText);
  try {
    return {
      state: "ready",
      ...validateResearchEmbeddingProviderConfig({
        providerId,
        protocol: protocol as ResearchEmbeddingProtocol,
        endpoint,
        modelId,
        dimensions,
      }),
    };
  } catch {
    return { state: "unavailable", code: "invalid_configuration" };
  }
}

function validateInputs(inputs: readonly string[]): void {
  if (inputs.length < 1 || inputs.length > MAX_RESEARCH_EMBEDDING_INPUTS) {
    invalidInput(`embedding input count must be between 1 and ${MAX_RESEARCH_EMBEDDING_INPUTS}`);
  }
  let bytes = 0;
  for (const input of inputs) {
    bytes += Buffer.byteLength(input, "utf8");
    if (bytes > MAX_RESEARCH_EMBEDDING_INPUT_BYTES) {
      invalidInput("embedding inputs exceed the byte limit");
    }
  }
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)
        || Number(declared) > MAX_RESEARCH_EMBEDDING_RESPONSE_BYTES) {
      throw new ResearchEmbeddingProviderError(
        "response_too_large", "failed", "embedding response exceeds the byte limit",
      );
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_RESEARCH_EMBEDDING_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ResearchEmbeddingProviderError(
          "response_too_large", "failed", "embedding response exceeds the byte limit",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validateVector(value: unknown, dimensions: number): number[] | null {
  if (!Array.isArray(value) || value.length !== dimensions) return null;
  if (value.some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
  const vector = value as number[];
  const float32 = vector.map((item) => Math.fround(item));
  if (float32.some((item) => !Number.isFinite(item))
      || !float32.some((item) => item !== 0)) return null;
  return vector;
}

function parseOpenAiResponse(
  value: unknown,
  config: ValidatedResearchEmbeddingProviderConfig,
  count: number,
): number[][] | null {
  const root = object(value);
  if (!root || !Array.isArray(root.data) || root.data.length !== count) return null;
  if (root.model !== undefined && root.model !== config.modelId) return null;
  const indexed = new Map<number, number[]>();
  for (let position = 0; position < root.data.length; position += 1) {
    const row = object(root.data[position]);
    if (!row) return null;
    const index = row.index === undefined ? position : row.index;
    if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= count || indexed.has(Number(index))) {
      return null;
    }
    const vector = validateVector(row.embedding, config.dimensions);
    if (!vector) return null;
    indexed.set(Number(index), vector);
  }
  return Array.from({ length: count }, (_, index) => indexed.get(index) ?? []).filter((row) => row.length > 0);
}

function parseOllamaResponse(
  value: unknown,
  config: ValidatedResearchEmbeddingProviderConfig,
  count: number,
): number[][] | null {
  const root = object(value);
  if (!root || !Array.isArray(root.embeddings) || root.embeddings.length !== count) return null;
  if (root.model !== undefined && root.model !== config.modelId) return null;
  const vectors = root.embeddings.map((item) => validateVector(item, config.dimensions));
  return vectors.some((item) => item === null) ? null : vectors as number[][];
}

export async function embedResearchResourceInputs(
  rawConfig: ResearchEmbeddingProviderConfig | ValidatedResearchEmbeddingProviderConfig,
  inputs: readonly string[],
  options: ResearchEmbeddingRequestOptions = {},
): Promise<number[][]> {
  const config = validateResearchEmbeddingProviderConfig(rawConfig);
  validateInputs(inputs);
  const timeoutMs = options.timeoutMs ?? DEFAULT_RESEARCH_EMBEDDING_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    invalidInput("embedding timeout is invalid");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(config.endpoint, {
        method: "POST",
        redirect: "manual",
        credentials: "omit",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(config.protocol === "openai"
          ? { model: config.modelId, input: [...inputs], dimensions: config.dimensions }
          : { model: config.modelId, input: [...inputs], truncate: false }),
        signal: controller.signal,
      });
    } catch {
      const aborted = controller.signal.aborted;
      throw new ResearchEmbeddingProviderError(
        aborted ? "aborted" : "provider_offline",
        "unavailable",
        aborted ? "embedding request timed out" : "embedding provider is unavailable",
      );
    }
    if (response.status < 200 || response.status >= 300) {
      try { await response.body?.cancel(); } catch { /* bounded code wins */ }
      throw new ResearchEmbeddingProviderError(
        response.status >= 500 ? "provider_offline" : "provider_rejected",
        response.status >= 500 ? "unavailable" : "failed",
        "embedding provider rejected the request",
      );
    }
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      try { await response.body?.cancel(); } catch { /* bounded code wins */ }
      throw new ResearchEmbeddingProviderError(
        "invalid_media_type", "failed", "embedding response is not JSON",
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = await boundedResponseBytes(response);
    } catch (error) {
      if (error instanceof ResearchEmbeddingProviderError) throw error;
      if (controller.signal.aborted) {
        throw new ResearchEmbeddingProviderError(
          "aborted", "unavailable", "embedding request timed out",
        );
      }
      throw new ResearchEmbeddingProviderError(
        "provider_offline", "unavailable", "embedding response body is unavailable",
      );
    }
    if (controller.signal.aborted) {
      throw new ResearchEmbeddingProviderError(
        "aborted", "unavailable", "embedding request timed out",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new ResearchEmbeddingProviderError(
        "invalid_response", "failed", "embedding response is invalid",
      );
    }
    const vectors = config.protocol === "openai"
      ? parseOpenAiResponse(parsed, config, inputs.length)
      : parseOllamaResponse(parsed, config, inputs.length);
    if (!vectors || vectors.length !== inputs.length) {
      throw new ResearchEmbeddingProviderError(
        "invalid_response", "failed", "embedding response is incompatible",
      );
    }
    return vectors;
  } finally {
    clearTimeout(timer);
  }
}
