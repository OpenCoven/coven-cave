import {
  X_API_BASE_URL,
  X_OAUTH_REDIRECT_URI,
  X_TOKEN_URL,
  getXClientId,
} from "./x-app-config.ts";
import {
  MAX_X_JSON_BYTES,
  MAX_X_POST_TEXT_BYTES,
  XApiError,
  canonicalXPostUrl,
  type NormalizedXPost,
  type XScope,
} from "../x-api.ts";

const REQUEST_TIMEOUT_MS = 10_000;
const X_SCOPES = new Set<XScope>([
  "tweet.read",
  "users.read",
  "offline.access",
  "tweet.write",
]);

type UnknownRecord = Record<string, unknown>;
type XFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export type XAccount = { id: string; username: string; name: string };
export type XTokenResult = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scopes?: XScope[];
};
export type XCreatedPost = { id: string; text: string };

export type XClient = {
  exchangeXAuthorizationCode(input: { code: string; codeVerifier: string }): Promise<XTokenResult>;
  refreshXToken(input: { refreshToken: string }): Promise<XTokenResult>;
  fetchXAccount(accessToken: string): Promise<XAccount>;
  lookupXPost(accessToken: string, postId: string): Promise<NormalizedXPost>;
  searchRecentXPosts(accessToken: string, query: string): Promise<NormalizedXPost[]>;
  createXPost(accessToken: string, text: string): Promise<XCreatedPost>;
};

export type XClientOptions = {
  fetch?: XFetch;
  clientId?: string;
  now?: () => number;
  setTimeout?: (callback: () => void, milliseconds: number) => TimeoutHandle;
  clearTimeout?: (timeout: TimeoutHandle) => void;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function strictString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function validPostId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function invalidRequest(): XApiError {
  return new XApiError("invalid-request", "X request is invalid");
}

function invalidResponse(): XApiError {
  return new XApiError("invalid-response", "X returned an invalid response");
}

function unavailable(): XApiError {
  return new XApiError("upstream-unavailable", "X is temporarily unavailable");
}

function httpError(status: number, headers: Headers): XApiError {
  switch (status) {
    case 400:
      return invalidRequest();
    case 401:
      return new XApiError("unauthorized", "X authorization is required", { status });
    case 402:
      return new XApiError("billing-unavailable", "X billing is unavailable", { status });
    case 403:
      return new XApiError("capability-disabled", "X access is unavailable", { status });
    case 404:
      return new XApiError("not-found", "X resource was not found", { status });
    case 429:
      return new XApiError("rate-limited", "X rate limit reached", {
        status,
        retryAt: retryAt(headers),
      });
    default:
      return unavailable();
  }
}

function retryAt(headers: Headers): string | undefined {
  const reset = headers.get("x-rate-limit-reset");
  if (reset && /^\d+$/.test(reset)) {
    const milliseconds = Number(reset) * 1000;
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString();
  }
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return undefined;
  if (/^\d+$/.test(retryAfter)) {
    return new Date(Date.now() + Number(retryAfter) * 1000).toISOString();
  }
  const parsed = Date.parse(retryAfter);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidResponse();
  }
}

async function readBoundedJson(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_X_JSON_BYTES) {
    throw invalidResponse();
  }
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_X_JSON_BYTES) {
        void reader.cancel().catch(() => {});
        throw invalidResponse();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseScopes(value: unknown): XScope[] | null {
  if (typeof value !== "string") return null;
  const scopes = value.split(" ");
  if (scopes.length === 0 || scopes.some((scope) => !X_SCOPES.has(scope as XScope))) return null;
  const unique = new Set(scopes);
  return unique.size === scopes.length ? scopes as XScope[] : null;
}

function parseToken(value: unknown, now: () => number, requireRefresh: boolean): XTokenResult {
  if (!isRecord(value)) throw invalidResponse();
  const expiresIn = value.expires_in;
  const allowed = ["token_type", "access_token", "refresh_token", "expires_in", "scope"];
  if (!Object.keys(value).every((key) => allowed.includes(key))
    || !strictString(value.access_token)
    || !strictString(value.token_type)
    || value.token_type.toLowerCase() !== "bearer"
    || typeof expiresIn !== "number"
    || !Number.isSafeInteger(expiresIn)
    || expiresIn <= 0) {
    throw invalidResponse();
  }
  if (value.refresh_token !== undefined && !strictString(value.refresh_token)) throw invalidResponse();
  if (requireRefresh && value.refresh_token === undefined) throw invalidResponse();
  let scopes: XScope[] | undefined;
  if (value.scope !== undefined) {
    const parsedScopes = parseScopes(value.scope);
    if (!parsedScopes) throw invalidResponse();
    scopes = parsedScopes;
  }
  const nowMs = now();
  const expiresMs = nowMs + expiresIn * 1000;
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs)) throw invalidResponse();
  return {
    accessToken: value.access_token,
    ...(value.refresh_token === undefined ? {} : { refreshToken: value.refresh_token }),
    expiresAt: new Date(expiresMs).toISOString(),
    ...(scopes === undefined ? {} : { scopes }),
  };
}

