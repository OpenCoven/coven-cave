// @ts-nocheck
import assert from "node:assert/strict";
import { classifyLink, parseGitHubUrl } from "./link-classifier.ts";

const CLASSIFY_CASES = [
  // Tier 1 — github
  ["https://github.com/foo/bar",                  { list: "github", rule: "github" }],
  ["https://github.com/foo/bar/issues/12",        { list: "github", rule: "github" }],
  ["https://github.com/foo/bar/pull/45",          { list: "github", rule: "github" }],
  ["https://gist.github.com/foo/abc",             { list: "github", rule: "github" }],
  ["HTTPS://GITHUB.COM/FOO/BAR",                  { list: "github", rule: "github" }],
  ["https://github.com/foo/bar?ref=x",            { list: "github", rule: "github" }],

  // Tier 2 — papers
  ["https://arxiv.org/abs/2603.12345",            { list: "reading", readingKind: "paper", rule: "paper-host" }],
  ["https://openreview.net/forum?id=abc",         { list: "reading", readingKind: "paper", rule: "paper-host" }],

  // Tier 3 — videos
  ["https://youtu.be/dQw4w9WgXcQ",                { list: "reading", readingKind: "video", rule: "video-host" }],
  ["https://www.youtube.com/watch?v=abc",         { list: "reading", readingKind: "video", rule: "video-host" }],
  ["https://vimeo.com/12345",                     { list: "reading", readingKind: "video", rule: "video-host" }],

  // Tier 4 — articles
  ["https://blog.cloudflare.com/foo",             { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://example.substack.com/p/hello",        { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://medium.com/@author/post",             { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://dev.to/foo/bar",                      { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://example.com/blog/post-1",             { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://example.com/articles/x",              { list: "reading", readingKind: "article", rule: "article-host" }],

  // Tier 5 — ambiguous hosts trigger familiar fallback
  ["https://twitter.com/foo/status/1",            { rule: "familiar-fallback" }],
  ["https://x.com/foo/status/1",                  { rule: "familiar-fallback" }],
  ["https://news.ycombinator.com/item?id=1",      { rule: "familiar-fallback" }],
  ["https://reddit.com/r/foo/comments/1/x",      { rule: "familiar-fallback" }],

  // Default — bookmark
  ["https://docs.python.org/3/",                  { list: "bookmarks", rule: "default-bookmark" }],
  ["https://example.com",                         { list: "bookmarks", rule: "default-bookmark" }],
  ["https://example.com/tools/foo",               { list: "bookmarks", rule: "default-bookmark" }],
];

for (const [url, want] of CLASSIFY_CASES) {
  const got = classifyLink(url);
  for (const key of Object.keys(want)) {
    assert.equal(got[key], want[key], `classifyLink(${url}).${key} = ${got[key]}; want ${want[key]}`);
  }
}

// parseGitHubUrl coverage
assert.deepStrictEqual(parseGitHubUrl("https://github.com/foo/bar"), { repo: "foo/bar", kind: "repo" });
assert.deepStrictEqual(parseGitHubUrl("https://github.com/foo/bar/issues/12"), { repo: "foo/bar", kind: "issue", number: 12 });
assert.deepStrictEqual(parseGitHubUrl("https://github.com/foo/bar/pull/45"), { repo: "foo/bar", kind: "pr", number: 45 });
assert.deepStrictEqual(parseGitHubUrl("https://github.com/foo/bar/discussions/9"), { repo: "foo/bar", kind: "discussion", number: 9 });
assert.equal(parseGitHubUrl("https://example.com/foo/bar"), null);

console.log(`classifyLink: ${CLASSIFY_CASES.length} cases + parseGitHubUrl: 5 cases passed`);
