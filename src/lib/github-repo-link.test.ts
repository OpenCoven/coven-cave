// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";

import { gitHubRepoSlug, normalizeGitHubRepoUrl } from "./github-repo-link.ts";

const CANONICAL = "https://github.com/OpenCoven/coven-cave";

test("every accepted spelling normalizes to the canonical https link", () => {
  const accepted = [
    "https://github.com/OpenCoven/coven-cave",
    "https://github.com/OpenCoven/coven-cave/",
    "https://github.com/OpenCoven/coven-cave.git",
    "http://github.com/OpenCoven/coven-cave",
    "https://www.github.com/OpenCoven/coven-cave",
    "github.com/OpenCoven/coven-cave",
    "www.github.com/OpenCoven/coven-cave",
    "OpenCoven/coven-cave",
    "  OpenCoven/coven-cave  ",
    "git@github.com:OpenCoven/coven-cave.git",
    "git@github.com:OpenCoven/coven-cave",
  ];
  for (const input of accepted) {
    assert.equal(normalizeGitHubRepoUrl(input), CANONICAL, `should accept ${JSON.stringify(input)}`);
  }
});

test("deep URLs still identify the repository; deep bare slugs do not", () => {
  // Pasting a PR/file/issues URL links the repo it belongs to.
  assert.equal(normalizeGitHubRepoUrl("https://github.com/OpenCoven/coven-cave/pull/123"), CANONICAL);
  assert.equal(normalizeGitHubRepoUrl("https://github.com/OpenCoven/coven-cave/tree/main/src"), CANONICAL);
  assert.equal(normalizeGitHubRepoUrl("https://github.com/OpenCoven/coven-cave?tab=readme"), CANONICAL);
  assert.equal(normalizeGitHubRepoUrl("https://github.com/OpenCoven/coven-cave#readme"), CANONICAL);
  // A bare three-segment slug is ambiguous, not a repo reference.
  assert.equal(normalizeGitHubRepoUrl("OpenCoven/coven-cave/extra"), null);
});

test("non-GitHub hosts, schemes, and malformed slugs are rejected", () => {
  const rejected = [
    "",
    "   ",
    "coven-cave",
    "https://gitlab.com/OpenCoven/coven-cave",
    "https://github.evil.com/OpenCoven/coven-cave",
    "https://evilgithub.com/OpenCoven/coven-cave",
    "ftp://github.com/OpenCoven/coven-cave",
    "javascript://github.com/OpenCoven/coven-cave",
    "git@gitlab.com:OpenCoven/coven-cave.git",
    "https://github.com/OpenCoven",
    "github.com/OpenCoven",
    "-bad-owner/repo",
    "bad-owner-/repo",
    "owner/..",
    "owner/.",
    "own er/repo",
    "owner/re po",
  ];
  for (const input of rejected) {
    assert.equal(normalizeGitHubRepoUrl(input), null, `should reject ${JSON.stringify(input)}`);
  }
  assert.equal(normalizeGitHubRepoUrl(null), null);
  assert.equal(normalizeGitHubRepoUrl(undefined), null);
});

test("owner charset is the GitHub contract — 39 max, no edge hyphens", () => {
  const owner39 = "a".repeat(39);
  assert.equal(normalizeGitHubRepoUrl(`${owner39}/repo`), `https://github.com/${owner39}/repo`);
  assert.equal(normalizeGitHubRepoUrl(`${"a".repeat(40)}/repo`), null);
  assert.equal(normalizeGitHubRepoUrl("mid-hyphen/repo.name_ok"), "https://github.com/mid-hyphen/repo.name_ok");
});

test("gitHubRepoSlug renders owner/repo for stored links", () => {
  assert.equal(gitHubRepoSlug(CANONICAL), "OpenCoven/coven-cave");
  assert.equal(gitHubRepoSlug("not a link"), null);
  assert.equal(gitHubRepoSlug(null), null);
});