function parseAccount(value: unknown): XAccount {
  if (!isRecord(value) || !exactKeys(value, ["id", "username", "name"])
    || !validPostId(value.id) || typeof value.username !== "string"
    || !/^[A-Za-z0-9_]{1,15}$/.test(value.username)
    || typeof value.name !== "string" || value.name.length === 0) {
    throw invalidResponse();
  }
  return { id: value.id, username: value.username, name: value.name };
}

function parsePost(value: unknown, users: Map<string, XAccount>): NormalizedXPost {
  if (!isRecord(value) || !exactKeys(value, ["id", "text", "author_id", "created_at"])
    || !validPostId(value.id) || typeof value.text !== "string" || value.text.length === 0 || !validPostId(value.author_id)
    || !strictString(value.created_at) || !Number.isFinite(Date.parse(value.created_at))) {
    throw invalidResponse();
  }
  const author = users.get(value.author_id);
  if (!author) throw invalidResponse();
  return {
    id: value.id,
    canonicalUrl: canonicalXPostUrl(value.id, author.username),
    text: value.text,
    author,
    createdAt: value.created_at,
  };
}

function parseUsers(value: unknown): Map<string, XAccount> {
  if (!Array.isArray(value) || value.length === 0) throw invalidResponse();
  const users = new Map<string, XAccount>();
  for (const item of value) {
    const account = parseAccount(item);
    if (users.has(account.id)) throw invalidResponse();
    users.set(account.id, account);
  }
  return users;
}

function validSearchMeta(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const allowed = ["newest_id", "oldest_id", "result_count", "next_token"];
  if (!Object.keys(value).every((key) => allowed.includes(key))) return false;
  if (value.result_count !== undefined
    && (typeof value.result_count !== "number" || !Number.isSafeInteger(value.result_count) || value.result_count < 0)) {
    return false;
  }
  for (const key of ["newest_id", "oldest_id", "next_token"] as const) {
    if (value[key] !== undefined && !strictString(value[key])) return false;
  }
  return true;
}

function authorization(accessToken: string): HeadersInit {
  if (!strictString(accessToken)) throw invalidRequest();
  return { authorization: `Bearer ${accessToken}` };
}

