/**
 * review-deck — pure review-queue logic for the Reviewer's Review Deck.
 *
 * Builds the reviewable queue from the familiar's real sessions (git branch,
 * pull-request, and diff context) and formats change stats. Kept JSX-free
 * (type-only imports) so the rules are unit-testable under plain
 * `node --experimental-strip-types`.
 */

import type { CardLifecycle } from "@/lib/cave-board-types";
import type { IconName } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";

export type ReviewReason = "pull-request" | "working-changes" | "branch";

export type ReviewItem<T> = {
  session: T;
  /** Why this session is on the deck. */
  reasons: ReviewReason[];
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

// ── Type & lifecycle derivation ──────────────────────────────────────────────

/**
 * The single primary reason a session is on the deck, chosen for the queue's
 * type pill. A PR wins over loose working changes, which win over a bare
 * branch — the strongest review handle the session carries.
 */
export function reviewType(reasons: readonly ReviewReason[]): ReviewReason {
  if (reasons.includes("pull-request")) return "pull-request";
  if (reasons.includes("working-changes")) return "working-changes";
  return "branch";
}

export type ReviewTypeMeta = { label: string; icon: IconName; title: string };

const REVIEW_TYPE_META: Record<ReviewReason, ReviewTypeMeta> = {
  "pull-request": { label: "PR", icon: "ph:git-pull-request", title: "Pull request awaiting review" },
  "working-changes": { label: "Diff", icon: "ph:git-diff", title: "Uncommitted working-tree changes" },
  branch: { label: "Branch", icon: "ph:git-branch", title: "Named branch, no working diff yet" },
};

export function reviewTypeMeta(reasons: readonly ReviewReason[]): ReviewTypeMeta {
  return REVIEW_TYPE_META[reviewType(reasons)];
}

/**
 * Map a daemon session `status` onto the shared board lifecycle so the deck can
 * reuse the LifecycleBadge. Unknown statuses fall back to "queued" rather than
 * inventing a state.
 */
export function sessionLifecycle(status: string | null | undefined): CardLifecycle {
  const s = (status ?? "").toLowerCase();
  if (s === "running" || s === "active") return "running";
  if (s === "review") return "review";
  if (["failed", "error", "killed", "orphaned", "blocked", "conflict"].includes(s)) return "failed";
  if (["completed", "complete", "done", "succeeded", "fulfilled", "stopped", "idle"].includes(s)) return "completed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "queued";
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

export type Verdict = "approved" | "changes" | "merged";

export type VerdictMeta = { label: string; icon: IconName; tone: "success" | "warning" | "primary" };

const VERDICT_META: Record<Verdict, VerdictMeta> = {
  approved: { label: "Approved", icon: "ph:seal-check", tone: "success" },
  changes: { label: "Changes requested", icon: "ph:arrow-bend-up-left", tone: "warning" },
  merged: { label: "Merged", icon: "ph:git-merge", tone: "primary" },
};

export function verdictMeta(verdict: Verdict): VerdictMeta {
  return VERDICT_META[verdict];
}

/**
 * Does a session still need a human's eyes? A recorded verdict clears it;
 * otherwise a failed or review-state workload is the one asking.
 */
export function needsHuman(lifecycle: CardLifecycle, verdict: Verdict | null): boolean {
  if (verdict) return false;
  return lifecycle === "review" || lifecycle === "failed";
}

// ── Summary strip ────────────────────────────────────────────────────────────

export type ReviewSummary = {
  awaiting: number;
  approved: number;
  changes: number;
  landedClean: number;
};

/**
 * The four counts on the deck's summary strip, derived from the live queue and
 * the reviewer's recorded verdicts. "Landed clean" is a workload on the deck
 * (a PR or branch) that carries no working-tree diff — the work already shipped.
 */
export function reviewSummary<T extends { additions: number; deletions: number } | null | undefined>(
  items: ReadonlyArray<{ diff: T; lifecycle: CardLifecycle; verdict: Verdict | null }>,
): ReviewSummary {
  let awaiting = 0;
  let approved = 0;
  let changes = 0;
  let landedClean = 0;
  for (const item of items) {
    const dirty = (item.diff?.additions ?? 0) > 0 || (item.diff?.deletions ?? 0) > 0;
    if (!dirty) landedClean += 1;
    if (item.verdict === "approved" || item.verdict === "merged") approved += 1;
    else if (item.verdict === "changes") changes += 1;
    else if (item.lifecycle === "review" || item.lifecycle === "completed") awaiting += 1;
  }
  return { awaiting, approved, changes, landedClean };
}

// ── Unified-diff line parsing (colored diff body) ────────────────────────────

export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "ctx";

export type DiffLine = { kind: DiffLineKind; mark: string; text: string };

/**
 * Split a unified diff into typed lines for the colored diff body. Classifies
 * each line by its leading marker — file/index headers as `meta`, `@@` hunk
 * headers as `hunk`, `+`/`-` as add/del (the `+++`/`---` file headers stay
 * `meta`), everything else as context. The leading marker is stripped into
 * `mark` so the body can render the sign in its own gutter.
 */
export function parseDiffLines(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  // A trailing newline yields a final empty element that isn't a real line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((raw) => {
    if (raw.startsWith("@@")) return { kind: "hunk", mark: "", text: raw };
    if (raw.startsWith("+++") || raw.startsWith("---")) return { kind: "meta", mark: "", text: raw };
    if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("new file") || raw.startsWith("deleted file") || raw.startsWith("rename ") || raw.startsWith("similarity ")) {
      return { kind: "meta", mark: "", text: raw };
    }
    if (raw.startsWith("+")) return { kind: "add", mark: "+", text: raw.slice(1) };
    if (raw.startsWith("-")) return { kind: "del", mark: "−", text: raw.slice(1) };
    return { kind: "ctx", mark: "", text: raw.startsWith(" ") ? raw.slice(1) : raw };
  });
}
