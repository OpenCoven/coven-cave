import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  parseSavedLinkForTests,
  parseSavedLinkSummaryForTests,
} = await import("./use-research-links.ts");

const source = readFileSync(new URL("./use-research-links.ts", import.meta.url), "utf8");
const ARTICLE_URL = "https://x.com/OpenCoven/status/123456789";
const ARTICLE_ALIAS_URL = "https://twitter.com/i/web/status/123456789?ref=home";
const VALID_TIMESTAMP = "2026-08-18T12:34:56.000Z";
const VALID_HASH = "a".repeat(64);

function xArticle(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    provider: "sorsa",
    sourcePostId: "123456789",
    titleSource: "derived",
    author: {
      id: "42",
      username: "opencoven",
      displayName: "Open Coven",
    },
    excerpt: "Lead preview",
    publishedAt: VALID_TIMESTAMP,
    fetchedAt: VALID_TIMESTAMP,
    contentSha256: VALID_HASH,
    ...overrides,
  };
}

function savedLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    url: ARTICLE_URL,
    category: "article",
    title: "Open Coven reads the room",
    addedAt: VALID_TIMESTAMP,
    source: "desk",
    ...overrides,
  };
}

test("save validates failed arrays defensively and never trusts them on non-success", () => {
  assert.match(
    source,
    /const failed = Array\.isArray\(data\.failed\) \? data\.failed\.map\(parseFailure\) : null;/,
    "the hook only accepts an explicit failed[] array",
  );
  assert.match(
    source,
    /!added\s*\|\|\s*!duplicates\s*\|\|\s*!failed\s*\|\|[\s\S]{0,120}!failed\.every\(\(failure\) => failure !== null\)/,
    "every failed entry must survive parseFailure before the response is trusted",
  );
  assert.match(
    source,
    /if \(!res\.ok \|\| !isRecord\(data\) \|\| data\.ok !== true\) \{[\s\S]{0,220}failed: \[\],[\s\S]{0,220}\}/,
    "non-success responses surface the error copy but never leak unvalidated failed entries",
  );
});

test("detail reads are uncached and reject missing or malformed detail payloads", () => {
  assert.match(source, /const requestedId = id\.trim\(\);\s*if \(!requestedId\) return null;/);
  assert.match(
    source,
    /fetch\(`\/api\/research\/links\?id=\$\{encodeURIComponent\(requestedId\)\}`,\s*\{\s*cache: "no-store",\s*\}\)/,
  );
  assert.match(source, /if \(!res\.ok \|\| !isRecord\(data\) \|\| data\.ok !== true\) return null;/);
  assert.match(
    source,
    /return parseSavedLink\(data\.link\);/,
    "missing or malformed link payloads fall through parseSavedLink to null",
  );
});

test("summary/detail drop malformed X Article identity mismatches while preserving a safe base link", () => {
  const nonXSummary = parseSavedLinkSummaryForTests(savedLink({
    url: "https://example.com/blog/not-x",
    xArticle: xArticle(),
  }));
  assert.ok(nonXSummary);
  assert.equal(nonXSummary.xArticle, undefined);
  assert.equal(nonXSummary.category, "article");

  const mismatchedSummary = parseSavedLinkSummaryForTests(savedLink({
    xArticle: xArticle({ sourcePostId: "987654321" }),
  }));
  assert.ok(mismatchedSummary);
  assert.equal(mismatchedSummary.xArticle, undefined);
  assert.equal(mismatchedSummary.category, "social");

  const mismatchedDetail = parseSavedLinkForTests(savedLink({
    xArticle: {
      ...xArticle({ sourcePostId: "987654321" }),
      body: "Readable body",
    },
  }));
  assert.ok(mismatchedDetail);
  assert.equal(mismatchedDetail.xArticle, undefined);
  assert.equal(mismatchedDetail.category, "social");
});

test("summary/detail accept X Article aliases that resolve to the same source post id", () => {
  const summary = parseSavedLinkSummaryForTests(savedLink({
    url: ARTICLE_ALIAS_URL,
    category: "social",
    xArticle: xArticle(),
  }));
  assert.ok(summary?.xArticle);
  assert.equal(summary.category, "article");
  assert.equal(summary.xArticle?.sourcePostId, "123456789");

  const detail = parseSavedLinkForTests(savedLink({
    url: ARTICLE_ALIAS_URL,
    category: "social",
    xArticle: {
      ...xArticle(),
      body: "Readable alias body",
    },
  }));
  assert.ok(detail?.xArticle);
  assert.equal(detail.category, "article");
  assert.equal(detail.xArticle?.body, "Readable alias body");
});
