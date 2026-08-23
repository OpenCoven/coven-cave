import assert from "node:assert/strict";
import type {
  NormalizedXArticle,
  XArticleAuthor,
  XArticleCandidate,
  XArticleFailureCode,
  XArticleIngestFailure,
  XArticleProviderId,
  XArticleSnapshot,
} from "./x-articles.ts";
import {
  MAX_X_ARTICLE_BODY_CHARS,
  MAX_X_ARTICLE_EXCERPT_CHARS,
  MAX_X_ARTICLE_TITLE_CHARS,
  MAX_X_ARTICLES_PER_INGEST,
  X_ARTICLE_REQUEST_TIMEOUT_MS,
  XArticleProviderError,
  deriveXArticleTitle,
  parseXArticleCandidateUrl,
} from "./x-articles.ts";

type Equal<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2)
    ? (<Value>() => Value extends Expected ? 1 : 2) extends
      (<Value>() => Value extends Actual ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

export type XArticleProviderIdIsExact = Assert<Equal<XArticleProviderId, "sorsa">>;
export type XArticleFailureCodeIsExact = Assert<Equal<XArticleFailureCode,
  | "not-configured"
  | "missing-credential"
  | "unauthorized"
  | "not-article"
  | "rate-limited"
  | "timeout"
  | "upstream-unavailable"
  | "invalid-response"
  | "too-large">>;
export type XArticleCandidateIsExact = Assert<Equal<XArticleCandidate, {
  sourcePostId: string;
  canonicalUrl: string;
}>>;
export type XArticleAuthorIsExact = Assert<Equal<XArticleAuthor, {
  id: string;
  username: string;
  displayName?: string;
}>>;
export type NormalizedXArticleIsExact = Assert<Equal<NormalizedXArticle, {
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
}>>;
export type XArticleSnapshotIsExact = Assert<Equal<XArticleSnapshot,
  Omit<NormalizedXArticle, "title"> & { version: 1 }
>>;
export type XArticleIngestFailureIsExact = Assert<Equal<XArticleIngestFailure, {
  url: string;
  code: XArticleFailureCode;
  message: string;
  retryable: boolean;
}>>;

assert.deepEqual(parseXArticleCandidateUrl("https://x.com/OpenCoven/status/123456789?ref=home"), {
  sourcePostId: "123456789",
  canonicalUrl: "https://x.com/opencoven/status/123456789",
});
assert.deepEqual(parseXArticleCandidateUrl("https://twitter.com/i/web/status/42"), {
  sourcePostId: "42",
  canonicalUrl: "https://x.com/i/web/status/42",
});
assert.deepEqual(parseXArticleCandidateUrl(" https://www.twitter.com/OpenCoven/status/7?ref=home#article "), {
  sourcePostId: "7",
  canonicalUrl: "https://x.com/opencoven/status/7",
});

for (const raw of [
  "https://x.com/OpenCoven",
  "https://x.com/OpenCoven/status/not-a-number",
  "https://example.com/OpenCoven/status/123456789",
]) {
  assert.equal(parseXArticleCandidateUrl(raw), null, `rejects ${raw}`);
}

assert.equal(deriveXArticleTitle("\r\n  First meaningful line  \r\nSecond line"), "First meaningful line");
assert.equal(deriveXArticleTitle("\n \t \n"), "Untitled X Article");

const unicodeTitle = "🧙".repeat(MAX_X_ARTICLE_TITLE_CHARS + 1);
const boundedTitle = deriveXArticleTitle(unicodeTitle);
assert.equal(Array.from(boundedTitle).length, MAX_X_ARTICLE_TITLE_CHARS);
assert.equal(boundedTitle, "🧙".repeat(MAX_X_ARTICLE_TITLE_CHARS));

assert.equal(MAX_X_ARTICLES_PER_INGEST, 10);
assert.equal(MAX_X_ARTICLE_BODY_CHARS, 120_000);
assert.equal(MAX_X_ARTICLE_EXCERPT_CHARS, 2_000);
assert.equal(MAX_X_ARTICLE_TITLE_CHARS, 300);
assert.equal(X_ARTICLE_REQUEST_TIMEOUT_MS, 10_000);

const providerError = new XArticleProviderError("timeout", "Article fetch timed out", true);
assert.equal(providerError.name, "XArticleProviderError");
assert.equal(providerError.message, "Article fetch timed out");
assert.equal(providerError.code, "timeout");
assert.equal(providerError.retryable, true);
