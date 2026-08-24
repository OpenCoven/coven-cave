import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseRestPullRequestPages } from "./worktree-lifecycle-inventory.ts";

const inventorySource = readFileSync(
  new URL("./worktree-lifecycle-inventory.ts", import.meta.url),
  "utf8",
);

test("REST pull request pages preserve lifecycle fields and deduplicate identical pages", () => {
  const pull = {
    number: 4979,
    html_url: "https://github.com/OpenCoven/coven-cave/pull/4979",
    state: "closed",
    draft: false,
    merged_at: "2026-08-24T14:12:15Z",
    head: {
      ref: "feat/cave-yssqw-surface-toolbar",
      sha: "b".repeat(40),
      repo: { full_name: "OpenCoven/coven-cave" },
    },
    base: {
      ref: "main",
      repo: { full_name: "OpenCoven/coven-cave" },
    },
  };

  assert.deepEqual(
    parseRestPullRequestPages(JSON.stringify([[pull], [pull]]), "OpenCoven/coven-cave"),
    [
      {
        number: 4979,
        url: pull.html_url,
        state: "MERGED",
        isDraft: false,
        mergedAt: pull.merged_at,
        headRefName: pull.head.ref,
        headRefOid: pull.head.sha,
        headRepository: pull.head.repo.full_name,
        baseRefName: pull.base.ref,
        baseRepository: pull.base.repo.full_name,
      },
    ],
  );
});

test("the lifecycle PR inventory uses REST endpoints and never invokes GraphQL", () => {
  const start = inventorySource.indexOf("function fetchPullRequests(");
  const end = inventorySource.indexOf("\nfunction lifecycleUnitKey(", start);
  assert.ok(start >= 0 && end > start, "fetchPullRequests source boundary exists");
  const source = inventorySource.slice(start, end);

  assert.doesNotMatch(source, /["']graphql["']/, "inventory must not spend GraphQL quota");
  assert.match(source, /commits\/\$\{encodeURIComponent\(oid\)\}\/pulls\?per_page=100/);
  assert.match(source, /pulls\?state=all&per_page=100/);
});
