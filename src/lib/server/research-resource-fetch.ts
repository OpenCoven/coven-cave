import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export const RESEARCH_FETCH_LIMITS = {
  maxRedirects: 5,
  maxHeaderBytes: 64 * 1024,
  maxBodyBytes: 64 * 1024 * 1024,
  maxTextBodyBytes: 16 * 1024 * 1024,
  headerTimeoutMs: 10_000,
  totalTimeoutMs: 30_000,
} as const;

export type ResearchFetchLimits = {
  [Key in keyof typeof RESEARCH_FETCH_LIMITS]: number;
};

export type ResearchFetchAddress = { address: string; family: 4 | 6 };

export type ResearchFetchConnectionResponse = {
  status: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  rawHeaderBytes: number;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
};

export type ResearchFetchConnection = (input: {
  url: URL;
  addresses: readonly ResearchFetchAddress[];
  headers: Readonly<Record<string, string>>;
  headerTimeoutMs: number;
  signal: AbortSignal;
}) => Promise<ResearchFetchConnectionResponse>;

export type ResearchFetchFailure = {
  ok: false;
  disposition: "retryable" | "nonretryable" | "paused_quota";
  code:
    | "invalid_url"
    | "unsafe_destination"
    | "dns_failed"
    | "transport_failed"
    | "timed_out"
    | "too_many_redirects"
    | "invalid_redirect"
    | "headers_too_large"
    | "body_too_large"
    | "http_server"
    | "http_client"
    | "quota_pause";
  retryAfterMs?: number;
};

export type ResearchFetchSuccess = {
  ok: true;
  finalUrl: string;
  status: number;
  contentType: string | null;
  contentEncoding: string | null;
  bytes: Uint8Array;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
};

export type ResearchFetchResult = ResearchFetchFailure | ResearchFetchSuccess;

export type ResearchFetchOptions = {
  resolve?: (hostname: string) => Promise<readonly ResearchFetchAddress[]>;
  connect?: ResearchFetchConnection;
  now?: () => Date;
  limits?: Partial<ResearchFetchLimits>;
};

const deniedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) deniedV4.addSubnet(network, prefix, "ipv4");

const deniedV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64],
  ["2001:2::", 48], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) deniedV6.addSubnet(network, prefix, "ipv6");

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

/** Only globally routable unicast addresses may cross the fetch boundary. */
export function isPublicResearchAddress(rawAddress: string): boolean {
  const address = stripIpv6Brackets(rawAddress).split("%")[0];
  const family = isIP(address);
  if (family === 4) return !deniedV4.check(address, "ipv4");
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicResearchAddress(mapped[1]);
  // The currently allocated global-unicast space is 2000::/3. Staying inside
  // it is deliberately conservative for a server-side public fetcher.
  return /^[23][0-9a-f]{3}:/i.test(address) && !deniedV6.check(address, "ipv6");
}

export function parseResearchFetchUrl(raw: string): URL | null {
  if (raw.length < 1 || raw.length > 8_192) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  const allowedPort = url.protocol === "http:" ? "80" : "443";
  if (url.port && url.port !== allowedPort) return null;
  return url;
}

export async function resolvePublicResearchAddresses(
  hostname: string,
): Promise<ResearchFetchAddress[]> {
  const literal = stripIpv6Brackets(hostname);
  const literalFamily = isIP(literal);
  const resolved = literalFamily
    ? [{ address: literal, family: literalFamily as 4 | 6 }]
    : (await lookup(literal, { all: true, verbatim: true }))
        .map(({ address, family }) => ({ address, family: family as 4 | 6 }));
  if (resolved.length === 0 || resolved.some(({ address }) => !isPublicResearchAddress(address))) {
    throw Object.assign(new Error("destination is not public"), { code: "EACCES" });
  }
  const unique = new Map(resolved.map((entry) => [`${entry.family}:${entry.address}`, entry]));
  return [...unique.values()];
}

function firstHeader(
  headers: ResearchFetchConnectionResponse["headers"],
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : typeof value === "string" ? value : null;
}

function rawHeaderBytes(headers: IncomingHttpHeaders, rawHeaders: readonly string[]): number {
  if (rawHeaders.length > 0) {
    let bytes = 2;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      bytes += Buffer.byteLength(rawHeaders[index] ?? "")
        + Buffer.byteLength(rawHeaders[index + 1] ?? "") + 4;
    }
    return bytes;
  }
  return Object.entries(headers).reduce(
    (total, [name, value]) => total + Buffer.byteLength(name) + Buffer.byteLength(String(value ?? "")) + 4,
    2,
  );
}

