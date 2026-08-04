// Unit coverage for the local worktree status dashboard (scripts/worktree-status.mjs).
//
// The dashboard drives retirement decisions ("what is safe to remove"), so its
// verdict classification is the thing worth pinning: a false SAFE-RETIRE on a
// tree that still holds unmerged or uncommitted work is exactly the data loss
// this repo's worktree tooling exists to prevent. Each case below builds a
// throwaway repo with one worktree in a known state and asserts the verdict the
// script prints via --json; a final case asserts --prune emits commands for the
// SAFE-RETIRE tree only and never for anything else.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts", "worktree-status.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    // Never sign or run hooks in the throwaway repo.
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

/**
 * A throwaway repo on `main` with one commit, plus whatever worktrees a case
 * adds. Returns the repo dir; caller cleans it up.
 */
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), "wt-status-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return dir;
}

function run(dir, ...flags) {
  return execFileSync("node", [script, ...flags], { cwd: dir, encoding: "utf8" });
}

function verdictByBranch(dir) {
  const parsed = JSON.parse(run(dir, "--json"));
  const map = new Map();
  for (const row of parsed.rows) if (row.branch) map.set(row.branch, row.verdict);
  return map;
}

test("merged + clean worktree is SAFE-RETIRE", () => {
  const dir = scaffold();
  try {
    // Branch points at the main tip and its worktree is clean.
    git(dir, "branch", "feat/merged-clean", "main");
    git(dir, "worktree", "add", "-q", join(dir, "wt-a"), "feat/merged-clean");
    assert.equal(verdictByBranch(dir).get("feat/merged-clean"), "SAFE-RETIRE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merged worktree with uncommitted work is SALVAGE, not SAFE-RETIRE", () => {
  const dir = scaffold();
  try {
    git(dir, "worktree", "add", "-q", "-b", "fix/merged-dirty", join(dir, "wt-b"), "main");
    writeFileSync(join(dir, "wt-b", "scratch.txt"), "uncommitted\n");
    assert.equal(verdictByBranch(dir).get("fix/merged-dirty"), "SALVAGE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unmerged commits ahead of main are ACTIVE when clean", () => {
  const dir = scaffold();
  try {
    git(dir, "worktree", "add", "-q", "-b", "feat/ahead-clean", join(dir, "wt-c"), "main");
    writeFileSync(join(dir, "wt-c", "feature.txt"), "work\n");
    git(join(dir, "wt-c"), "add", "-A");
    git(join(dir, "wt-c"), "commit", "-qm", "feature");
    assert.equal(verdictByBranch(dir).get("feat/ahead-clean"), "ACTIVE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unmerged + uncommitted work is DIRTY", () => {
  const dir = scaffold();
  try {
    git(dir, "worktree", "add", "-q", "-b", "feat/ahead-dirty", join(dir, "wt-d"), "main");
    git(join(dir, "wt-d"), "commit", "-qm", "ahead", "--allow-empty");
    writeFileSync(join(dir, "wt-d", "scratch.txt"), "uncommitted\n");
    assert.equal(verdictByBranch(dir).get("feat/ahead-dirty"), "DIRTY");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rev-list failure fails closed to SCRATCH, never SAFE-RETIRE", () => {
  const dir = scaffold();
  try {
    // A clean worktree at the main tip — normally the clearest SAFE-RETIRE.
    git(dir, "branch", "feat/x", "main");
    git(dir, "worktree", "add", "-q", join(dir, "wt-x"), "feat/x");
    // Compare against a branch that does not exist, so
    // `rev-list <default>...feat/x` errors. A false SAFE-RETIRE here is exactly
    // the data-loss bug the fail-closed rule guards against: the script must
    // degrade to SCRATCH, not imply "merged/identical, safe to delete".
    const out = execFileSync("node", [script, "--json"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, WT_DEFAULT_BRANCH: "no-such-branch" },
    });
    const row = JSON.parse(out).rows.find((r) => r.branch === "feat/x");
    assert.equal(row.verdict, "SCRATCH");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--prune emits remove commands only for the SAFE-RETIRE tree", () => {
  const dir = scaffold();
  try {
    git(dir, "worktree", "add", "-q", "-b", "feat/safe", join(dir, "wt-safe"), "main");
    git(dir, "worktree", "add", "-q", "-b", "feat/live", join(dir, "wt-live"), "main");
    git(join(dir, "wt-live"), "commit", "-qm", "ahead", "--allow-empty");
    const out = run(dir, "--prune");
    assert.match(out, /git worktree remove '[^']*wt-safe'/);
    assert.match(out, /git branch -d 'feat\/safe'/);
    assert.doesNotMatch(out, /wt-live/);
    assert.doesNotMatch(out, /feat\/live/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
