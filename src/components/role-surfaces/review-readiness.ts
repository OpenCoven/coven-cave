/**
 * review-readiness — one module, one truth about whether a pull request is safe
 * to merge, and what a reviewer has to say when it isn't.
 *
 * The Review Deck reduces three GitHub reads (`/api/github/item?pull=1`,
 * `/api/github/checks`, `/api/github/comments?isPull=1`) into a readiness
 * verdict plus a list of blockers written in plain words — each one naming who
 * clears it. Unknown is a first-class state: GitHub returns `mergeable: null`
 * while it computes the merge commit, and the deck says so rather than guessing.
 *
 * Kept JSX-free (type-only imports) so every rule here is unit-testable under
 * plain `node --experimental-strip-types`.
 */

import type { IconName } from "@/lib/icon";
import { countChecks, isFailConclusion, type CheckSummary } from "@/lib/github-checks";

export type ReviewTone = "success" | "warning" | "danger" | "accent" | "muted";

/** A check-run reduced to what the deck renders. */
export type ReadinessCheckRun = {
  name: string;
  /** GitHub's raw `status` — "completed" or an in-flight state. */
  status: string;
  /** GitHub's raw `conclusion`, null while the run is in flight. */
  conclusion: string | null;
  detailsUrl: string | null;
};

/** An unresolved inline review thread, flattened to its first comment. */
export type ReadinessThread = {
  id: string;
  /** "path:line" — where on the diff the thread hangs. */
  where: string;
  author: string;
  excerpt: string;
};

export type ReviewTally = { approved: number; changesRequested: number; commented: number };

/** The latest submitted review on GitHub — the author's own latest state wins. */
export type LatestReview = { state: string; author: string; submittedAt: string | null };

/**
 * Everything the deck knows about a pull request, after the three reads land.
 * Every field is read from GitHub; nothing here is inferred from this visit's
 * clicks.
 */
export type PrFacts = {
  repo: string;
  number: number;
  state: string;
  draft: boolean;
  merged: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** null while GitHub is still computing the merge commit. */
  mergeable: boolean | null;
  mergeableState: string;
  reviews: ReviewTally;
  latestReview: LatestReview | null;
  checks: { rollup: CheckSummary; runs: ReadinessCheckRun[] };
  threads: { unresolved: number; total: number; canResolve: boolean; items: ReadinessThread[] };
};

export type BlockerId = "draft" | "state" | "checks" | "threads" | "reviews" | "conflict" | "behind";

export type Blocker = {
  id: BlockerId;
  icon: IconName;
  tone: ReviewTone;
  /** What is wrong, in one line. */
  title: string;
  /** Who clears it and how — never an instruction the deck itself can carry out. */
  fix: string;
  /** Which rail disclosure reveals the evidence, when there is one. */
  reveal: "checks" | "threads" | null;
};

/** Check-run names that GitHub reports as a genuine, blocking failure. */
export function failingCheckNames(runs: readonly ReadinessCheckRun[]): string[] {
  return runs.filter((run) => run.status === "completed" && isFailConclusion(run.conclusion)).map((run) => run.name);
}

/**
 * Every reason this pull request cannot be merged right now, most structural
 * first. An empty list is not the same as "ready" — a PR with no approval has
 * no blockers and still isn't ready (see `isReadyToMerge`).
 */
export function prBlockers(pr: PrFacts | null): Blocker[] {
  if (!pr) return [];
  const out: Blocker[] = [];

  if (pr.draft) {
    out.push({
      id: "draft",
      icon: "ph:pencil-simple",
      tone: "muted",
      title: "Pull request is a draft",
      fix: "The author marks it ready for review before a verdict counts.",
      reveal: null,
    });
  }
  if (pr.state !== "open") {
    out.push({
      id: "state",
      icon: "ph:git-merge",
      tone: "muted",
      title: `Pull request is ${pr.merged ? "merged" : pr.state}`,
      fix: "Closed and merged pull requests leave the deck on the next read.",
      reveal: null,
    });
  }

  const failing = failingCheckNames(pr.checks.runs);
  if (failing.length > 0) {
    out.push({
      id: "checks",
      icon: "ph:x-circle-fill",
      tone: "danger",
      title: `${failing.length} required check ${failing.length === 1 ? "is" : "are"} failing`,
      fix: `${failing.join(", ")} — the author pushes a fix; the deck can't merge past a red check.`,
      reveal: "checks",
    });
  }
  if (pr.threads.unresolved > 0) {
    out.push({
      id: "threads",
      icon: "ph:chat-circle-dots",
      tone: "warning",
      title: `${pr.threads.unresolved} unresolved review ${pr.threads.unresolved === 1 ? "thread" : "threads"}`,
      fix: pr.threads.canResolve
        ? "Resolve them on GitHub, or ask the author to address them."
        : "Resolving threads needs a GitHub token — read-only here.",
      reveal: "threads",
    });
  }
  if (pr.reviews.changesRequested > 0) {
    out.push({
      id: "reviews",
      icon: "ph:arrow-bend-up-left",
      tone: "warning",
      title: "Changes requested and not yet dismissed",
      fix: "The requesting reviewer re-reviews, or dismisses the review on GitHub.",
      reveal: "checks",
    });
  }
  if (pr.mergeableState === "dirty") {
    out.push({
      id: "conflict",
      icon: "ph:warning-circle-fill",
      tone: "danger",
      title: `Merge conflicts with ${pr.baseRef}`,
      fix: "The author resolves conflicts locally — the deck never edits a working tree.",
      reveal: null,
    });
  }
  if (pr.mergeableState === "behind") {
    out.push({
      id: "behind",
      icon: "ph:git-commit",
      tone: "warning",
      title: `Branch is behind ${pr.baseRef}`,
      fix: `Update the branch on GitHub so checks run against current ${pr.baseRef}.`,
      reveal: null,
    });
  }
  return out;
}

