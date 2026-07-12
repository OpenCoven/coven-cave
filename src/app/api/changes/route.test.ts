// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /function gitDiff[\s\S]*\["diff", "--no-ext-diff", "--no-textconv", \.\.\.args\]/,
  "git diff calls must disable external diff helpers and textconv filters",
);

assert.doesNotMatch(
  source,
  /git\(repoRoot, \["diff"/,
  "changes route should use gitDiff for every git diff invocation",
);


// The status GET carries the current branch (Projects hub Git section) — from
// the existing currentBranch() helper, omitted on unborn repos.
assert.match(
  source,
  /branch = await currentBranch\(repoRoot\);/,
  "listChanges resolves the current branch via the shared helper",
);
assert.match(
  source,
  /NextResponse\.json\(\{ ok: true, repo: true, repoRoot, branch, worktree, files \}\)/,
  "the change-list response includes the branch and worktree fields",
);

// Linked-worktree detection compares --git-dir with --git-common-dir (they
// only differ in a `git worktree` checkout) — never a path-name heuristic.
assert.match(
  source,
  /\["rev-parse", "--git-dir", "--git-common-dir"\]/,
  "worktreeName resolves worktree-ness from git itself",
);

// PR context (?pr=1) goes through ghCli (execFile, no shell) and the branch
// PR's URL must match the pinned github.com PR shape before it is returned.
assert.match(
  source,
  /ghCli\(repoRoot, \[\s*"pr", "view", branch, "--json", "number,url,state,isDraft",\s*\]\)/,
  "branchPr reads the branch PR via the gh CLI helper",
);
assert.match(
  source,
  /PR_URL_RE\.test\(parsed\.url\)/,
  "branchPr validates the PR URL shape before returning it",
);

console.log("changes route.test.ts: ok");
