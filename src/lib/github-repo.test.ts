// @ts-nocheck
import assert from "node:assert/strict";
import { parseRepoSlug, fetchRepoOverview, formatCount, absolutizeGitHubReadme } from "./github-repo.ts";

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
  const acceptHeaders = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push(String(url));
    acceptHeaders.push(opts.headers?.Accept ?? opts.headers?.accept ?? "");
    if (String(url).endsWith("/readme") && opts.headers?.Accept === "application/vnd.github.html+json") {
      return new Response("<article><h1>Hello</h1><ul class=\"contains-task-list\"><li><input type=\"checkbox\" checked> done</li></ul></article>", { status: 200 });
    }
    if (String(url).endsWith("/readme")) return new Response("# Hello\n\n- [x] done", { status: 200 });
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
      owner: { avatar_url: "https://avatars.githubusercontent.com/u/14985020?v=4" },
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
  assert.equal(out.meta.ownerAvatar, "https://avatars.githubusercontent.com/u/14985020?v=4", "carries owner avatar");
  assert.match(out.meta.openGraphImage, /^https:\/\/opengraph\.githubassets\.com\/\d+\/vercel\/next\.js$/, "social card url with push-derived cache key");
  assert.equal(out.readme, "# Hello\n\n- [x] done");
  assert.match(out.readmeHtml, /contains-task-list/, "returns GitHub-rendered README HTML for GFM features");
  assert.equal(calls.length, 3, "fetched meta + rendered README HTML + raw README markdown");
  assert.deepEqual(
    acceptHeaders.slice(1),
    ["application/vnd.github.html+json", "application/vnd.github.raw+json"],
    "README requests should ask GitHub for rendered HTML before raw markdown fallback",
  );
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
  assert.equal(out.readmeHtml, null, "no readme -> null rendered HTML");
})();

assert.ok((await fetchRepoOverview("not a repo", { fetchImpl: async () => new Response("{}") })).error, "bad input -> error");

// ── absolutizeGitHubReadme ──────────────────────────────────────
{
  const opts = { owner: "acme", repo: "widget", branch: "main" };
  const abs = (md) => absolutizeGitHubReadme(md, opts);

  // Relative image → raw.githubusercontent.com
  assert.equal(
    abs("![logo](docs/logo.png)"),
    "![logo](https://raw.githubusercontent.com/acme/widget/main/docs/logo.png)",
    "relative image -> raw host",
  );
  // ./ prefix and title are preserved
  assert.equal(
    abs('![banner](./assets/b.svg "Banner")'),
    '![banner](https://raw.githubusercontent.com/acme/widget/main/assets/b.svg "Banner")',
    "leading ./ and title preserved",
  );
  // Root-relative (leading /) is repo-root-relative, not host-absolute
  assert.equal(
    abs("![x](/img/x.png)"),
    "![x](https://raw.githubusercontent.com/acme/widget/main/img/x.png)",
    "leading slash treated as repo-root relative",
  );
  // Relative doc link → github.com/blob
  assert.equal(
    abs("[contributing](CONTRIBUTING.md)"),
    "[contributing](https://github.com/acme/widget/blob/main/CONTRIBUTING.md)",
    "relative link -> blob view",
  );
  // Absolute URLs, protocol-relative, and anchors are untouched
  assert.equal(abs("![a](https://cdn.example.com/a.png)"), "![a](https://cdn.example.com/a.png)", "absolute image untouched");
  assert.equal(abs("![a](//cdn.example.com/a.png)"), "![a](//cdn.example.com/a.png)", "protocol-relative untouched");
  assert.equal(abs("[top](#intro)"), "[top](#intro)", "in-page anchor untouched");
  assert.equal(abs("[mail](mailto:a@b.co)"), "[mail](mailto:a@b.co)", "mailto untouched");
  // HTML <img> and <a> are rewritten
  assert.match(abs('<img src="hero.png" width="600">'), /src="https:\/\/raw\.githubusercontent\.com\/acme\/widget\/main\/hero\.png"/, "html img src rewritten");
  assert.match(abs('<a href="docs/guide.md">Guide</a>'), /href="https:\/\/github\.com\/acme\/widget\/blob\/main\/docs\/guide\.md"/, "html anchor href rewritten");
  // Reference-style definitions: image ext -> raw, other -> blob
  assert.match(abs("[logo]: images/logo.png"), /images\/logo\.png/, "ref def rewritten");
  assert.match(abs("[logo]: images/logo.png"), /raw\.githubusercontent\.com/, "image ref def -> raw host");
  assert.match(abs("[spec]: SPEC.md"), /github\.com\/acme\/widget\/blob/, "non-image ref def -> blob host");
  // Code spans are never rewritten
  assert.equal(abs("`![x](y.png)`"), "`![x](y.png)`", "inline code untouched");
  assert.equal(
    abs("```\n![x](y.png)\n```"),
    "```\n![x](y.png)\n```",
    "fenced code untouched",
  );
  // Missing branch falls back to HEAD
  assert.match(
    absolutizeGitHubReadme("![x](a.png)", { owner: "o", repo: "r" }),
    /raw\.githubusercontent\.com\/o\/r\/HEAD\/a\.png/,
    "missing branch -> HEAD",
  );
  // Empty input is a no-op
  assert.equal(abs(""), "", "empty input");
}

console.log("github-repo.test.ts passed");
