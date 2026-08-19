import { parseXPostUrl } from "./x-api.ts";

export const MAX_X_ARTICLES_PER_INGEST = 10;
export const MAX_X_ARTICLE_BODY_CHARS = 120_000;
export const MAX_X_ARTICLE_EXCERPT_CHARS = 2_000;
export const MAX_X_ARTICLE_TITLE_CHARS = 300;
export const MAX_X_ARTICLE_AUTHOR_ID_CHARS = 128;
export const MAX_X_ARTICLE_AUTHOR_DISPLAY_NAME_CHARS = 200;
export const MAX_X_ARTICLE_COVER_IMAGE_URL_CHARS = 2_048;
export const X_ARTICLE_REQUEST_TIMEOUT_MS = 10_000;

const X_ARTICLE_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const X_ARTICLE_SOURCE_POST_ID = /^\d{1,32}$/;
const X_ARTICLE_CONTENT_SHA256 = /^[a-f0-9]{64}$/;
const RFC3339_WITH_TIMEZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

export type XArticleProviderId = "sorsa";

export type XArticleFailureCode =
  | "not-configured"
  | "missing-credential"
  | "unauthorized"
  | "not-article"
  | "rate-limited"
  | "timeout"
  | "upstream-unavailable"
  | "invalid-response"
  | "too-large";

export class XArticleProviderError extends Error {
  declare readonly code: XArticleFailureCode;
  declare readonly retryable: boolean;

  constructor(
    code: XArticleFailureCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "XArticleProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type XArticleCandidate = {
  sourcePostId: string;
  canonicalUrl: string;
};

export type XArticleAuthor = {
  id: string;
  username: string;
  displayName?: string;
};

export type NormalizedXArticle = {
  provider: XArticleProviderId;
  sourcePostId: string;
  title: string;
  titleSource: "provider" | "derived";
  author: XArticleAuthor;
  body: string;
  excerpt: string;
  coverImageUrl?: string;
  publishedAt: string;
  fetchedAt: string;
  contentSha256: string;
};

export type XArticleSnapshot = Omit<NormalizedXArticle, "title"> & {
  version: 1;
};

export type XArticleIngestFailure = {
  url: string;
  code: XArticleFailureCode;
  message: string;
  retryable: boolean;
};

export function xArticleCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function isValidXArticleSourcePostId(value: unknown): value is string {
  return typeof value === "string" && X_ARTICLE_SOURCE_POST_ID.test(value);
}

export function isValidXArticleAuthorId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && xArticleCodePointLength(value) <= MAX_X_ARTICLE_AUTHOR_ID_CHARS;
}

export function isValidXArticleUsername(value: unknown): value is string {
  return typeof value === "string" && X_ARTICLE_USERNAME.test(value);
}

export function isValidXArticleAuthorDisplayName(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && xArticleCodePointLength(value) <= MAX_X_ARTICLE_AUTHOR_DISPLAY_NAME_CHARS;
}

export function isValidXArticleContentSha256(value: unknown): value is string {
  return typeof value === "string" && X_ARTICLE_CONTENT_SHA256.test(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeXArticleTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = RFC3339_WITH_TIMEZONE.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    return null;
  }

  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function normalizeXArticleCoverImageUrl(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || xArticleCodePointLength(value) > MAX_X_ARTICLE_COVER_IMAGE_URL_CHARS
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
  ) {
    return null;
  }
  return url.toString();
}

export function parseXArticleCandidateUrl(raw: string): XArticleCandidate | null {
  try {
    const parsed = parseXPostUrl(raw);
    return {
      sourcePostId: parsed.postId,
      canonicalUrl: parsed.canonicalUrl,
    };
  } catch {
    return null;
  }
}

export function deriveXArticleTitle(body: string): string {
  const firstMeaningfulLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstMeaningfulLine) {
    return "Untitled X Article";
  }

  return Array.from(firstMeaningfulLine).slice(0, MAX_X_ARTICLE_TITLE_CHARS).join("");
}
