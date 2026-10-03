/**
 * Undo what a refused or failed Coding Desk commit did before it got there
 * (#5756).
 *
 * The commit route may create a branch (when on the default branch, or with
 * HEAD detached) and stages the reviewed files before committing. When the
 * commit was then refused (the tree moved) or failed (signing, a hook), the
 * files stayed staged, the new branch stayed behind, and with HEAD detached
 * the "rollback" `git checkout HEAD` changed nothing, so the checkout was
 * left on the new branch.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

function git(repoRoot: string, args: string[]) {
  return execFileAsync("git", args, { windowsHide: true, cwd: repoRoot, timeout: GIT_TIMEOUT_MS });
}

export type CommitStart = {
  /** HEAD's branch name, or "HEAD" when detached. */
  branch: string;
  /** The commit HEAD pointed at, or null on an unborn branch. */
  oid: string | null;
  /** The index as a tree, or null when it can't be written (unmerged paths). */
  index: string | null;
};

/** Where things stand before the commit route changes anything. */
export async function captureCommitStart(repoRoot: string, branch: string, index?: string | null): Promise<CommitStart> {
  const oid = await git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]).then(({ stdout }) => stdout.trim(), () => null);
  const tree = index ?? (await git(repoRoot, ["write-tree"]).then(({ stdout }) => stdout.trim(), () => null));
  return { branch, oid, index: tree };
}

/**
 * Put HEAD and the index back as `start` had them. A branch the route made
 * (`created`) is checked out of and deleted, but only while it still points
 * at the commit it was made on: a branch that gained a commit is kept.
 */
export async function rollbackCommitStart(repoRoot: string, start: CommitStart, created: string | null): Promise<void> {
  if (created) {
    const back = start.branch === "HEAD" && start.oid ? ["checkout", "--detach", start.oid] : ["checkout", start.branch];
    await git(repoRoot, back).catch(() => {});
    if (start.oid) await git(repoRoot, ["update-ref", "-d", `refs/heads/${created}`, start.oid]).catch(() => {});
  }
  if (start.index) await git(repoRoot, ["read-tree", start.index]).catch(() => {});
}
