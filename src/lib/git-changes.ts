/**
 * Pure parsing + decision helpers for the working-tree changes feature
 * (/api/changes). Extracted from the route so the tricky NUL/rename parsing
 * and the destructive-revert decision matrix can be unit-tested without
 * spinning up next/server, fs, or a real git process.
 */

export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

export type ChangedFile = {
  path: string;
  status: FileStatus;
  renamedFrom?: string;
  /** A copy rather than a rename: the original path is still there. */
  copied?: true;
  insertions?: number;
  deletions?: number;
  changeVersion?: string;
};

/** The unmerged pairs `git status` reports mid-merge, -rebase or -pick. */
const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** Map a porcelain XY status pair to a single coarse status. */
export function statusOf(x: string, y: string): FileStatus {
  if (x === "?") return "untracked";
  // A conflict is its own state (#5781): it used to read as modified, added
  // or deleted, and Revert quietly resolved it as "ours".
  if (UNMERGED.has(x + y)) return "conflicted";
  if (x === "R" || y === "R" || x === "C" || y === "C") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

/** Parse `git status --porcelain=v1 -z`. Entries are NUL-separated
 *  `XY <path>`; renames/copies carry the original path as the next token, in
 *  either column (#5781): a worktree rename (` R`, after `git add -N`) used to
 *  leave its original path to be read as an entry of its own. */
export function parsePorcelainZ(out: string): ChangedFile[] {
  const tokens = out.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4 || entry[2] !== " ") continue;
    const x = entry[0];
    const y = entry[1];
    const file: ChangedFile = { path: entry.slice(3), status: statusOf(x, y) };
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      file.renamedFrom = tokens[i + 1];
      if (x === "C" || (x !== "R" && y === "C")) file.copied = true;
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
  | { action: "unrename"; from: string }
  | { action: "conflicted" }
  | { action: "confirm-required" };

export function planRevert(opts: {
  inHead: boolean;
  tracked: boolean;
  confirmDelete: boolean;
  /** The file's entry in the change list, when it has one. */
  entry?: Pick<ChangedFile, "status" | "renamedFrom" | "copied"> | null;
  /** Whether the entry's original path is in HEAD. */
  fromInHead?: boolean;
}): RevertPlan {
  // A conflict is resolved, or its operation aborted, in a terminal (#5781).
  if (opts.entry?.status === "conflicted") return { action: "conflicted" };
  if (opts.entry?.status === "renamed" && opts.entry.renamedFrom && !opts.inHead) {
    // A rename reverts as a whole (#5781): the original comes back and the
    // new path goes. It used to be refused as "a new file", and the edit
    // card's confirmed Undo deleted the new path and left the original
    // deleted too. A copy's original is still there, so only the copy goes.
    if (opts.entry.copied) return { action: "rm" };
    if (opts.fromInHead) return { action: "unrename", from: opts.entry.renamedFrom };
  }
  if (opts.inHead) return { action: "checkout" };
  if (!opts.confirmDelete) return { action: "confirm-required" };
  return opts.tracked ? { action: "rm" } : { action: "clean" };
}

/**
 * A checkpoint filename is the exact stamp the route writes:
 * `new Date().toISOString()` with `:`/`.` replaced by `-`, plus `.patch`
 * (e.g. `2026-06-13T07-00-33-123Z.patch`). Validating against this exact
 * shape doubles as a path-traversal guard — the name can't contain a slash,
 * `..`, or any extension other than `.patch`.
 */
export function isCheckpointName(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.patch$/.test(name);
}
