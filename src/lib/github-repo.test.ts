// @ts-nocheck
import assert from "node:assert/strict";
import { parseRepoSlug, fetchRepoOverview, formatCount } from "./github-repo.ts";

// ── parseRepoSlug ───────────────────────────────────────────────
assert.deepEqual(parseRepoSlug("vercel/next.js"), { owner: "vercel", repo: "next.js" }, "owner/name slug");
assert.deepEqual(parseRepoSlug("https://github.com/vercel/next.js"), { owner: "vercel", repo: "next.js" }, "https url");
assert.deepEqual(parseRepoSlug("https://github.com/vercel/next.js/issues/42"), { owner: "vercel", repo: "next.js" }, "url with extra path");
assert.deepEqual(parseRepoSlug("github.com/openai/whisper.git"), { owner: "openai", repo: "whisper" }, "strips .git");
assert.deepEqual(parseRepoSlug("https://www.github.com/a/b"), { owner: "a", repo: "b" }, "www host");
assert.equal(parseRepoSlug(""), null, "empty");
assert.equal(parseRepoSlug("just-one-segment"), null, "missing repo");
assert.equal(parseRepoSlug("https://gitlab.com/a/b"), null, "non-github host");
assert.equal(parseRepoSlug("a b/c d"), null, "rejects spaces");

// ── formatCount ─────────────────────────────────────────────────
assert.equal(formatCount(0), "0");
assert.equal(formatCount(999), "999");
assert.equal(formatCount(1000), "1k");
assert.equal(formatCount(1200), "1.2k");
assert.equal(formatCount(12300), "12.3k");
assert.equal(formatCount(125000), "125k");
assert.equal(formatCount(1_400_000), "1.4M");

// ── fetchRepoOverview (injected fetch) ──────────────────────────
function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

await (async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push(String(url));
    if (String(url).endsWith("/readme")) return new Response("# Hello\n\nbody", { status: 200 });
    return jsonResponse({
      full_name: "vercel/next.js",
      description: "The React Framework",
      html_url: "https://github.com/vercel/next.js",
      stargazers_count: 120000,
      forks_count: 25000,
      language: "JavaScript",
      topics: ["react", "ssr"],
      default_branch: "canary",
      pushed_at: "2026-06-20T00:00:00Z",
      license: { spdx_id: "MIT" },
      archived: false,
    });
  };
  const out = await fetchRepoOverview("vercel/next.js", { fetchImpl: fakeFetch });
  assert.ok(!("error" in out), "successful overview");
  assert.equal(out.meta.fullName, "vercel/next.js");
  assert.equal(out.meta.stars, 120000);
  assert.equal(out.meta.language, "JavaScript");
  assert.equal(out.meta.defaultBranch, "canary");
  assert.equal(out.meta.license, "MIT");
  assert.deepEqual(out.meta.topics, ["react", "ssr"]);
  assert.equal(out.readme, "# Hello\n\nbody");
  assert.equal(calls.length, 2, "fetched meta + readme");
})();

await (async () => {
  const fakeFetch = async () => new Response("not found", { status: 404 });
  const out = await fetchRepoOverview("ghost/missing", { fetchImpl: fakeFetch });
  assert.ok("error" in out, "404 -> error");
  assert.equal(out.status, 404);
})();

await (async () => {
  // Rate-limit: 403 with remaining=0 produces a helpful message.
  const fakeFetch = async () =>
    new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
  const out = await fetchRepoOverview("a/b", { fetchImpl: fakeFetch });
  assert.ok("error" in out, "403 -> error");
  assert.match(out.error, /rate limit/i, "rate-limit hint");
})();

await (async () => {
  // README missing (404) still yields an overview with null readme.
  const fakeFetch = async (url) => {
    if (String(url).endsWith("/readme")) return new Response("none", { status: 404 });
    return jsonResponse({ full_name: "a/b", default_branch: "main" });
  };
  const out = await fetchRepoOverview("a/b", { fetchImpl: fakeFetch });
  assert.ok(!("error" in out));
  assert.equal(out.readme, null, "no readme -> null");
})();

assert.ok((await fetchRepoOverview("not a repo", { fetchImpl: async () => new Response("{}") })).error, "bad input -> error");

console.log("github-repo.test.ts passed");
