/**
 * A git operation paused part-way through (#5781).
 *
 * Committing from the desk mid-rebase landed the desk's commit inside the
 * rebase: it made a `cave/` branch at the paused pick and committed the
 * resolved conflict under the desk's message, so `git rebase --continue`
 * then rewrote the branch with that commit in place of the original. The
 * desk refuses to commit or open a pull request while one of these is
 * paused, and says which one.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitOperation = "rebase" | "am" | "merge" | "cherry-pick" | "revert";

// The markers git leaves in the git dir while each one is paused. A linked
// worktree has its own, which `rev-parse --git-path` resolves.
const MARKERS = ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] as const;

/** The operation paused in this repository, or null when there is none. */
export async function gitOperationInProgress(repoRoot: string): Promise<GitOperation | null> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", ...MARKERS.flatMap((marker) => ["--git-path", marker])],
    { cwd: repoRoot, windowsHide: true, timeout: 10_000 },
  );
  const paths = stdout.split("\n").filter(Boolean).map((p) => path.resolve(repoRoot, p));
  const exists = (marker: (typeof MARKERS)[number]) => {
    const at = paths[MARKERS.indexOf(marker)];
    return at !== undefined && fs.existsSync(/* turbopackIgnore: true */ at);
  };
  if (exists("rebase-merge")) return "rebase";
  if (exists("rebase-apply")) {
    // `git am` shares the directory and marks it as its own.
    const applying = path.join(paths[MARKERS.indexOf("rebase-apply")]!, "applying");
    return fs.existsSync(/* turbopackIgnore: true */ applying) ? "am" : "rebase";
  }
  if (exists("MERGE_HEAD")) return "merge";
  if (exists("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (exists("REVERT_HEAD")) return "revert";
  return null;
}

const HOW: Record<GitOperation, { name: string; command: string }> = {
  rebase: { name: "a rebase", command: "git rebase" },
  am: { name: "a patch series (git am)", command: "git am" },
  merge: { name: "a merge", command: "git merge" },
  "cherry-pick": { name: "a cherry-pick", command: "git cherry-pick" },
  revert: { name: "a revert", command: "git revert" },
};

/** Why the desk won't commit or open a pull request right now. A commit would
 *  also conclude a paused merge, cherry-pick or revert under the desk's
 *  message instead of the one git prepared, so those finish in a terminal
 *  too. */
export function operationInProgressMessage(operation: GitOperation, action: "commit" | "open a pull request"): string {
  const { name, command } = HOW[operation];
  return `${name} is in progress in this repository; finish it (${command} --continue) or stop it (${command} --abort) in a terminal, then ${action}`;
}
