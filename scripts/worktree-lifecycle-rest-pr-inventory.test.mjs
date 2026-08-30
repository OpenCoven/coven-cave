import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyLifecycleInventoryFailure,
  filterBeadsInventoryStderr,
  formatLifecycleInventoryFailure,
  parseRestPullRequestLines,
  parseRestPullRequestPages,
} from "./worktree-lifecycle-inventory.ts";
import { nodeArgsFor } from "./run-tests.mjs";

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
  assert.match(source, /"--jq"/);
});

test("Beads role guidance is ignorable, while unrelated stderr remains an inventory error", () => {
  assert.equal(
    filterBeadsInventoryStderr(
      "warning: beads.role not configured (GH#2950).\n    Fix: git config beads.role maintainer\n",
    ),
    "",
  );
  assert.equal(
    filterBeadsInventoryStderr(
      "warning: beads.role not configured (GH#2950).\n\n    Fix: git config beads.role contributor\nBeads inventory omitted records\n",
    ),
    "Beads inventory omitted records",
  );
  assert.equal(
    filterBeadsInventoryStderr("Fix: git config beads.role maintainer\n"),
    "Fix: git config beads.role maintainer",
    "a fix line without its warning is not silently discarded",
  );
});

test("exit-1 inventory diagnostics distinguish bd execution from transient GitHub failures", () => {
  assert.equal(
    classifyLifecycleInventoryFailure(
      "Beads CLI could not be executed: spawnSync bd ENOENT",
    ),
    "beads-execution",
  );
  assert.equal(
    classifyLifecycleInventoryFailure(
      "pull request inventory could not query GitHub — API rate limit exceeded",
    ),
    "github-transient",
  );
  assert.equal(
    classifyLifecycleInventoryFailure("Beads inventory returned malformed data"),
    "inventory",
  );
  assert.match(
    formatLifecycleInventoryFailure(["Beads CLI could not be executed: spawnSync bd ENOENT"]),
    /could not execute bd/i,
  );
  assert.match(
    formatLifecycleInventoryFailure([
      "pull request inventory could not query GitHub — API rate limit exceeded",
    ]),
    /inventory is unavailable.*transient GitHub\/GraphQL.*retry/i,
  );
});

test("the normal test runner enables TypeScript stripping for this suite", () => {
  assert.ok(
    nodeArgsFor("scripts/worktree-lifecycle-rest-pr-inventory.test.mjs").includes(
      "--experimental-strip-types",
    ),
  );
});

test("projected REST JSONL stays bounded without losing branch inventory fields", () => {
  const line = JSON.stringify({
    number: 4989,
    html_url: "https://github.com/OpenCoven/coven-cave/pull/4989",
    state: "open",
    draft: false,
    merged_at: null,
    head: {
      ref: "fix/cave-zxgjs-rest-pr-inventory",
      sha: "c".repeat(40),
      repo: { full_name: "OpenCoven/coven-cave" },
    },
    base: { ref: "main", repo: { full_name: "OpenCoven/coven-cave" } },
  });
  assert.deepEqual(
    parseRestPullRequestLines(`${line}\n${line}\n`, "OpenCoven/coven-cave"),
    [
      {
        number: 4989,
        url: "https://github.com/OpenCoven/coven-cave/pull/4989",
        state: "OPEN",
        isDraft: false,
        mergedAt: null,
        headRefName: "fix/cave-zxgjs-rest-pr-inventory",
        headRefOid: "c".repeat(40),
        headRepository: "OpenCoven/coven-cave",
        baseRefName: "main",
        baseRepository: "OpenCoven/coven-cave",
      },
    ],
  );
});
