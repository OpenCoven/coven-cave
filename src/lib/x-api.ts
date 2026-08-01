export type XScope =
  | "tweet.read"
  | "users.read"
  | "offline.access"
  | "tweet.write";

export const MAX_X_JSON_BYTES = 256 * 1024;
export const MAX_X_POST_TEXT_BYTES = 128 * 1024;

export type NormalizedXPost = {
  id: string;
  canonicalUrl: string;
  text: string;
  author: { id: string; username: string; name?: string };
  createdAt: string;
};

export type XErrorCode =
  | "not-configured"
  | "not-connected"
  | "capability-disabled"
  | "missing-scope"
  | "unauthorized"
  | "billing-unavailable"
  | "rate-limited"
  | "not-found"
  | "invalid-request"
  | "upstream-unavailable"
  | "ambiguous-write"
  | "invalid-response"
  | "oauth-in-progress"
  | "oauth-port-in-use"
  | "oauth-expired";

type XApiErrorOptions = {
  status?: number;
  retryAt?: string;
  dispatched?: boolean;
};

/** An error safe to return to a client or classify in logs. */
export class XApiError extends Error {
  declare readonly code: XErrorCode;
  declare readonly safeMessage: string;
  declare readonly status?: number;
  declare readonly retryAt?: string;
  declare readonly dispatched: boolean;

  constructor(code: XErrorCode, safeMessage: string, options: XApiErrorOptions = {}) {
    super(safeMessage);
    this.code = code;
    this.safeMessage = safeMessage;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAt !== undefined) this.retryAt = options.retryAt;
    this.dispatched = options.dispatched ?? false;
  }
}

const POST_ID = /^\d+$/;
const USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const RAW_X_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]+)(\/[^?#]*)(?:[?#][\s\S]*)?$/;
const X_AUTHORITIES = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const X_POST_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/;
const X_WEB_POST_PATH = /^\/i\/web\/status\/(\d+)$/;

function invalidXPostUrl(): never {
  throw new XApiError("invalid-request", "X post URL is invalid");
}

export function canonicalXPostUrl(postId: string, username?: string): string {
  const normalizedPostId = POST_ID.test(postId) ? postId : "";
  if (!normalizedPostId) {
    throw new XApiError("invalid-request", "A numeric X post ID is required");
  }

  if (username !== undefined) {
    if (!USERNAME.test(username)) {
      throw new XApiError("invalid-request", "A valid X username is required");
    }
    const normalizedUsername = username.toLowerCase();
    return `https://x.com/${normalizedUsername}/status/${normalizedPostId}`;
  }

  return `https://x.com/i/web/status/${normalizedPostId}`;
}

export function parseXPostUrl(raw: string): { postId: string; username?: string; canonicalUrl: string } {
  const urlMatch = RAW_X_URL.exec(raw.trim());
  if (!urlMatch || !["http", "https"].includes(urlMatch[1].toLowerCase()) || !X_AUTHORITIES.has(urlMatch[2].toLowerCase())) {
    return invalidXPostUrl();
  }

  const postMatch = X_POST_PATH.exec(urlMatch[3]);
  if (postMatch) {
    const username = postMatch[1].toLowerCase();
    const postId = postMatch[2];
    return { postId, username, canonicalUrl: canonicalXPostUrl(postId, username) };
  }

  const webPostMatch = X_WEB_POST_PATH.exec(urlMatch[3]);
  if (webPostMatch) {
    const postId = webPostMatch[1];
    return { postId, canonicalUrl: canonicalXPostUrl(postId) };
  }

  return invalidXPostUrl();
}

const X_ERROR_HTTP_STATUS: Record<XErrorCode, number> = {
  "not-configured": 503,
  "not-connected": 401,
  "capability-disabled": 403,
  "missing-scope": 403,
  unauthorized: 401,
  "billing-unavailable": 503,
  "rate-limited": 429,
  "not-found": 404,
  "invalid-request": 400,
  "upstream-unavailable": 503,
  "ambiguous-write": 502,
  "invalid-response": 502,
  "oauth-in-progress": 409,
  "oauth-port-in-use": 409,
  "oauth-expired": 410,
};

export function xErrorHttpStatus(code: XErrorCode): number {
  return X_ERROR_HTTP_STATUS[code];
}

export function xErrorLogCategory(error: unknown): XErrorCode | "internal" {
  return error instanceof XApiError ? error.code : "internal";
}