export const defaultResearchFetchConnection: ResearchFetchConnection = (input) =>
  new Promise((resolve, reject) => {
    const request = input.url.protocol === "https:" ? httpsRequest : httpRequest;
    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    const req = request(input.url, {
      method: "GET",
      headers: input.headers,
      maxHeaderSize: RESEARCH_FETCH_LIMITS.maxHeaderBytes,
      lookup: (_hostname, options, callback) => {
        const all = typeof options === "object" && options !== null && options.all === true;
        if (all) {
          callback(null, input.addresses.map((entry) => ({ ...entry })));
        } else {
          const selected = input.addresses[0];
          callback(null, selected.address, selected.family);
        }
      },
      signal: input.signal,
    }, (response) => {
      if (headerTimer) clearTimeout(headerTimer);
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        rawHeaderBytes: rawHeaderBytes(response.headers, response.rawHeaders),
        body: response,
        destroy: () => response.destroy(),
      });
    });
    headerTimer = setTimeout(
      () => req.destroy(Object.assign(new Error("header deadline exceeded"), { code: "ETIMEDOUT" })),
      input.headerTimeoutMs,
    );
    headerTimer.unref?.();
    req.once("error", (error) => {
      if (headerTimer) clearTimeout(headerTimer);
      reject(error);
    });
    req.end();
  });

function classifyTransport(error: unknown): ResearchFetchFailure {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "EACCES") return { ok: false, disposition: "nonretryable", code: "unsafe_destination" };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { ok: false, disposition: "retryable", code: "dns_failed" };
  }
  if (code === "ETIMEDOUT" || code === "ABORT_ERR" || (error as Error)?.name === "AbortError") {
    return { ok: false, disposition: "retryable", code: "timed_out" };
  }
  return { ok: false, disposition: "retryable", code: "transport_failed" };
}

function retryAfterMs(value: string | null, now: Date): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const duration = seconds === null ? Date.parse(value) - now.getTime() : seconds * 1_000;
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  return Math.min(duration, 24 * 60 * 60 * 1_000);
}

function isTextMediaType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType.startsWith("text/") || mediaType === "application/json" || mediaType.endsWith("+json")
    || mediaType === "application/xhtml+xml";
}