export function createXClient(options: XClientOptions = {}): XClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const clientId = options.clientId ?? getXClientId();
  const now = options.now ?? Date.now;
  const setTimeoutImpl = options.setTimeout ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeout ?? clearTimeout;
  if (!strictString(clientId)) throw invalidRequest();

  async function request(
    url: URL,
    init: RequestInit,
    write = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) throw httpError(response.status, response.headers);
      return parseJson(await readBoundedJson(response));
    } catch (error) {
      if (error instanceof XApiError) throw error;
      throw write
        ? new XApiError("ambiguous-write", "X post delivery is uncertain", { dispatched: true })
        : unavailable();
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  async function exchangeXAuthorizationCode(input: { code: string; codeVerifier: string }): Promise<XTokenResult> {
    if (!isRecord(input) || !strictString(input.code) || !strictString(input.codeVerifier)) throw invalidRequest();
    const body = new URLSearchParams({
      client_id: clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: X_OAUTH_REDIRECT_URI,
    });
    return parseToken(await request(new URL(X_TOKEN_URL), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }), now, true);
  }

  async function refreshXToken(input: { refreshToken: string }): Promise<XTokenResult> {
    if (!isRecord(input) || !strictString(input.refreshToken)) throw invalidRequest();
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    });
    return parseToken(await request(new URL(X_TOKEN_URL), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }), now, false);
  }

  async function fetchXAccount(accessToken: string): Promise<XAccount> {
    const response = await request(new URL("users/me", `${X_API_BASE_URL}/`), {
      headers: authorization(accessToken),
    });
    if (!isRecord(response) || !exactKeys(response, ["data"])) throw invalidResponse();
    return parseAccount(response.data);
  }

  function postUrl(path: string): URL {
    const url = new URL(path.replace(/^\//, ""), `${X_API_BASE_URL}/`);
    url.searchParams.set("tweet.fields", "created_at,author_id");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "id,name,username");
    return url;
  }

  async function lookupXPost(accessToken: string, postId: string): Promise<NormalizedXPost> {
    if (!validPostId(postId)) throw invalidRequest();
    const response = await request(postUrl(`/tweets/${postId}`), { headers: authorization(accessToken) });
    if (!isRecord(response) || !exactKeys(response, ["data", "includes"]) || !isRecord(response.includes)
      || !exactKeys(response.includes, ["users"])) throw invalidResponse();
    return parsePost(response.data, parseUsers(response.includes.users));
  }

  async function searchRecentXPosts(accessToken: string, query: string): Promise<NormalizedXPost[]> {
    if (typeof query !== "string") throw invalidRequest();
    const normalizedQuery = query.trim();
    if (!normalizedQuery || Array.from(normalizedQuery).length > 512) throw invalidRequest();
    const url = postUrl("/tweets/search/recent");
    url.searchParams.set("query", normalizedQuery);
    url.searchParams.set("max_results", "10");
    const response = await request(url, { headers: authorization(accessToken) });
    if (!isRecord(response) || !Object.keys(response).every((key) => key === "data" || key === "includes" || key === "meta")
      || (response.meta !== undefined && !validSearchMeta(response.meta))) throw invalidResponse();
    if (response.data === undefined) {
      if (response.includes !== undefined) throw invalidResponse();
      return [];
    }
    if (!Array.isArray(response.data)) throw invalidResponse();
    if (response.data.length === 0) {
      if (response.includes !== undefined && (!isRecord(response.includes) || !exactKeys(response.includes, ["users"]))) {
        throw invalidResponse();
      }
      return [];
    }
    if (!isRecord(response.includes) || !exactKeys(response.includes, ["users"])) throw invalidResponse();
    const users = parseUsers(response.includes.users);
    return response.data.slice(0, 10).map((post) => parsePost(post, users));
  }

  async function createXPost(accessToken: string, text: string): Promise<XCreatedPost> {
    if (typeof text !== "string" || text.length === 0 || Buffer.byteLength(text) > MAX_X_POST_TEXT_BYTES) throw invalidRequest();
    const response = await request(new URL("tweets", `${X_API_BASE_URL}/`), {
      method: "POST",
      headers: { ...authorization(accessToken), "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }, true);
    if (!isRecord(response) || !exactKeys(response, ["data"]) || !isRecord(response.data)
      || !exactKeys(response.data, ["id", "text"]) || !validPostId(response.data.id)
      || typeof response.data.text !== "string") throw invalidResponse();
    return { id: response.data.id, text: response.data.text };
  }

  return { exchangeXAuthorizationCode, refreshXToken, fetchXAccount, lookupXPost, searchRecentXPosts, createXPost };
}

let productionClient: XClient | null = null;
function getProductionClient(): XClient {
  productionClient ??= createXClient();
  return productionClient;
}

export function exchangeXAuthorizationCode(input: { code: string; codeVerifier: string }): Promise<XTokenResult> {
  return getProductionClient().exchangeXAuthorizationCode(input);
}

export function refreshXToken(input: { refreshToken: string }): Promise<XTokenResult> {
  return getProductionClient().refreshXToken(input);
}

export function fetchXAccount(accessToken: string): Promise<XAccount> {
  return getProductionClient().fetchXAccount(accessToken);
}

export function lookupXPost(accessToken: string, postId: string): Promise<NormalizedXPost> {
  return getProductionClient().lookupXPost(accessToken, postId);
}

export function searchRecentXPosts(accessToken: string, query: string): Promise<NormalizedXPost[]> {
  return getProductionClient().searchRecentXPosts(accessToken, query);
}

export function createXPost(accessToken: string, text: string): Promise<XCreatedPost> {
  return getProductionClient().createXPost(accessToken, text);
}
