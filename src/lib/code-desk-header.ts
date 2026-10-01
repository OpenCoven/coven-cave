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
import type { SessionRow } from "@/lib/types";

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

/** GitHub's state vocabulary, with draft folded in as its own word. */
export function codeDeskPrState(
  pr: { state?: string | null; draft?: boolean | null } | null | undefined,
): CodeDeskPrState {
  if (!pr) return "unknown";
  const state = (pr.state ?? "").trim().toLowerCase();
  if (state === "merged") return "merged";
  if (state === "closed") return "closed";
  if (pr.draft || state === "draft") return "draft";
  if (state === "open") return "open";
  return "unknown";
}

export type CodeDeskIdentity = {
  activity: { kind: CodeSessionActivity; word: string; tone: CodeDeskTone };
  branch: { name: string; worktree: boolean } | null;
  pr: { label: string; state: CodeDeskPrState; tone: CodeDeskTone; url: string | null } | null;
  diff: { additions: number; deletions: number } | null;
};

/**
 * `live` is the room's own worktree summary (`useWorktreeChanges`). Once it
 * has loaded it is the truth for the diffstat — the session list's figure is
 * an enrichment snapshot that can lag the worktree, and the header and the
 * review rail printed two different numbers for the same files (#5718).
 */
export type CodeDeskLiveChanges = {
  additions: number;
  deletions: number;
  loaded: boolean;
  files: readonly unknown[];
};

/** The diffstat the header prints: live counts when it has them, the list's otherwise. */
export function codeDeskDiff(
  listed: { additions: number; deletions: number } | null | undefined,
  live?: CodeDeskLiveChanges | null,
): { additions: number; deletions: number } | null {
  if (live?.loaded) {
    // A loaded, empty worktree is clean, whatever the list still remembers.
    if (live.files.length === 0) return null;
    if (live.additions > 0 || live.deletions > 0) return { additions: live.additions, deletions: live.deletions };
    // Files without line counts (untracked, binary) say nothing about size;
    // keep the list's figure rather than print a false +0 −0.
  }
  return listed && (listed.additions > 0 || listed.deletions > 0)
    ? { additions: listed.additions, deletions: listed.deletions }
    : null;
}

export function codeDeskIdentity(row: SessionRow, live?: CodeDeskLiveChanges | null): CodeDeskIdentity {
  const activityKind = codeSessionActivity(row);
  const branchName = codeSessionBranch(row);
  const pr = row.pullRequest ?? null;
  const diff = codeDeskDiff(row.diff, live);
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
    diff,
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
