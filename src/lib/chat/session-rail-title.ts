import type { SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";

// Default branch names that carry no signal on their own: a chat rooted in the
// primary checkout sitting on the repo's default branch. Nearly every ordinary
// session matches, so appending "- main" to every rail row is just noise.
const DEFAULT_BRANCHES = new Set(["main", "master"]);

/**
 * Single formatter for session rail/thread titles. Appends git/PR context only
 * when it distinguishes the chat:
 *   - a linked pull request (number and/or state),
 *   - a linked worktree,
 *   - a non-default branch.
 * A bare default-branch checkout ("main"/"master" with no PR and no worktree)
 * gets no suffix — the branch is implied and would otherwise repeat on every row.
 */
export function sessionRailTitle(session: SessionRow): string {
  const baseTitle = stripLeadingTrailingEmoji(session.title || "(untitled chat)");
  const context: string[] = [];

  const prNumber = session.pullRequest?.number;
  const prState = session.pullRequest?.state;
  if (prNumber != null) {
    context.push(`PR #${prNumber}${prState ? ` ${prState}` : ""}`);
  } else if (prState) {
    context.push(`PR ${prState}`);
  }

  const hasPr = prNumber != null || Boolean(prState);
  const isWorktree = Boolean(session.git?.isWorktree);
  const branch = session.pullRequest?.branch ?? session.git?.branch;
  if (branch && (hasPr || isWorktree || !DEFAULT_BRANCHES.has(branch.toLowerCase()))) {
    context.push(branch);
  }
  if (isWorktree) context.push("worktree");

  return context.length > 0 ? `${baseTitle} - ${context.join(" - ")}` : baseTitle;
}
