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
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

// --- WEDGED: unfinished git operations (cave-97svy) ---------------------------
// A worktree paused mid-merge is indistinguishable from one a session is
// actively editing if the only signal is "N dirty" — which is how an abandoned
// merge survived four days and several sessions that each backed off from it.
// These cases pin the distinction the WEDGED verdict draws.

function gitAllowFail(cwd, ...args) {
  try {
    return { ok: true, out: git(cwd, ...args) };
  } catch (error) {
    return { ok: false, out: String(error?.stdout || "") };
  }
}

/** Leave `wt` stopped on a merge conflict against a sibling branch. */
function wedgeOnMergeConflict(dir, wt, branch) {
  git(dir, "branch", "other", "main");
  const otherWt = join(dir, `${branch.replace(/\W/g, "-")}-other`);
  git(dir, "worktree", "add", "-q", otherWt, "other");
  writeFileSync(join(otherWt, "clash.txt"), "theirs\n");
  git(otherWt, "add", "-A");
  git(otherWt, "commit", "-qm", "theirs");

  writeFileSync(join(wt, "clash.txt"), "ours\n");
  git(wt, "add", "-A");
  git(wt, "commit", "-qm", "ours");

  const merged = gitAllowFail(wt, "merge", "other");
  assert.equal(merged.ok, false, "the merge must stop on a conflict for this fixture to mean anything");
}

function rowByBranch(dir, branch) {
  return JSON.parse(run(dir, "--json")).rows.find((r) => r.branch === branch);
}

function rowByPath(dir, suffix, ...flags) {
  return JSON.parse(run(dir, "--json", ...flags)).rows.find((r) => r.path.endsWith(suffix));
}

test("a worktree paused mid-merge is WEDGED, not DIRTY", () => {
  const dir = scaffold();
  try {
    const wt = join(dir, "wt-wedged");
    git(dir, "worktree", "add", "-q", "-b", "feat/wedged", wt, "main");
    wedgeOnMergeConflict(dir, wt, "feat/wedged");

    const row = rowByBranch(dir, "feat/wedged");
    assert.equal(row.verdict, "WEDGED");
    assert.equal(row.wedge.op, "merge");
    assert.equal(row.wedge.marker, "MERGE_HEAD");
    assert.deepEqual(row.wedge.unmerged, ["clash.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WEDGED reports no hand resolution when nothing was touched after the stall", () => {
  const dir = scaffold();
  try {
    const wt = join(dir, "wt-abandoned");
    git(dir, "worktree", "add", "-q", "-b", "feat/abandoned", wt, "main");
    wedgeOnMergeConflict(dir, wt, "feat/abandoned");

    // Nobody has edited anything since git wrote the conflict, so an abort
    // cannot destroy a resolution that does not exist.
    const row = rowByBranch(dir, "feat/abandoned");
    assert.equal(row.wedge.touchedSince.readable, true);
    assert.equal(row.wedge.touchedSince.tracked, 0);

    const human = run(dir);
    assert.match(human, /no tracked file touched since the merge stalled/);
    assert.match(human, /git merge --abort/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WEDGED warns against aborting when a conflict was hand-resolved after the stall", () => {
  const dir = scaffold();
  try {
    const wt = join(dir, "wt-resolving");
    git(dir, "worktree", "add", "-q", "-b", "feat/resolving", wt, "main");
    wedgeOnMergeConflict(dir, wt, "feat/resolving");

    // Backdate the marker so the conflicted file reads as edited AFTER the
    // merge stalled — the shape of a human part-way through a resolution.
    const gitDir = git(wt, "rev-parse", "--path-format=absolute", "--git-dir");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(join(gitDir, "MERGE_HEAD"), twoHoursAgo, twoHoursAgo);

    const row = rowByBranch(dir, "feat/resolving");
    assert.equal(row.verdict, "WEDGED");
    assert.ok(row.wedge.touchedSince.tracked > 0, "the conflicted file postdates the stall");
    assert.ok(row.wedge.ageHours >= 1.5, `expected a ~2h age, got ${row.wedge.ageHours}`);

    const human = run(dir);
    assert.match(human, /edited SINCE the merge stalled/);
    assert.match(human, /do NOT abort/);
    assert.match(human, /only with the owner's say-so/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a paused rebase is WEDGED and offers rebase-shaped remedies", () => {
  const dir = scaffold();
  try {
    const wt = join(dir, "wt-rebase");
    git(dir, "worktree", "add", "-q", "-b", "feat/rebasing", wt, "main");

    // Give main and the branch conflicting edits to the same file, then rebase.
    writeFileSync(join(dir, "clash.txt"), "main side\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "main side");
    writeFileSync(join(wt, "clash.txt"), "branch side\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-qm", "branch side");

    const rebased = gitAllowFail(wt, "rebase", "main");
    assert.equal(rebased.ok, false, "the rebase must stop on a conflict");

    // A stopped rebase detaches HEAD, so the tree has no branch to look up —
    // exactly the case that would otherwise fall through to SCRATCH and read as
    // a harmless scratch checkout.
    const row = rowByPath(dir, "wt-rebase");
    assert.equal(row.verdict, "WEDGED");
    assert.equal(row.wedge.op, "rebase");

    const human = run(dir);
    assert.match(human, /git rebase --continue/);
    assert.match(human, /git rebase --abort/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--prune never offers to remove a WEDGED worktree, however merged it looks", () => {
  const dir = scaffold();
  try {
    // Judged against a default branch that already contains it, this tree is a
    // retirement candidate — and removing it would silently discard the paused
    // operation along with it.
    const wt = join(dir, "wt-merged-wedged");
    git(dir, "worktree", "add", "-q", "-b", "feat/merged-wedged", wt, "main");
    wedgeOnMergeConflict(dir, wt, "feat/merged-wedged");
    git(dir, "branch", "contains-it", "feat/merged-wedged");
    const env = { ...process.env, WT_DEFAULT_BRANCH: "contains-it" };

    const row = rowByPath(dir, "wt-merged-wedged");
    assert.equal(row.verdict, "WEDGED", "the wedge must outrank the retirement verdict");

    const out = execFileSync("node", [script, "--prune"], { cwd: dir, encoding: "utf8", env });
    assert.doesNotMatch(out, /wt-merged-wedged/);
    assert.doesNotMatch(out, /feat\/merged-wedged/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
