// @ts-nocheck
import assert from "node:assert/strict";
import { parseGitHubItemUrl } from "./github-item-url.ts";

// ── PR / issue URLs parse into native deep-link targets ──────────────────────
assert.deepEqual(parseGitHubItemUrl("https://github.com/OpenCoven/coven-cave/pull/3132"), {
  repo: "OpenCoven/coven-cave",
  number: 3132,
  kind: "pr",
  url: "https://github.com/OpenCoven/coven-cave/pull/3132",
});
assert.equal(parseGitHubItemUrl("https://github.com/owner/repo/issues/7")?.kind, "issue");
assert.equal(parseGitHubItemUrl("https://github.com/owner/repo/issues/7")?.number, 7);

// Trailing paths, fragments, query strings, and www are tolerated.
assert.equal(parseGitHubItemUrl("https://github.com/o/r/pull/12/files")?.number, 12);
assert.equal(parseGitHubItemUrl("https://github.com/o/r/pull/12#issuecomment-99")?.number, 12);
assert.equal(parseGitHubItemUrl("https://www.github.com/o/r/issues/3?foo=1")?.repo, "o/r");
assert.equal(parseGitHubItemUrl("  https://github.com/o/r/pull/5  ")?.number, 5, "whitespace trimmed");
assert.equal(parseGitHubItemUrl("https://github.com/o/my.repo-name/pull/5")?.repo, "o/my.repo-name");

// ── Everything else falls back to the browser pane (null) ────────────────────
assert.equal(parseGitHubItemUrl("https://github.com/o/r/actions/runs/123456"), null, "CI runs are not item targets");
assert.equal(parseGitHubItemUrl("https://github.com/o/r"), null, "repo root");
assert.equal(parseGitHubItemUrl("https://github.com/o/r/pull/abc"), null, "non-numeric number");
assert.equal(parseGitHubItemUrl("https://github.com/o/r/pull/0"), null, "zero is not a valid number");
assert.equal(parseGitHubItemUrl("https://github.com/o/r/pull/1x"), null, "trailing junk in number segment");
assert.equal(parseGitHubItemUrl("https://gitlab.com/o/r/issues/1"), null, "other hosts");
assert.equal(parseGitHubItemUrl("https://evil.example/github.com/o/r/pull/1"), null, "host must be github.com");
assert.equal(parseGitHubItemUrl("ftp://github.com/o/r/pull/1"), null, "non-http(s) scheme");
assert.equal(parseGitHubItemUrl("not a url"), null);
assert.equal(parseGitHubItemUrl(""), null);
assert.equal(parseGitHubItemUrl(null), null);
assert.equal(parseGitHubItemUrl(undefined), null);

console.log("github-item-url.test.ts: ok");
