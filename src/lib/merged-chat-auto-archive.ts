// Merged-chat auto-archive: when the pull request a chat produced has been
// merged, the chat's work is done — archive it automatically instead of
// leaving it in the active list forever. Pure decision logic only; the IO
// (cave-state writes, nudge resolution) lives in the sessions list route.
//
// Safety properties:
//  - Only fires on a real, lowercased "merged" PR state (server-side
//    `gh pr view` enrichment) — GitHub-task lifecycle words never match.
//  - Never touches rows that look like they may still be doing work.
//  - One-shot per (session, PR): a session the sweep already archived for a
//    given PR is recorded in cave state (`mergedPrAutoArchived`), so summoning
//    (unarchiving) it sticks — the sweep won't re-archive it for the same PR.
//  - Opt-out via COVEN_CAVE_NO_MERGED_AUTO_ARCHIVE=1.

import type { SessionPullRequestContext, SessionRow } from "@/lib/types";

export const MERGED_AUTO_ARCHIVE_DISABLE_ENV = "COVEN_CAVE_NO_MERGED_AUTO_ARCHIVE";

export type MergedAutoArchiveRow = Pick<
  SessionRow,
  "id" | "status" | "archived_at" | "pullRequest"
>;

export type MergedAutoArchiveDecision = {
  sessionId: string;
  /** Stable identity of the merged PR — "owner/repo#N", or its URL. */
  prKey: string;
};

/** Statuses that mean the session may still be doing work — never sweep those. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "starting",
  "working",
  "queued",
  "streaming",
  "waiting",
]);

/** Stable key identifying a PR across polls; null when it can't be identified. */
export function mergedPrKey(pr: SessionPullRequestContext): string | null {
  if (pr.repo && typeof pr.number === "number") return `${pr.repo}#${pr.number}`;
  return pr.url ?? null;
}

/**
 * Which sessions should be archived right now because their PR merged.
 * `handled` is cave state's mergedPrAutoArchived map (session id → PR key of
 * the merge that already auto-archived it once).
 */
export function mergedChatAutoArchiveDecisions(
  rows: MergedAutoArchiveRow[],
  handled: Record<string, string>,
): MergedAutoArchiveDecision[] {
  const decisions: MergedAutoArchiveDecision[] = [];
  for (const row of rows) {
    if (row.archived_at) continue;
    if (ACTIVE_STATUSES.has((row.status ?? "").toLowerCase())) continue;
    const pr = row.pullRequest;
    if (!pr || (pr.state ?? "").toLowerCase() !== "merged") continue;
    const prKey = mergedPrKey(pr);
    if (!prKey) continue;
    if (handled[row.id] === prKey) continue;
    decisions.push({ sessionId: row.id, prKey });
  }
  return decisions;
}
