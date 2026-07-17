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

assert.match(
  source,
  /function gitStatus[\s\S]*\["-c", "core\.fsmonitor=false", "status", \.\.\.args\]/,
  "git status calls must disable repository-configured fsmonitor commands",
);

assert.match(
  source,
  /gitStatus\(repoRoot, \["--porcelain=v1", "-z", "--untracked-files=all"\]\)/,
  "change-list status polling must use the hardened gitStatus helper",
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
  /NextResponse\.json\(\{ ok: true, repo: true, repoRoot, branch, files \}\)/,
  "the change-list response includes the branch field",
);

console.log("changes route.test.ts: ok");
