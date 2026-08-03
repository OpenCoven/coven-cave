import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorktrees, reasonFor, riskOf } from "./worktree-autolock.mjs";

// --- parsing ----------------------------------------------------------------
// `locked` appears bare or with a reason; both must register as locked.
{
  const records = parseWorktrees(
    [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/a",
      "HEAD def",
      "locked",
      "",
      "worktree /repo/.worktrees/b",
      "HEAD 123",
      "locked active work",
      "",
      "worktree /repo/.worktrees/c",
      "detached",
      "",
    ].join("\n"),
  );
  assert.equal(records.length, 4, "every worktree record is parsed");
  assert.equal(records[0].path, "/repo");
  assert.equal(records[1].locked, true, "a bare 'locked' line counts as locked");
  assert.equal(records[2].locked, true, "'locked <reason>' counts as locked");
  assert.equal(records[3].locked, false, "an unlocked worktree is not misread as locked");
}

// A path containing spaces must survive parsing — .worktrees paths are ours,
// but /private/tmp scratch worktrees are not always.
{
  const records = parseWorktrees("worktree /tmp/my worktree/a\nHEAD abc\n\n");
  assert.equal(records[0].path, "/tmp/my worktree/a", "paths with spaces are preserved");
}

// --- reason text ------------------------------------------------------------
{
  const both = reasonFor({ dirty: 3, unpushed: 2 }, "2026-08-03");
  assert.match(both, /3 uncommitted paths/);
  assert.match(both, /2 commits not on any remote/);
  assert.match(both, /git worktree unlock/, "the reason tells the owner how to clear it");
  const one = reasonFor({ dirty: 1, unpushed: 0 }, "2026-08-03");
  assert.match(one, /1 uncommitted path\b/, "singular is not mis-pluralised");
  assert.doesNotMatch(one, /commits not on any remote/, "zero counts are omitted");
}

// --- risk classification against real git repos ------------------------------
const scratch = mkdtempSync(path.join(tmpdir(), "autolock-"));
const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@e",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@e",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });

try {
  // An "origin" to push to, so "not on any remote" is a real distinction.
  const origin = path.join(scratch, "origin.git");
  git(["init", "--quiet", "--bare", "-b", "main", origin], scratch);

  const repo = path.join(scratch, "repo");
  git(["init", "--quiet", "-b", "main", repo], scratch);
  writeFileSync(path.join(repo, "seed.txt"), "seed\n");
  git(["add", "."], repo);
  git(["commit", "--quiet", "--no-gpg-sign", "-m", "seed"], repo);
  git(["remote", "add", "origin", origin], repo);
  git(["push", "--quiet", "origin", "main"], repo);

  // 1. clean and fully pushed → NOT at risk, so it is never locked.
  assert.equal(riskOf(repo), null, "a clean, fully pushed worktree is not locked");

  // 2. uncommitted edit → at risk (nothing else holds that content).
  writeFileSync(path.join(repo, "seed.txt"), "edited\n");
  const dirty = riskOf(repo);
  assert.ok(dirty, "an uncommitted edit is at risk");
  assert.equal(dirty.dirty, 1);
  assert.equal(dirty.unpushed, 0);

  // 3. untracked file counts too — that is the unrecoverable case.
  git(["checkout", "--quiet", "--", "seed.txt"], repo);
  writeFileSync(path.join(repo, "brand-new.txt"), "never committed\n");
  const untracked = riskOf(repo);
  assert.ok(untracked, "an untracked file is at risk");
  assert.equal(untracked.dirty, 1);
  rmSync(path.join(repo, "brand-new.txt"));

  // 4. committed but unpushed → at risk until a remote holds it.
  writeFileSync(path.join(repo, "seed.txt"), "committed locally\n");
  git(["commit", "--quiet", "--no-gpg-sign", "-am", "local only"], repo);
  const unpushed = riskOf(repo);
  assert.ok(unpushed, "a commit absent from every remote is at risk");
  assert.equal(unpushed.dirty, 0);
  assert.equal(unpushed.unpushed, 1);

  // 5. once pushed, the same worktree stops being at risk — the branch and its
  //    commits outlive a removal, so locking it would be pure friction.
  git(["push", "--quiet", "origin", "main"], repo);
  assert.equal(riskOf(repo), null, "pushing clears the risk");

  // 6. an unreadable path yields null rather than throwing into the hook.
  assert.equal(riskOf(path.join(scratch, "does-not-exist")), null, "missing paths are skipped");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log("worktree-autolock.test.mjs: ok");
