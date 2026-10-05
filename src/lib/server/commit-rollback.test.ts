// @ts-nocheck
/**
 * Rolling back a refused or failed commit, against real repositories (#5756).
 * The route used to leave the files staged and the branch it made behind, and
 * with HEAD detached its `checkout HEAD` changed nothing.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureCommitStart, commitSubject, createPrivateIndex, deskCommitLanded, rollbackCommitStart } from "./commit-rollback.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "commit-rollback-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

let count = 0;
function makeRepo() {
  const repo = path.join(scratch, `repo-${count++}`);
  mkdirSync(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "a.txt"), "a1\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  writeFileSync(path.join(repo, "a.txt"), "a2\n");
  writeFileSync(path.join(repo, "new.txt"), "new\n");
  return { repo, git };
}

// ── 1. On the default branch: the branch made for the commit goes ───────────
{
  const { repo, git } = makeRepo();
  const start = await captureCommitStart(repo, "main");
  git("checkout", "-q", "-b", "cave/wire-it-abc");
  git("add", "-A");
  await rollbackCommitStart(repo, start, "cave/wire-it-abc");
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), "main", "back on the branch it started on");
  assert.equal(git("branch", "--list", "cave/wire-it-abc"), "", "the branch made for the commit is gone");
  assert.equal(git("diff", "--cached", "--name-only"), "", "nothing left staged");
  // (The helper trims, so the unstaged " M" loses its leading space.)
  assert.equal(git("status", "--porcelain"), "M a.txt\n?? new.txt", "the edits themselves are untouched, and unstaged");
}

// ── 2. HEAD detached: back to the same commit, still detached ───────────────
{
  const { repo, git } = makeRepo();
  const oid = git("rev-parse", "HEAD");
  git("checkout", "-q", "--detach", oid);
  const start = await captureCommitStart(repo, "HEAD");
  git("checkout", "-q", "-b", "cave/detached-xyz");
  git("add", "-A");
  await rollbackCommitStart(repo, start, "cave/detached-xyz");
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), "HEAD", "detached again, not left on the new branch");
  assert.equal(git("rev-parse", "HEAD"), oid);
  assert.equal(git("branch", "--list", "cave/detached-xyz"), "");
}

// ── 3. On a feature branch: only the staging is undone ──────────────────────
{
  const { repo, git } = makeRepo();
  git("checkout", "-q", "-b", "feat/x");
  git("add", "a.txt");
  const start = await captureCommitStart(repo, "feat/x");
  git("add", "-A");
  await rollbackCommitStart(repo, start, null);
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), "feat/x");
  assert.equal(git("diff", "--cached", "--name-only"), "a.txt", "the index is back as it was, earlier staging included");
}

// ── 4. A branch that gained a commit is kept ────────────────────────────────
{
  const { repo, git } = makeRepo();
  const start = await captureCommitStart(repo, "main");
  git("checkout", "-q", "-b", "cave/kept");
  git("add", "-A");
  git("commit", "-q", "-m", "landed after all");
  await rollbackCommitStart(repo, start, "cave/kept");
  assert.notEqual(git("branch", "--list", "cave/kept"), "", "compare-and-delete keeps a branch with work on it");
}

// ── 5. The index captured by the route's own check is the one restored ─────
{
  const { repo, git } = makeRepo();
  git("add", "a.txt");
  const tree = git("write-tree");
  git("reset", "-q");
  const start = await captureCommitStart(repo, "main", tree);
  assert.equal(start.index, tree);
  await rollbackCommitStart(repo, start, null);
  assert.equal(git("diff", "--cached", "--name-only"), "a.txt");
}

// ── 6. Another process's commit on the new branch keeps the checkout (#5795)
// Switching back would take that commit's files out of the worktree.
{
  const { repo, git } = makeRepo();
  const start = await captureCommitStart(repo, "main");
  git("checkout", "-q", "-b", "cave/desk");
  writeFileSync(path.join(repo, "agent.txt"), "agent\n");
  git("add", "agent.txt");
  git("commit", "-q", "-m", "agent: wip");
  await rollbackCommitStart(repo, { ...start, index: null }, "cave/desk");
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), "cave/desk", "the checkout stays on the branch with the other commit");
  assert.equal(git("log", "-1", "--format=%s"), "agent: wip");
}

// ── 7. Only the desk's own commit counts as landed (#5795) ─────────────────
{
  assert.equal(commitSubject("Fix the widget"), "Fix the widget");
  assert.equal(commitSubject("\n  Fix the\nwidget  \n\nBody text\n"), "Fix the widget", "the first paragraph, joined");
  assert.equal(commitSubject("  \n"), "");

  const { repo, git } = makeRepo();
  const start = await captureCommitStart(repo, "main");
  writeFileSync(path.join(repo, "a.txt"), "desk\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "desk: change");
  assert.equal(await deskCommitLanded(repo, start, { message: "desk: change" }), git("rev-parse", "HEAD"), "its parent is the start and its subject the desk's");
  assert.equal(await deskCommitLanded(repo, start, { message: "something else" }), null, "another message is another commit");
  writeFileSync(path.join(repo, "a.txt"), "agent\n");
  git("commit", "-q", "-am", "desk: change");
  assert.equal(await deskCommitLanded(repo, start, { message: "desk: change" }), null, "a commit on top of another isn't the desk's");

  const { repo: repo2, git: git2 } = makeRepo();
  const start2 = await captureCommitStart(repo2, "main");
  const index = await createPrivateIndex(repo2);
  try {
    writeFileSync(path.join(repo2, "a.txt"), "desk\n");
    execFileSync("git", ["add", "a.txt"], { cwd: repo2, env: { ...process.env, ...index.env } });
    assert.equal(git2("diff", "--cached", "--name-only"), "", "the real index is untouched");
    execFileSync("git", ["commit", "-q", "-m", "any message"], { cwd: repo2, env: { ...process.env, ...index.env } });
    assert.equal(await deskCommitLanded(repo2, start2, { indexEnv: index.env, message: "desk: change" }), git2("rev-parse", "HEAD"), "with a private index, the tree decides");
    git2("reset", "-q", "--hard", start2.oid);
    writeFileSync(path.join(repo2, "b.txt"), "agent\n");
    git2("add", "b.txt");
    git2("commit", "-q", "-m", "agent: wip");
    assert.equal(await deskCommitLanded(repo2, start2, { indexEnv: index.env, message: "agent: wip" }), null, "another tree is another commit");
  } finally {
    index.dispose();
  }
}

console.log("commit-rollback: ok");