async function readBoundedBody(
  response: ResearchFetchConnectionResponse,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of response.body) {
    if (signal.aborted) throw Object.assign(new Error("response deadline exceeded"), { code: "ETIMEDOUT" });
    const chunk = Buffer.from(rawChunk);
    size += chunk.byteLength;
    if (size > limit) {
      response.destroy();
      throw Object.assign(new Error("response body exceeds limit"), { code: "EFBIG" });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function decodeContentEncoding(
  bytes: Uint8Array,
  encoding: string | null,
  limit: number,
): Uint8Array {
  const normalized = encoding?.trim().toLowerCase() ?? "identity";
  if (!normalized || normalized === "identity") return bytes;
  try {
    const options = { maxOutputLength: limit };
    if (normalized === "gzip" || normalized === "x-gzip") return gunzipSync(bytes, options);
    if (normalized === "deflate") return inflateSync(bytes, options);
    if (normalized === "br") return brotliDecompressSync(bytes, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw Object.assign(new Error("decoded response exceeds limit"), { code: "EFBIG" });
    }
    throw Object.assign(new Error("response content encoding is invalid"), { code: "EBADMSG" });
  }
  throw Object.assign(new Error("response content encoding is unsupported"), { code: "EBADMSG" });
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error("response deadline exceeded"), { code: "ETIMEDOUT" }));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error("response deadline exceeded"), { code: "ETIMEDOUT" }));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Fetch untrusted public bytes through a per-hop, address-pinned boundary. */
export async function fetchResearchResource(
  rawUrl: string,
  options: ResearchFetchOptions = {},
): Promise<ResearchFetchResult> {
  const parsed = parseResearchFetchUrl(rawUrl);
  if (!parsed) return { ok: false, disposition: "nonretryable", code: "invalid_url" };
  const limits: ResearchFetchLimits = { ...RESEARCH_FETCH_LIMITS, ...options.limits };
  const resolveAddresses = options.resolve ?? resolvePublicResearchAddresses;
  const connect = options.connect ?? defaultResearchFetchConnection;
  const now = options.now ?? (() => new Date());
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), limits.totalTimeoutMs);
  totalTimer.unref?.();
  let current = parsed;
  try {
    for (let redirects = 0; redirects <= limits.maxRedirects; redirects += 1) {
      let addresses: readonly ResearchFetchAddress[];
      try {
        addresses = await abortable(
          Promise.resolve(resolveAddresses(stripIpv6Brackets(current.hostname))),
          controller.signal,
        );
        if (addresses.length === 0 || addresses.some(({ address }) => !isPublicResearchAddress(address))) {
          return { ok: false, disposition: "nonretryable", code: "unsafe_destination" };
        }
      } catch (error) {
        return classifyTransport(error);
      }

      let response: ResearchFetchConnectionResponse;
      try {
        response = await abortable(Promise.resolve(connect({
          url: current,
          addresses,
          headers: {
            accept: "text/plain, text/markdown, text/html, application/xhtml+xml, application/json, application/pdf;q=0.9",
            "accept-encoding": "gzip, br, deflate",
            "user-agent": "coven-cave-research-ingest/1",
          },
          headerTimeoutMs: limits.headerTimeoutMs,
          signal: controller.signal,
        })), controller.signal);
      } catch (error) {
        return classifyTransport(error);
      }
      if (response.rawHeaderBytes > limits.maxHeaderBytes) {
        response.destroy();
        return { ok: false, disposition: "nonretryable", code: "headers_too_large" };
      }

      if (response.status >= 300 && response.status < 400) {
        response.destroy();
        if (redirects === limits.maxRedirects) {
          return { ok: false, disposition: "nonretryable", code: "too_many_redirects" };
        }
        const location = firstHeader(response.headers, "location");
        if (!location) return { ok: false, disposition: "nonretryable", code: "invalid_redirect" };
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { ok: false, disposition: "nonretryable", code: "invalid_redirect" };
        }
        const safeNext = parseResearchFetchUrl(next.toString());
        if (!safeNext) return { ok: false, disposition: "nonretryable", code: "invalid_redirect" };
        current = safeNext;
        continue;
      }
      if (response.status === 429) {
        response.destroy();
        const retryAfter = retryAfterMs(firstHeader(response.headers, "retry-after"), now());
        return {
          ok: false,
          disposition: "paused_quota",
          code: "quota_pause",
          ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
        };
      }
      if (response.status >= 500 || response.status === 408) {
        response.destroy();
        return { ok: false, disposition: "retryable", code: "http_server" };
      }
      if (response.status < 200 || response.status >= 300) {
        response.destroy();
        return { ok: false, disposition: "nonretryable", code: "http_client" };
      }

      const contentType = firstHeader(response.headers, "content-type");
      const contentEncoding = firstHeader(response.headers, "content-encoding");
      const bodyLimit = isTextMediaType(contentType) ? limits.maxTextBodyBytes : limits.maxBodyBytes;
      const declared = firstHeader(response.headers, "content-length");
      if (declared !== null) {
        if (!/^\d+$/.test(declared.trim()) || Number(declared) > bodyLimit) {
          response.destroy();
          return { ok: false, disposition: "nonretryable", code: "body_too_large" };
        }
      }
      try {
        const encodedBytes = await readBoundedBody(response, bodyLimit, controller.signal);
        const bytes = decodeContentEncoding(encodedBytes, contentEncoding, bodyLimit);
        return {
          ok: true,
          finalUrl: current.toString(),
          status: response.status,
          contentType,
          contentEncoding,
          bytes,
          fetchedAt: now().toISOString(),
          ...(firstHeader(response.headers, "etag") === null
            ? {} : { etag: firstHeader(response.headers, "etag")! }),
          ...(firstHeader(response.headers, "last-modified") === null
            ? {} : { lastModified: firstHeader(response.headers, "last-modified")! }),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EFBIG") {
          return { ok: false, disposition: "nonretryable", code: "body_too_large" };
        }
        if ((error as NodeJS.ErrnoException).code === "EBADMSG") {
          return { ok: false, disposition: "nonretryable", code: "http_client" };
        }
        return classifyTransport(error);
      }
    }
    return { ok: false, disposition: "nonretryable", code: "too_many_redirects" };
  } finally {
    clearTimeout(totalTimer);
  }
}
