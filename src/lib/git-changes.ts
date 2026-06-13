/**
 * Pure parsing + decision helpers for the working-tree changes feature
 * (/api/changes). Extracted from the route so the tricky NUL/rename parsing
 * and the destructive-revert decision matrix can be unit-tested without
 * spinning up next/server, fs, or a real git process.
 */

export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export type ChangedFile = {
  path: string;
  status: FileStatus;
  renamedFrom?: string;
  insertions?: number;
  deletions?: number;
};

/** Map a porcelain XY status pair to a single coarse status. */
export function statusOf(x: string, y: string): FileStatus {
  if (x === "?") return "untracked";
  if (x === "R" || y === "R" || x === "C") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

/** Parse `git status --porcelain=v1 -z`. Entries are NUL-separated
 *  `XY <path>`; renames/copies carry the original path as the next token. */
export function parsePorcelainZ(out: string): ChangedFile[] {
  const tokens = out.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4 || entry[2] !== " ") continue;
    const x = entry[0];
    const y = entry[1];
    const file: ChangedFile = { path: entry.slice(3), status: statusOf(x, y) };
    if (x === "R" || x === "C") {
      file.renamedFrom = tokens[i + 1];
      i++;
    }
    files.push(file);
  }
  return files;
}

/** Parse `git diff --numstat -z`: `ins\tdel\tpath` tokens; renames leave the
 *  path slot empty and append old/new as the following two tokens. Binary
 *  files report `-` and are skipped — counts are best-effort decoration. */
export function parseNumstatZ(out: string): Map<string, { insertions: number; deletions: number }> {
  const map = new Map<string, { insertions: number; deletions: number }>();
  const tokens = out.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[i]);
    if (!m) continue;
    let file = m[3];
    if (file === "") {
      file = tokens[i + 2] ?? "";
      i += 2;
    }
    if (!file || m[1] === "-" || m[2] === "-") continue;
    map.set(file, { insertions: Number(m[1]), deletions: Number(m[2]) });
  }
  return map;
}

/**
 * Revert decision matrix. Reverting means "make this file match HEAD":
 *
 * - In HEAD  → `git checkout HEAD -- <path>`. Updates index AND worktree, so it
 *   covers plain modifications, staged modifications, and (staged-or-unstaged)
 *   deletions — fully matching the HEAD-relative diff the panel shows.
 * - Not in HEAD, tracked (staged-new "added" file) → removing it is the revert.
 *   Destructive, so gated behind `confirmDelete`. `git rm -f -- <path>` clears
 *   both index and worktree.
 * - Not in HEAD, untracked → `git clean -f -- <path>`. Also destructive; gated.
 *
 * The "confirm-required" plan is returned when a delete is needed but the
 * client hasn't confirmed it yet.
 */
export type RevertPlan =
  | { action: "checkout" }
  | { action: "rm" }
  | { action: "clean" }
  | { action: "confirm-required" };

export function planRevert(opts: {
  inHead: boolean;
  tracked: boolean;
  confirmDelete: boolean;
}): RevertPlan {
  if (opts.inHead) return { action: "checkout" };
  if (!opts.confirmDelete) return { action: "confirm-required" };
  return opts.tracked ? { action: "rm" } : { action: "clean" };
}
