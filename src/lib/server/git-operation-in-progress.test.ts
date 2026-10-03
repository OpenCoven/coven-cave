// @ts-nocheck
/**
 * Paused git operations, detected on real repositories (#5781). Committing
 * from the desk mid-rebase landed inside the rebase and rewrote the branch.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gitOperationInProgress, operationInProgressMessage } from "./git-operation-in-progress.ts";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "git-operation-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

let count = 0;
/** main: f.txt = "main"; feature: f.txt = "feature". They conflict. */
function conflictingRepo() {
  const repo = path.join(scratch, `repo-${count++}`);
  mkdirSync(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const gitFails = (...args) => assert.throws(() => git(...args), undefined, `git ${args.join(" ")} stops on the conflict`);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "f.txt"), "base\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
  writeFileSync(path.join(repo, "f.txt"), "feature\n");
  git("commit", "-q", "-am", "feature edit");
  git("checkout", "-q", "main");
  writeFileSync(path.join(repo, "f.txt"), "main\n");
  git("commit", "-q", "-am", "main edit");
  return { repo, git, gitFails };
}

// Nothing paused.
{
  const { repo } = conflictingRepo();
  assert.equal(await gitOperationInProgress(repo), null);
}

// A rebase stopped on a conflict, and the same after it is resolved and staged.
{
  const { repo, git, gitFails } = conflictingRepo();
  git("checkout", "-q", "feature");
  gitFails("rebase", "main");
  assert.equal(await gitOperationInProgress(repo), "rebase");
  writeFileSync(path.join(repo, "f.txt"), "resolved\n");
  git("add", "f.txt");
  assert.equal(await gitOperationInProgress(repo), "rebase", "resolved but not continued is still a rebase");
  git("rebase", "--abort");
  assert.equal(await gitOperationInProgress(repo), null);
}

// The apply backend, then `git am`, which shares its directory.
{
  const { repo, git, gitFails } = conflictingRepo();
  git("checkout", "-q", "feature");
  gitFails("rebase", "--apply", "main");
  assert.equal(await gitOperationInProgress(repo), "rebase");
  git("rebase", "--abort");
  const patch = git("format-patch", "-1", "--stdout", "feature");
  git("checkout", "-q", "main");
  writeFileSync(path.join(scratch, `series-${count}.patch`), patch);
  gitFails("am", path.join(scratch, `series-${count}.patch`));
  assert.equal(await gitOperationInProgress(repo), "am");
}

// A merge, a cherry-pick and a revert, each stopped on a conflict.
{
  const { repo, gitFails } = conflictingRepo();
  gitFails("merge", "feature");
  assert.equal(await gitOperationInProgress(repo), "merge");
}
{
  const { repo, gitFails } = conflictingRepo();
  gitFails("cherry-pick", "feature");
  assert.equal(await gitOperationInProgress(repo), "cherry-pick");
}
{
  const { repo, git, gitFails } = conflictingRepo();
  writeFileSync(path.join(repo, "f.txt"), "later\n");
  git("commit", "-q", "-am", "later edit");
  gitFails("revert", "--no-edit", "HEAD~1");
  assert.equal(await gitOperationInProgress(repo), "revert");
}

// A linked worktree keeps its own state: a rebase there isn't the main
// checkout's, and the main checkout's isn't the worktree's.
{
  const { repo, git } = conflictingRepo();
  const linked = path.join(scratch, `linked-${count}`);
  git("worktree", "add", "-q", linked, "feature");
  assert.throws(() => execFileSync("git", ["rebase", "main"], { cwd: linked, stdio: "pipe" }));
  assert.equal(await gitOperationInProgress(linked), "rebase");
  assert.equal(await gitOperationInProgress(repo), null);
}

// The refusal names the operation and both ways out.
assert.equal(
  operationInProgressMessage("rebase", "commit"),
  "a rebase is in progress in this repository; finish it (git rebase --continue) or stop it (git rebase --abort) in a terminal, then commit",
);
assert.match(operationInProgressMessage("cherry-pick", "open a pull request"), /git cherry-pick --abort\) in a terminal, then open a pull request$/);

console.log("git-operation-in-progress: ok");
