/**
 * Commit-review prompt for the Changes panel's "Review" action (pure, no I/O).
 *
 * The button starts a NEW chat session whose opening prompt asks the familiar
 * to review the uncommitted working-tree changes. The prompt carries the
 * changed-file inventory (path · status · ±counts) so the review is anchored,
 * and instructs the agent to read the full patches itself with git — the
 * session runs with the project root as its working directory.
 */

export type ReviewFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export type ReviewChangedFile = {
  path: string;
  status: ReviewFileStatus;
  renamedFrom?: string;
  insertions?: number;
  deletions?: number;
};

function fileLine(f: ReviewChangedFile): string {
  const counts =
    typeof f.insertions === "number" || typeof f.deletions === "number"
      ? ` (+${f.insertions ?? 0}/−${f.deletions ?? 0})`
      : "";
  const renamed = f.status === "renamed" && f.renamedFrom ? ` (from ${f.renamedFrom})` : "";
  return `- ${f.path} — ${f.status}${renamed}${counts}`;
}

/** Cap the inventory so a huge working tree can't blow up the opening prompt. */
export const REVIEW_FILE_LIST_CAP = 100;

export function buildChangesReviewPrompt({
  repoRoot,
  files,
}: {
  repoRoot: string;
  files: ReviewChangedFile[];
}): string {
  const listed = files.slice(0, REVIEW_FILE_LIST_CAP);
  const omitted = files.length - listed.length;
  const inventory = listed.map(fileLine).join("\n");
  const omittedNote = omitted > 0 ? `\n…and ${omitted} more (run git status for the full list).` : "";
  return [
    `Review the uncommitted changes in ${repoRoot} as if you were reviewing a commit before it lands.`,
    "",
    `Changed files (${files.length}):`,
    inventory + omittedNote,
    "",
    "Read the actual patches first — run `git status` and `git diff` (plus `git diff --staged` if anything is staged) rather than judging from the file list alone; untracked files must be read directly since they have no diff.",
    "",
    "Then report, in order:",
    "1. **Verdict** — ship it, ship with nits, or needs work.",
    "2. **Bugs & correctness risks** — anything that breaks behavior, misses an edge case, or contradicts nearby code. Cite file:line.",
    "3. **Security & data-loss concerns** — injection, path traversal, secrets, destructive operations without guards.",
    "4. **Test gaps** — behavior these changes add or alter that no test covers.",
    "5. **Nits** — only ones worth a comment; skip style that a formatter owns.",
    "",
    "Be specific and cite evidence from the diff. If the changes look unrelated to each other, say so — flagging an overloaded commit is part of the review.",
  ].join("\n");
}
