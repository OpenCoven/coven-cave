/**
 * review-deck — pure review-queue logic for the Reviewer's Review Deck.
 *
 * Builds the reviewable queue from the familiar's real sessions (git branch,
 * pull-request, and diff context) and formats change stats. Kept JSX-free
 * (type-only imports) so the rules are unit-testable under plain
 * `node --experimental-strip-types`.
 */

import type { SessionRow } from "@/lib/types";

export type ReviewItem<T> = {
  session: T;
  /** Why this session is on the deck. */
  reasons: Array<"pull-request" | "working-changes" | "branch">;
};

/**
 * Sessions carrying review material — a PR, a nonzero working-tree diff, or a
 * named branch — newest first. Archived sessions have left the deck.
 */
export function reviewQueue<T extends Pick<SessionRow, "archived_at" | "git" | "pullRequest" | "diff" | "updated_at">>(
  sessions: readonly T[],
): ReviewItem<T>[] {
  return sessions
    .filter((session) => session.archived_at == null)
    .map((session) => {
      const reasons: ReviewItem<T>["reasons"] = [];
      if (session.pullRequest) reasons.push("pull-request");
      if ((session.diff?.additions ?? 0) > 0 || (session.diff?.deletions ?? 0) > 0) reasons.push("working-changes");
      if (session.git?.branch) reasons.push("branch");
      return { session, reasons };
    })
    .filter((item) => item.reasons.length > 0)
    .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at));
}

/** "+12 −3" (thin spaces spared; minus is U+2212 to read as a stat, not a flag). */
export function diffStatLabel(diff: { additions: number; deletions: number } | null | undefined): string {
  if (!diff || (diff.additions === 0 && diff.deletions === 0)) return "no changes";
  return `+${diff.additions} −${diff.deletions}`;
}

/** "owner/repo#123" for a session's PR, however partially it is known. */
export function prLabel(pr: { repo: string; number?: number } | null | undefined): string | null {
  if (!pr) return null;
  return pr.number != null ? `${pr.repo}#${pr.number}` : pr.repo;
}

/** The GitHub URL for a session's PR — null until the number is known. */
export function prUrl(pr: { repo: string; number?: number } | null | undefined): string | null {
  if (!pr || pr.number == null) return null;
  return `https://github.com/${pr.repo}/pull/${pr.number}`;
}

export type ReviewDeckStatus = {
  label: string;
  tone: "ok" | "busy";
};

/** The room's one-line status chip, derived from the latest queue build. */
export function reviewDeckStatus(counts: { queue: number; pullRequests: number }): ReviewDeckStatus {
  if (counts.queue === 0) return { label: "deck clear", tone: "ok" };
  const pr = counts.pullRequests > 0 ? ` · ${counts.pullRequests} PR${counts.pullRequests === 1 ? "" : "s"}` : "";
  return { label: `${counts.queue} to review${pr}`, tone: "busy" };
}