/**
 * Safe to squash-merge: open, not a draft, GitHub says mergeable, checks green,
 * at least one standing approval, nothing requesting changes, no unresolved
 * threads. `mergeable: null` is not `true` — an unknown never reads as ready.
 */
export function isReadyToMerge(pr: PrFacts | null): boolean {
  if (!pr) return false;
  return (
    pr.state === "open" &&
    !pr.draft &&
    pr.mergeable === true &&
    pr.checks.rollup === "passing" &&
    pr.reviews.approved > 0 &&
    pr.reviews.changesRequested === 0 &&
    pr.threads.unresolved === 0
  );
}

// ── Queue buckets ────────────────────────────────────────────────────────────

export type ReviewBucket = "awaiting" | "changes" | "blocked" | "ready" | "draft" | "unread";

/**
 * What one `/api/github/item?pull=1` read tells the deck about a pull request.
 *
 * The strip has to bucket every row, and the full readiness fan-out is three
 * requests — too many to spend per queue row against the unauthenticated 60/hr
 * budget. This subset is one request, and it is enough because GitHub's own
 * `mergeable_state` already folds in failing required checks and missing
 * required reviews. The deck reports GitHub's verdict rather than recomputing
 * a weaker one from data it didn't fetch.
 */
export type PrBucketFacts = Pick<
  PrFacts,
  "state" | "draft" | "merged" | "mergeable" | "mergeableState" | "reviews" | "baseRef"
>;

/**
 * `mergeable_state` values that mean GitHub itself will refuse the merge.
 * "unknown" is absent deliberately — it means GitHub hasn't finished computing,
 * which is not the same as blocked.
 */
const BLOCKING_MERGE_STATES = new Set(["blocked", "dirty", "behind", "draft"]);

/**
 * The one bucket an item belongs to. Exclusive by construction, so the summary
 * strip's counts always add up to the deck and a reviewer's in-visit clicking
 * can never inflate one. A session with no pull request is review material
 * awaiting a reviewer's eyes, not a PR state; a pull request whose state hasn't
 * been read yet is "unread" rather than being guessed into a bucket.
 */
export function reviewBucket(pr: PrBucketFacts | null | undefined, hasPullRequest = false): ReviewBucket {
  if (!pr) return hasPullRequest ? "unread" : "awaiting";
  if (pr.draft) return "draft";
  if (pr.state !== "open") return "blocked";
  if (pr.reviews.changesRequested > 0) return "changes";
  if (pr.mergeable === false || BLOCKING_MERGE_STATES.has(pr.mergeableState)) return "blocked";
  // "clean" is GitHub's own all-clear: mergeable, required checks green,
  // required reviews satisfied. Anything short of it still needs someone.
  if (pr.mergeable === true && pr.mergeableState === "clean" && pr.reviews.approved > 0) return "ready";
  return "awaiting";
}

export type ReviewStateMeta = { label: string; tone: ReviewTone; title: string };

