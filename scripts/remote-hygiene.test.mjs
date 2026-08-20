// Unit coverage for scripts/remote-hygiene.mjs (cave-u426u).
//
// Two things are worth pinning here, and they pull in opposite directions:
// the audit must actually catch the local state that clutters GitHub Desktop's
// branch list, and it must NOT "clean up" an accurate self-tracking upstream —
// `branch.X.remote` is one of three anti-resurrection signals the retention
// hook reads (cave-xjuup), and it is the only one that survives a
// `fetch --prune`. A tool that strips it would trade branch-list tidiness for
// resurrected merged heads.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyFixes, audit, classifyUpstreams } from "./remote-hygiene.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts", "remote-hygiene.mjs");

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
}

/** `git config --get` exits 1 when the key is unset; that is an answer, not an error. */
function configOrNull(cwd, key) {
  const result = spawnSync("git", ["config", "--get", key], { cwd, encoding: "utf8", env });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * A throwaway checkout with a real bare `origin` behind it, `main` pushed, and
 * the hygiene settings this repo expects already correct — so each case only
 * has to introduce the one defect it is about.
 */
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), "remote-hygiene-"));
  const origin = join(dir, "origin.git");
  const work = join(dir, "work");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "init", "-q", "-b", "main", work);
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "T");
  git(work, "config", "commit.gpgsign", "false");
  git(work, "config", "fetch.prune", "true");
  writeFileSync(join(work, "README.md"), "seed\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "seed");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "-u", "origin", "main");
  return { dir, origin, work };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function kinds(report) {
  return report.findings.map((f) => f.kind);
}

test("a correctly configured checkout audits clean", () => {
  const { dir, work } = scaffold();
  try {
    const report = audit(work);
    assert.deepEqual(kinds(report), []);
    assert.equal(report.ok, true);
    // `main` self-tracks after `push -u`; that is correct, not a finding.
    assert.deepEqual(report.selfTracking, ["main"]);
  } finally {
    cleanup(dir);
  }
});

test("a fork remote is reported and removed by --fix", () => {
  const { dir, work } = scaffold();
  try {
    const fork = join(dir, "fork.git");
    git(dir, "init", "-q", "--bare", "-b", "main", fork);
    git(work, "remote", "add", "someonesfork", fork);
    git(work, "push", "-q", "someonesfork", "main:feat/theirs");
    git(work, "fetch", "-q", "someonesfork");

    const before = audit(work);
    assert.ok(kinds(before).includes("foreign-remote"));

    applyFixes(work, before);
    assert.deepEqual(audit(work).findings, []);
    assert.equal(git(work, "remote"), "origin");
    // Removing the remote takes its tracking refs with it.
    assert.equal(git(work, "for-each-ref", "--format=%(refname)", "refs/remotes/someonesfork"), "");
  } finally {
    cleanup(dir);
  }
});

test("fetch.prune off is reported and set by --fix", () => {
  const { dir, work } = scaffold();
  try {
    git(work, "config", "--unset", "fetch.prune");
    assert.ok(kinds(audit(work)).includes("fetch-prune-off"));
    applyFixes(work, audit(work));
    assert.equal(git(work, "config", "--get", "fetch.prune"), "true");
  } finally {
    cleanup(dir);
  }
});

test("fetch.pruneTags true is a finding; unset is not", () => {
  const { dir, work } = scaffold();
  try {
    assert.ok(!kinds(audit(work)).includes("prune-tags-on"), "unset pruneTags is already correct");
    git(work, "config", "fetch.pruneTags", "true");
    assert.ok(kinds(audit(work)).includes("prune-tags-on"));
    applyFixes(work, audit(work));
    // Never pruned: archive/* and retention/* tags are the retention store.
    assert.equal(git(work, "config", "--get", "fetch.pruneTags"), "false");
  } finally {
    cleanup(dir);
  }
});

test("a stray PR ref whose tip is held elsewhere is deleted by --fix", () => {
  const { dir, work } = scaffold();
  try {
    const tip = git(work, "rev-parse", "main");
    git(work, "update-ref", "refs/remotes/pull/4753/head", tip);

    const before = audit(work);
    assert.ok(kinds(before).includes("stray-tracking-ref"));

    applyFixes(work, before);
    assert.equal(git(work, "for-each-ref", "--format=%(refname)", "refs/remotes/pull"), "");
    assert.deepEqual(audit(work).findings, []);
  } finally {
    cleanup(dir);
  }
});

test("a stray ref holding commits on no other ref is refused, not deleted", () => {
  const { dir, work } = scaffold();
  try {
    git(work, "checkout", "-q", "-b", "throwaway");
    writeFileSync(join(work, "only-here.txt"), "unique\n");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "only on the stray ref");
    const orphan = git(work, "rev-parse", "HEAD");
    git(work, "checkout", "-q", "main");
    git(work, "update-ref", "refs/remotes/pull/9/head", orphan);
    git(work, "branch", "-qD", "throwaway");

    const before = audit(work);
    assert.ok(kinds(before).includes("stray-tracking-ref-unretained"));
    assert.equal(
      before.findings.find((f) => f.kind === "stray-tracking-ref-unretained").safe,
      false,
      "an unretained tip must never be auto-deleted",
    );

    const { applied, refused } = applyFixes(work, before);
    assert.equal(applied.length, 0);
    assert.equal(refused.length, 1);
    assert.equal(git(work, "rev-parse", "refs/remotes/pull/9/head"), orphan, "the ref survives --fix");
  } finally {
    cleanup(dir);
  }
});

