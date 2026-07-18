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

// ── Branch menu (?branches=1, switch-branch, create-worktree) ────────────────

// Every user-supplied branch name is gated by the shared strict allow-list
// BEFORE it can reach a git argv — both actions, plus the client mirrors it.
assert.match(
  source,
  /if \(action === "switch-branch"\) \{[\s\S]*?if \(!isSafeBranchName\(branch\)\) \{/,
  "switch-branch validates the branch name with the shared strict rule",
);
assert.match(
  source,
  /if \(action === "create-worktree"\) \{[\s\S]*?if \(!isSafeBranchName\(branch\)\) \{/,
  "create-worktree validates the branch name with the shared strict rule",
);

// switch-branch requires the ref to already exist (local or origin) and uses
// `git switch` — carrying edits when safe, surfacing git's refusal otherwise —
// never a forced checkout.
assert.match(
  source,
  /refExists\(root\.repoRoot, `refs\/heads\/\$\{branch\}`\)/,
  "switch-branch checks for the local ref before switching",
);
assert.match(
  source,
  /refExists\(root\.repoRoot, `refs\/remotes\/origin\/\$\{branch\}`\)/,
  "switch-branch accepts an origin-only branch (git switch dwims the tracking branch)",
);
assert.match(
  source,
  /await git\(root\.repoRoot, \["switch", branch\]\);/,
  "the switch is a plain `git switch` via the argv helper (no shell, no -f)",
);
assert.doesNotMatch(
  source,
  /"switch", "-f"|"switch", "--force"|"checkout", "-f"/,
  "branch switching must never force-discard local state",
);

// create-worktree delegates to the shared provisioning lib (containment under
// .worktrees/, idempotent reuse, origin/main base) rather than reimplementing.
assert.match(
  source,
  /provisionBranchWorktree\(\s*root\.repoRoot,\s*branch,/,
  "create-worktree provisions through the shared issue-worktree-provision lib",
);

// The branch listing marks the current branch and which worktree holds each
// checked-out branch, so the menu can disable non-switchable rows.
assert.match(
  source,
  /\["for-each-ref", "refs\/heads", "--sort=-committerdate", "--format=%\(refname:short\)"\]/,
  "listBranches reads local branches newest-first via for-each-ref",
);
assert.match(
  source,
  /\["worktree", "list", "--porcelain"\]/,
  "listBranches maps branches to their checkouts from the porcelain worktree list",
);
assert.match(
  source,
  /if \(wantBranches !== null\) return await listBranches\(root\.repoRoot\);/,
  "the GET handler routes ?branches=1 to the branch listing",
);
assert.match(
  source,
  /if \(\/\^__\.\*__\$\/\.test\(name\)\) continue;/,
  "tool-internal dunder refs (beads' __dolt_remote_info__) stay out of the menu",
);

assert.match(
  source,
  /function isChangedFile[\s\S]*?changedFilePaths[\s\S]*?parsePorcelainZ/,
  "direct diff/revert requests must be authorized against git status, not guessed ignored files",
);
assert.match(
  source,
  /function changedFilePaths[\s\S]*?gitStatus\(repoRoot, \["--porcelain=v1", "-z", "--untracked-files=all"\]\)/,
  "the diff/revert authorization set must come from the hardened gitStatus helper (fsmonitor disabled)",
);
assert.match(
  source,
  /if \(!\(await isChangedFile\(root\.repoRoot, filePath\)\)\) return pathNotAllowed\(\);/,
  "single-file diff requests should only serve paths present in git status",
);
assert.match(
  source,
  /if \(!\(await isChangedFile\(root\.repoRoot, body\.path\)\)\) return pathNotAllowed\(\);/,
  "revert requests should only operate on paths present in git status",
);

console.log("changes route.test.ts: ok");