/** The queue row's state pill — what GitHub currently says about this item. */
export function reviewStateMeta(
  pr: PrBucketFacts | null | undefined,
  options: { hasPullRequest: boolean; hasLocalChanges: boolean },
): ReviewStateMeta {
  switch (reviewBucket(pr, options.hasPullRequest)) {
    case "unread":
      return { label: "Reading…", tone: "muted", title: "Reading this pull request's state from GitHub." };
    case "draft":
      return { label: "Draft", tone: "muted", title: "Draft pull request — not open for review yet." };
    case "changes":
      return {
        label: "Changes requested",
        tone: "warning",
        title: "A standing review requests changes, read from GitHub.",
      };
    case "blocked":
      return {
        label: "Blocked",
        tone: "danger",
        title:
          pr && pr.state !== "open"
            ? `Pull request is ${pr.merged ? "merged" : pr.state}.`
            : `GitHub reports mergeable_state: ${pr?.mergeableState ?? "unknown"}.`,
      };
    case "ready":
      return {
        label: "Ready to merge",
        tone: "success",
        title: "Approved and GitHub reports the branch clean against its base.",
      };
    default:
      if (!pr) {
        return options.hasLocalChanges
          ? {
              label: "Local changes",
              tone: "muted",
              title: "Uncommitted work in the session's project — no pull request is linked.",
            }
          : { label: "No changes", tone: "muted", title: "Nothing to review in this session's working tree." };
      }
      return { label: "Awaiting review", tone: "accent", title: "No approving review on GitHub yet." };
  }
}

export type ChecksMeta = { label: string; icon: IconName; tone: ReviewTone; title: string };

/** The compact checks pill shared by the queue row and the readiness pips. */
export function checksMeta(pr: PrFacts | null): ChecksMeta {
  if (!pr) {
    return {
      label: "no checks",
      icon: "ph:circle-dashed",
      tone: "muted",
      title: "Checks only exist for a pull request.",
    };
  }
  const counts = countChecks(pr.checks.runs);
  if (counts.total === 0) {
    return { label: "no checks", icon: "ph:circle-dashed", tone: "muted", title: "No CI has reported on this head." };
  }
  if (counts.failed > 0) {
    return {
      label: `${counts.failed} failing`,
      icon: "ph:x-circle-fill",
      tone: "danger",
      title: `${counts.failed} failing · ${counts.passed} passed · ${counts.pending} running`,
    };
  }
  if (counts.pending > 0) {
    return {
      label: `${counts.pending} running`,
      icon: "ph:hourglass",
      tone: "warning",
      title: `${counts.pending} running · ${counts.passed} passed`,
    };
  }
  return {
    label: `${counts.passed} passed`,
    icon: "ph:check-circle-fill",
    tone: "success",
    title: `all ${counts.passed} checks passed`,
  };
}

export type ReadinessBanner = { icon: IconName; tone: ReviewTone; headline: string; sub: string };

/** The rail's one-line answer to "can this land?", before any detail is opened. */
export function readinessBanner(pr: PrFacts | null, blockers: readonly Blocker[]): ReadinessBanner {
  if (!pr) {
    return {
      icon: "ph:info",
      tone: "muted",
      headline: "No pull request to check",
      sub: "Readiness comes from a pull request: state, mergeability, reviews, checks, and threads.",
    };
  }
  if (pr.draft) {
    return {
      icon: "ph:pencil-simple",
      tone: "muted",
      headline: "Draft — not open for review",
      sub: "Verdicts and merge stay disabled until the author marks it ready.",
    };
  }
  if (blockers.length > 0) {
    return {
      icon: "ph:warning-circle-fill",
      tone: "danger",
      headline: `Not safe to merge — ${blockers.length} ${blockers.length === 1 ? "blocker" : "blockers"}`,
      sub: "Each blocker below says who clears it. Merge is disabled while any remains.",
    };
  }
  if (isReadyToMerge(pr)) {
    return {
      icon: "ph:check-circle-fill",
      tone: "success",
      headline: "Ready to merge",
      sub: `Approved, checks green, no unresolved threads, no conflicts with ${pr.baseRef}.`,
    };
  }
  return {
    icon: "ph:hourglass",
    tone: "accent",
    headline: "Waiting on GitHub",
    sub:
      pr.mergeable === null
        ? "Mergeability is still computing; checks may still be running."
        : "No approving review submitted yet.",
  };
}

export type MergeChecklistRow = { label: string; detail: string; ok: boolean };

/** The pre-merge checklist shown in the squash-merge confirmation. */
export function mergeChecklist(pr: PrFacts | null): MergeChecklistRow[] {
  if (!pr) return [];
  return [
    { label: "Checks green", detail: checksMeta(pr).title, ok: pr.checks.rollup === "passing" },
    {
      label: "Approved",
      detail: `${pr.reviews.approved} approving review${pr.reviews.approved === 1 ? "" : "s"}, ${pr.reviews.changesRequested} requesting changes`,
      ok: pr.reviews.approved > 0 && pr.reviews.changesRequested === 0,
    },
    {
      label: "Review threads resolved",
      detail: `${pr.threads.unresolved} unresolved of ${pr.threads.total}`,
      ok: pr.threads.unresolved === 0,
    },
    {
      label: "Mergeable",
      detail: pr.mergeable === null ? "GitHub is still computing the merge commit" : `GitHub says ${pr.mergeableState}`,
      ok: pr.mergeable === true,
    },
    {
      label: "Not a draft",
      detail: pr.draft ? "Draft — the author must mark it ready" : "Open for review",
      ok: !pr.draft,
    },
  ];
}