test("an accurate self-tracking upstream is never touched — it is a retention signal", () => {
  const { dir, work } = scaffold();
  try {
    git(work, "checkout", "-q", "-b", "fix/real-work");
    writeFileSync(join(work, "work.txt"), "x\n");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "work");
    git(work, "push", "-q", "-u", "origin", "fix/real-work");

    const report = audit(work);
    assert.deepEqual(kinds(report), []);
    assert.ok(report.selfTracking.includes("fix/real-work"));

    applyFixes(work, report);
    assert.equal(
      git(work, "config", "--get", "branch.fix/real-work.remote"),
      "origin",
      "stripping this makes a server-deleted merged head read as never-pushed (cave-xjuup)",
    );
  } finally {
    cleanup(dir);
  }
});

test("an upstream pointing at a different branch is reported and unset by --fix", () => {
  const { dir, work } = scaffold();
  try {
    // Exactly what `git worktree add -b X <path> origin/main` wrote before
    // cave-t57kr: a branch that renders "behind N" against a ref it is not a
    // view of, and whose bare `git push` is answered with `HEAD:main`.
    git(work, "branch", "--track", "feat/bogus", "origin/main");
    const rows = classifyUpstreams(work);
    assert.equal(rows.find((r) => r.branch === "feat/bogus").kind, "foreign-branch");
    assert.ok(kinds(audit(work)).includes("upstream-foreign-branch"));

    applyFixes(work, audit(work));
    assert.equal(configOrNull(work, "branch.feat/bogus.remote"), null);
    assert.deepEqual(audit(work).findings, []);
  } finally {
    cleanup(dir);
  }
});

test("an upstream naming a remote that is not configured is reported and unset by --fix", () => {
  const { dir, work } = scaffold();
  try {
    // `git remote remove` cleans up the branch configs pointing at it, so this
    // state only arrives by a hand-edited config, a partially applied rename,
    // or a config copied between checkouts — which is exactly why it goes
    // unnoticed: Desktop still renders the branch as tracking something.
    git(work, "branch", "feat/on-fork", "main");
    git(work, "config", "branch.feat/on-fork.remote", "gone");
    git(work, "config", "branch.feat/on-fork.merge", "refs/heads/feat/on-fork");

    const rows = classifyUpstreams(work);
    assert.equal(rows.find((r) => r.branch === "feat/on-fork").kind, "dangling-remote");
    assert.ok(kinds(audit(work)).includes("upstream-dangling-remote"));

    applyFixes(work, audit(work));
    assert.equal(configOrNull(work, "branch.feat/on-fork.remote"), null);
    assert.deepEqual(audit(work).findings, []);
  } finally {
    cleanup(dir);
  }
});

test("the CLI exits 1 on findings and 0 once --fix has cleared them", () => {
  const { dir, work } = scaffold();
  try {
    git(work, "update-ref", "refs/remotes/pull/1/head", git(work, "rev-parse", "main"));

    const dirty = spawnSync("node", [script, "--json"], { cwd: work, encoding: "utf8", env });
    assert.equal(dirty.status, 1, "a findable defect must fail the audit");
    assert.ok(JSON.parse(dirty.stdout).findings.length > 0);

    const fixed = spawnSync("node", [script, "--fix", "--json"], { cwd: work, encoding: "utf8", env });
    assert.equal(fixed.status, 0, "--fix reports the post-repair state");
    assert.deepEqual(JSON.parse(fixed.stdout).findings, []);

    assert.equal(spawnSync("node", [script], { cwd: work, encoding: "utf8", env }).status, 0);
  } finally {
    cleanup(dir);
  }
});
