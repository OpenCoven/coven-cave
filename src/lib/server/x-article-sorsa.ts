import type { XArticleAuthor, NormalizedXArticle } from "../x-articles.ts";
import {
  deriveXArticleTitle,
  MAX_X_ARTICLE_BODY_CHARS,
  MAX_X_ARTICLE_EXCERPT_CHARS,
  X_ARTICLE_REQUEST_TIMEOUT_MS,
  XArticleProviderError,
  isValidXArticleAuthorDisplayName,
  isValidXArticleAuthorId,
  isValidXArticleContentSha256,
  isValidXArticleSourcePostId,
  isValidXArticleUsername,
  normalizeXArticleCoverImageUrl,
  normalizeXArticleTimestamp,
  parseXArticleCandidateUrl,
  xArticleCodePointLength,
} from "../x-articles.ts";
import { xArticleContentSha256 } from "./x-article-content-sha.ts";

const SORSA_ARTICLE_ENDPOINT = "https://api.sorsa.io/v3/article";
// 1 MiB covers a 120k-code-point body at 4 UTF-8 bytes per code point (~480 KiB),
// plus preview text, URLs, author metadata, and JSON escaping headroom, while
// preventing unbounded upstream buffering.
const MAX_SORSA_RESPONSE_BYTES = 1_048_576;
const RESPONSE_TEXT_DECODER = new TextDecoder();

type UnknownRecord = Record<string, unknown>;

export type FetchSorsaXArticleOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
};

function providerError(
  code: XArticleProviderError["code"],
  message: string,
  retryable: boolean,
): XArticleProviderError {
  return new XArticleProviderError(code, message, retryable);
}

function unauthorized(): XArticleProviderError {
  return providerError("unauthorized", "X article provider authorization failed", false);
}

function notArticle(): XArticleProviderError {
  return providerError("not-article", "X article could not be resolved", false);
}

function rateLimited(): XArticleProviderError {
  return providerError("rate-limited", "X article provider is rate limited", true);
}

function timeout(): XArticleProviderError {
  return providerError("timeout", "X article request timed out", true);
}

function unavailable(): XArticleProviderError {
  return providerError("upstream-unavailable", "X article provider is temporarily unavailable", true);
}

function invalidResponse(): XArticleProviderError {
  return providerError("invalid-response", "X article provider returned invalid article data", true);
}

function tooLarge(): XArticleProviderError {
  return providerError("too-large", "X article provider response exceeds the supported size limit", false);
}

function missingCredential(): XArticleProviderError {
  return providerError("missing-credential", "X article provider credentials are unavailable", false);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

function truncateCodePoints(value: string, maxChars: number): string {
  return Array.from(value).slice(0, maxChars).join("");
}

function parseContentLength(headers: Headers): number | null {
  const raw = headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Ignore cancellation failures; the safe outcome is the local too-large error.
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore cancellation failures; provider errors must remain local and safe.
  }
}

function combineChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function readStreamTextWithinLimit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value ?? new Uint8Array(0);
      if (totalBytes + chunk.byteLength > MAX_SORSA_RESPONSE_BYTES) {
        await cancelReader(reader);
        throw tooLarge();
      }

      chunks.push(chunk);
      totalBytes += chunk.byteLength;
    }
  } finally {
    reader.releaseLock?.();
  }

  return RESPONSE_TEXT_DECODER.decode(combineChunks(chunks, totalBytes));
}

async function readResponseTextWithinLimit(response: Response): Promise<string> {
  const contentLength = parseContentLength(response.headers);
  if (contentLength !== null && contentLength > MAX_SORSA_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw tooLarge();
  }

  const reader = response.body?.getReader?.();
  if (reader) return readStreamTextWithinLimit(reader);
  await cancelResponseBody(response);
  throw invalidResponse();
}

function normalizeTimestamp(value: unknown): string {
  const timestamp = normalizeXArticleTimestamp(value);
  if (!timestamp) throw invalidResponse();
  return timestamp;
}

function normalizeNow(value: unknown): string {
  if (!(value instanceof Date)) throw invalidResponse();
  const timestamp = value.valueOf();
  if (!Number.isFinite(timestamp)) throw invalidResponse();
  return new Date(timestamp).toISOString();
}

function normalizeAuthor(value: unknown): XArticleAuthor {
  if (
    !isRecord(value)
    || !isValidXArticleAuthorId(value.id)
    || !isValidXArticleUsername(value.username)
  ) {
    throw invalidResponse();
  }

  if (value.display_name === undefined || value.display_name === null) {
    return {
      id: value.id,
      username: value.username,
    };
  }

  if (!isValidXArticleAuthorDisplayName(value.display_name)) throw invalidResponse();
  return {
    id: value.id,
    username: value.username,
    displayName: value.display_name,
  };
}

function normalizeCoverImageUrl(value: unknown): string | undefined {
  const url = normalizeXArticleCoverImageUrl(value);
  if (url === null) throw invalidResponse();
  return url;
}

function httpError(status: number): XArticleProviderError {
  switch (status) {
    case 401:
    case 403:
      return unauthorized();
    case 404:
      return notArticle();
    case 429:
      return rateLimited();
    default:
      return unavailable();
  }
}

function normalizeSorsaArticle(
  value: unknown,
  sourcePostId: string,
  fetchedAt: string,
): NormalizedXArticle {
  if (!isRecord(value) || !isValidXArticleSourcePostId(sourcePostId)) throw invalidResponse();
  if (typeof value.full_text !== "string" || typeof value.preview_text !== "string") {
    throw invalidResponse();
  }

  const body = value.full_text.trim();
  if (!body) throw notArticle();
  if (xArticleCodePointLength(body) > MAX_X_ARTICLE_BODY_CHARS) throw tooLarge();

  const coverImageUrl = normalizeCoverImageUrl(value.cover_image_url);
  const contentSha256 = xArticleContentSha256(body);
  if (!isValidXArticleContentSha256(contentSha256)) throw invalidResponse();
  return {
    provider: "sorsa",
    sourcePostId,
    title: deriveXArticleTitle(body),
    titleSource: "derived",
    author: normalizeAuthor(value.author),
    body,
    excerpt: truncateCodePoints(value.preview_text.trim(), MAX_X_ARTICLE_EXCERPT_CHARS),
    ...(coverImageUrl === undefined ? {} : { coverImageUrl }),
    publishedAt: normalizeTimestamp(value.published_at),
    fetchedAt,
    contentSha256,
  };
}

export async function fetchSorsaXArticle(
  url: string,
  options: FetchSorsaXArticleOptions,
): Promise<NormalizedXArticle> {
  const candidate = parseXArticleCandidateUrl(url);
  if (!candidate || !isValidXArticleSourcePostId(candidate.sourcePostId)) {
    throw notArticle();
  }

  const apiKey = options.apiKey?.trim();
  if (!apiKey) throw missingCredential();

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? X_ARTICLE_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(SORSA_ARTICLE_ENDPOINT, {
      method: "POST",
      headers: {
        ApiKey: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tweet_link: candidate.canonicalUrl }),
      signal: controller.signal,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      throw httpError(response.status);
    }

    const raw = await readResponseTextWithinLimit(response);
    if (!raw.trim()) throw notArticle();

    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw invalidResponse();
    }

    return normalizeSorsaArticle(
      payload,
      candidate.sourcePostId,
      normalizeNow(now()),
    );
  } catch (error) {
    if (error instanceof XArticleProviderError) throw error;
    if (isAbortError(error)) throw timeout();
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}
