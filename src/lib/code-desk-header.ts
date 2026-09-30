/**
 * Coding Desk identity strip (#5705).
 *
 * The header used to print branch, diffstat, PR and age as a 10px monospace
 * "facts" row: one colour, one weight, icons the size of a full stop. This is
 * the pure model behind the chips that replaced it. Every chip carries its
 * meaning in a WORD (running, draft, merged, +12) so the tint reinforces and
 * never carries alone.
 */

import {
  codeSessionActivity,
  codeSessionBranch,
  type CodeSessionActivity,
} from "@/lib/code-surface";
import { sessionPrStatusKey } from "@/lib/session-pr-status";
import type { SessionPullRequestContext, SessionRow } from "@/lib/types";

/** Semantic tint. Resolved to tokens in CSS via `data-tone`. */
export type CodeDeskTone = "neutral" | "presence" | "success" | "warning" | "danger";

export const CODE_DESK_ACTIVITY: Record<CodeSessionActivity, { word: string; tone: CodeDeskTone }> = {
  running: { word: "running", tone: "success" },
  error: { word: "failed", tone: "danger" },
  idle: { word: "idle", tone: "neutral" },
};

export type CodeDeskPrState = "open" | "draft" | "merged" | "closed" | "unknown";

export const CODE_DESK_PR_TONE: Record<CodeDeskPrState, CodeDeskTone> = {
  open: "success",
  draft: "neutral",
  merged: "presence",
  closed: "danger",
  unknown: "neutral",
};

/** GitHub's state vocabulary, with draft folded in as its own word — the
 *  same mapping the chat list's PR badge uses, so the two never disagree. */
export function codeDeskPrState(
  pr: Pick<SessionPullRequestContext, "state" | "draft"> | null | undefined,
): CodeDeskPrState {
  if (!pr) return "unknown";
  return sessionPrStatusKey({ repo: "", ...pr });
}

export type CodeDeskIdentity = {
  activity: { kind: CodeSessionActivity; word: string; tone: CodeDeskTone };
  branch: { name: string; worktree: boolean } | null;
  pr: { label: string; state: CodeDeskPrState; tone: CodeDeskTone; url: string | null } | null;
  diff: { additions: number; deletions: number } | null;
};

export function codeDeskIdentity(row: SessionRow): CodeDeskIdentity {
  const activityKind = codeSessionActivity(row);
  const branchName = codeSessionBranch(row);
  const pr = row.pullRequest ?? null;
  const diff = row.diff ?? null;
  const prState = codeDeskPrState(pr);
  return {
    activity: { kind: activityKind, ...CODE_DESK_ACTIVITY[activityKind] },
    branch: branchName ? { name: branchName, worktree: Boolean(row.git?.isWorktree) } : null,
    pr: pr
      ? {
          label: pr.number != null ? `#${pr.number}` : "PR",
          state: prState,
          tone: CODE_DESK_PR_TONE[prState],
          url: pr.url ?? null,
        }
      : null,
    diff:
      diff && (diff.additions > 0 || diff.deletions > 0)
        ? { additions: diff.additions, deletions: diff.deletions }
        : null,
  };
}

/**
 * "2 of 5 viewed", or null when there is nothing to review. The header prints
 * this so a rail collapsed to its spine still answers "how far through am I".
 */
export function codeDeskReviewProgress(viewedCount: number, total: number): string | null {
  if (total <= 0) return null;
  return `${Math.min(viewedCount, total)} of ${total} viewed`;
}