// ── Request-changes evidence ─────────────────────────────────────────────────

export type EvidenceItem = {
  key: string;
  icon: IconName;
  tone: ReviewTone;
  /** The chip's short label. */
  label: string;
  title: string;
  /** The sentence this item contributes to a drafted review body. */
  line: string;
};

/**
 * The citable facts behind a change request. Nothing here is invented — every
 * item is a failing check, an unresolved thread, or a mergeability fact read
 * from this pull request.
 */
export function evidenceItems(pr: PrFacts | null): EvidenceItem[] {
  if (!pr) return [];
  const out: EvidenceItem[] = [];

  for (const name of failingCheckNames(pr.checks.runs)) {
    out.push({
      key: `check:${name}`,
      icon: "ph:x-circle-fill",
      tone: "danger",
      label: name,
      title: `Check run "${name}" failed on head ${pr.headSha.slice(0, 7)}.`,
      line: `${name} is failing on head ${pr.headSha.slice(0, 7)} — CI has to be green before this can land.`,
    });
  }

  for (const thread of pr.threads.items) {
    out.push({
      key: `thread:${thread.id}`,
      icon: "ph:chat-circle-dots",
      tone: "warning",
      label: thread.where.split("/").pop() || thread.where,
      title: `${thread.where} — ${thread.excerpt}`,
      line: `${thread.where} — ${thread.excerpt}`,
    });
  }

  const rest = pr.threads.unresolved - pr.threads.items.length;
  if (rest > 0) {
    out.push({
      key: "threads:rest",
      icon: "ph:chat-circle-dots",
      tone: "warning",
      label: `${rest} more thread${rest === 1 ? "" : "s"}`,
      title: `${rest} further unresolved review thread${rest === 1 ? "" : "s"} on this pull request.`,
      line: `${rest} further review thread${rest === 1 ? "" : "s"} still unresolved — please reply or resolve them.`,
    });
  }

  if (pr.mergeableState === "behind") {
    out.push({
      key: "behind",
      icon: "ph:git-commit",
      tone: "warning",
      label: `behind ${pr.baseRef}`,
      title: `Head is behind ${pr.baseRef}.`,
      line: `The branch is behind ${pr.baseRef} — update it so checks run against current ${pr.baseRef}.`,
    });
  }
  if (pr.mergeableState === "dirty") {
    out.push({
      key: "conflict",
      icon: "ph:warning-circle-fill",
      tone: "danger",
      label: "conflicts",
      title: `GitHub reports conflicts with ${pr.baseRef}.`,
      line: `The branch conflicts with ${pr.baseRef} — resolve locally and push; the deck never edits a working tree.`,
    });
  }
  return out;
}

/**
 * Compose a review body out of the evidence the reviewer kept. Every sentence
 * traces to live GitHub state — the draft is a starting point the reviewer
 * edits, not a verdict the deck writes on their behalf.
 */
export function draftChangeRequest(ref: string, picked: readonly EvidenceItem[]): string {
  if (picked.length === 0) return "";
  const head = `Holding ${ref} for now — ${picked.length} thing${picked.length === 1 ? "" : "s"} to clear before I can approve:`;
  const body = picked.map((item, i) => `${i + 1}. ${item.line}`).join("\n");
  const tail = "Re-request review once that's pushed and I'll take another pass.";
  return `${head}\n\n${body}\n\n${tail}`;
}

// ── Summary strip ────────────────────────────────────────────────────────────

export type DeckSummary = { awaiting: number; changes: number; blocked: number; ready: number };

export const DECK_BUCKETS: readonly (keyof DeckSummary)[] = ["awaiting", "changes", "blocked", "ready"];

/**
 * The four counts on the summary strip. Drafts are review material nobody has
 * been asked to look at yet, and an unread pull request is a fact the deck does
 * not have — both sit outside the four buckets rather than padding "awaiting",
 * which would make the strip claim knowledge it hasn't fetched.
 */
export function deckSummary(buckets: readonly ReviewBucket[]): DeckSummary {
  const summary: DeckSummary = { awaiting: 0, changes: 0, blocked: 0, ready: 0 };
  for (const bucket of buckets) {
    if (bucket === "draft" || bucket === "unread") continue;
    summary[bucket] += 1;
  }
  return summary;
}
