// @ts-nocheck
import assert from "node:assert/strict";
import { isGithubSubTag, repoFromGithubSubTag } from "./github-sub-tags.ts";

// The two shapes github-watcher writes today.
assert.equal(repoFromGithubSubTag("github-sub:pr-opened:OpenCoven/coven-cave#3135"), "OpenCoven/coven-cave");
assert.equal(repoFromGithubSubTag("github-sub:ci:OpenCoven/coven-cave:987654"), "OpenCoven/coven-cave");
assert.equal(repoFromGithubSubTag("github-sub:pr-opened:o/my.repo-name#1"), "o/my.repo-name");

assert.equal(isGithubSubTag("github-sub:ci:o/r:1"), true);
assert.equal(isGithubSubTag("task-archive-nudge:x"), false);
assert.equal(isGithubSubTag(null), false);
assert.equal(isGithubSubTag(undefined), false);

// Non-subscription tags and malformed shapes return null.
assert.equal(repoFromGithubSubTag("task-archive-nudge:x"), null);
assert.equal(repoFromGithubSubTag("github-sub:"), null);
assert.equal(repoFromGithubSubTag("github-sub:pr-opened"), null, "no target");
assert.equal(repoFromGithubSubTag("github-sub:ci:not-a-repo:1"), null, "repo must be owner/name");
assert.equal(repoFromGithubSubTag("github-sub:pr-opened:owner-only#1"), null);
assert.equal(repoFromGithubSubTag(null), null);
assert.equal(repoFromGithubSubTag(undefined), null);

console.log("github-sub-tags.test.ts: ok");
