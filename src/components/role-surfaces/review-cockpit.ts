/**
 * review-cockpit — the Review Deck cockpit's own view model.
 *
 * Everything the cockpit chrome needs that is not already a readiness fact:
 * how the queue is ordered and mixed, which blocker a reviewer should clear
 * first and who owns it, the one decision sentence the inspector leads with,
 * and how the file rail windows its chips.
 *
 * Kept JSX-free (type-only imports) so every rule here is unit-testable under
 * plain `node --experimental-strip-types`.
 *
 * Nothing here invents a fact. The frame this implements paints a numeric
 * "attention score" per row; no such number exists — so the order is stated
 * for what it actually is (blocked first, then oldest), and the control says
 * so rather than showing a score the deck would have had to make up.
 */

import type { Blocker, BlockerId, DeckSummary, ReviewTone } from "./review-readiness";

// ── Queue ordering ───────────────────────────────────────────────────────────

export type ReviewQueueSort = "attention" | "repo";

export type CockpitBucket = keyof DeckSummary | "draft";

/**
 * The order the queue's groups appear in, and the order a row inside one is
 * ranked by. Blocked leads because an agent is stopped waiting on a human;
 * drafts trail because nobody has been asked to look at them yet.
 */
export const COCKPIT_BUCKET_ORDER: readonly CockpitBucket[] = [
  "blocked",
  "changes",
  "awaiting",
  "ready",
  "draft",
];

export type CockpitBucketMeta = {
  label: string;
  tone: ReviewTone;
  /** Why this group exists, in the reviewer's words. */
  hint: string;
  /** What the group says when the whole deck has nothing in it. */
  empty: string;
};

export const COCKPIT_BUCKETS: Record<CockpitBucket, CockpitBucketMeta> = {
  blocked: {
    label: "Blocked",
    tone: "danger",
    hint: "agents waiting on humans",
    empty: "Nothing blocked.",
  },
  changes: {
    label: "Changes requested",
    tone: "warning",
    hint: "waiting on authors",
    empty: "Your change requests land here.",
  },
  awaiting: {
    label: "Needs review",
    tone: "accent",
    hint: "oldest first",
    empty: "No work awaiting review.",
  },
  ready: {
    label: "Ready",
    tone: "success",
    hint: "approved + clean",
    empty: "Approvals land here.",
  },
  draft: {
    label: "Outside the counts",
    tone: "muted",
    hint: "drafts + still being read",
    empty: "",
  },
};

export function bucketRank(bucket: CockpitBucket): number {
  const index = COCKPIT_BUCKET_ORDER.indexOf(bucket);
  return index < 0 ? COCKPIT_BUCKET_ORDER.length : index;
}

export type QueueSortable = {
  id: string;
  bucket: CockpitBucket;
  repo: string;
  /** ISO instant of the session's last update — oldest sorts first. */
  updatedAt: string;
};

/**
 * Order the queue.
 *
 * "attention" is blocked first, then oldest inside each group: an item nobody
 * has answered for two days outranks one that arrived a minute ago. "repo"
 * groups by repository first so a reviewer can clear one project at a time,
 * and keeps the same attention order inside it.
 *
 * Ties break on id so the order is stable across re-reads — a queue that
 * reshuffles under the cursor loses the reviewer's place.
 */
export function orderReviewQueue<T extends QueueSortable>(
  items: readonly T[],
  sort: ReviewQueueSort,
): T[] {
  return items.slice().sort((a, b) => {
    if (sort === "repo") {
      const repo = a.repo.localeCompare(b.repo);
      if (repo !== 0) return repo;
    }
    const rank = bucketRank(a.bucket) - bucketRank(b.bucket);
    if (rank !== 0) return rank;
    const age = a.updatedAt.localeCompare(b.updatedAt);
    if (age !== 0) return age;
    return a.id.localeCompare(b.id);
  });
}

export const REVIEW_QUEUE_SORT_TITLES: Record<ReviewQueueSort, string> = {
  attention: "Order by attention — blocked first, then oldest",
  repo: "Group by repository, then attention",
};

// ── Queue mix bar ────────────────────────────────────────────────────────────

export type QueueMixSegment = {
  bucket: CockpitBucket;
  label: string;
  tone: ReviewTone;
  count: number;
};

/**
 * The proportional bar above the queue: one segment per non-empty bucket, in
 * attention order. Buckets with nothing in them are dropped rather than drawn
 * as a zero-width sliver nobody can hit or read.
 */
export function queueMix(buckets: readonly CockpitBucket[]): QueueMixSegment[] {
  const counts = new Map<CockpitBucket, number>();
  for (const bucket of buckets) {
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return COCKPIT_BUCKET_ORDER.flatMap((bucket) => {
    const count = counts.get(bucket) ?? 0;
    if (count === 0) return [];
    return [
      {
        bucket,
        label: COCKPIT_BUCKETS[bucket].label,
        tone: COCKPIT_BUCKETS[bucket].tone,
        count,
      },
    ];
  });
}

// ── Queue row reason ─────────────────────────────────────────────────────────

/**
 * The short "why is this here" a queue row carries under its title.
 *
 * Deliberately derived from the **one** pull-request read the queue can afford
 * per row, never from the three-request readiness fan-out — so it can say
 * "conflicts with main" (GitHub's own `mergeable_state`) but never "3 checks
 * failing", which needs check runs the queue has not fetched. A row that named
 * a count it had not read would be the strip claiming knowledge it lacks.
 *
 * Empty when the state pill already says everything known.
 */
export function queueRowReason(
  facts:
    | {
        draft: boolean;
        state: string;
        merged: boolean;
        mergeable: boolean | null;
        mergeableState: string;
        reviews: { approved: number; changesRequested: number };
        baseRef: string;
      }
    | null
    | undefined,
  options: { hasPullRequest: boolean; hasLocalChanges: boolean },
): string {
  if (!facts) {
    if (options.hasPullRequest) return "reading GitHub state";
    return options.hasLocalChanges ? "uncommitted work" : "";
  }
  if (facts.draft) return "draft";
  if (facts.state !== "open") return facts.merged ? "merged" : facts.state;
  if (facts.reviews.changesRequested > 0) return "changes requested";
  if (facts.mergeableState === "dirty") return `conflicts with ${facts.baseRef}`;
  if (facts.mergeableState === "behind") return `behind ${facts.baseRef}`;
  if (facts.mergeableState === "blocked") return "blocked by branch protection";
  if (
    facts.mergeable === true &&
    facts.mergeableState === "clean" &&
    facts.reviews.approved > 0
  ) {
    return "approved · clean";
  }
  if (facts.mergeable === null) return "mergeability computing";
  return "";
}

// ── Blocker triage ───────────────────────────────────────────────────────────

/**
 * How hard a blocker stops the merge, and who has to move.
 *
 * BLOCKING   — GitHub itself refuses; nothing a reviewer does clears it.
 * NEEDS YOU  — the reviewer is the one holding it.
 * WAITING    — a verdict is already recorded; the author owes a new head.
 * NOT READY  — the item is not open for review at all.
 */
export type BlockerSeverity = "BLOCKING" | "NEEDS YOU" | "WAITING" | "NOT READY";

export type BlockerOwner = "You" | "Author" | "Either";

const SEVERITY_RANK: Record<BlockerSeverity, number> = {
  BLOCKING: 0,
  "NEEDS YOU": 1,
  WAITING: 2,
  "NOT READY": 3,
};

export type BlockerTriage = { severity: BlockerSeverity; owner: BlockerOwner };

/**
 * Triage one blocker. `canResolveThreads` decides whether an unresolved
 * thread is the reviewer's to clear: without a write-scoped token the deck
 * can only report it, so it is not honest to tell the reviewer it is theirs.
 */
export function triageBlocker(
  id: BlockerId,
  options: { canResolveThreads?: boolean } = {},
): BlockerTriage {
  switch (id) {
    case "checks":
    case "conflict":
      return { severity: "BLOCKING", owner: "Author" };
    case "threads":
      return {
        severity: "NEEDS YOU",
        owner: options.canResolveThreads ? "You" : "Either",
      };
    case "behind":
      return { severity: "NEEDS YOU", owner: "Either" };
    case "reviews":
      return { severity: "WAITING", owner: "Author" };
    case "draft":
    case "state":
      return { severity: "NOT READY", owner: "Author" };
    default:
      return { severity: "NEEDS YOU", owner: "Either" };
  }
}

export type TriagedBlocker = Blocker & BlockerTriage;

/** Blockers in the order a reviewer should work them: hardest stop first. */
export function triageBlockers(
  blockers: readonly Blocker[],
  options: { canResolveThreads?: boolean } = {},
): TriagedBlocker[] {
  return blockers
    .map((blocker) => ({ ...blocker, ...triageBlocker(blocker.id, options) }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** How many of these are the reviewer's own to clear. */
export function blockersOwnedByYou(
  blockers: readonly TriagedBlocker[],
): number {
  return blockers.filter((blocker) => blocker.owner === "You").length;
}

// ── The one decision sentence ────────────────────────────────────────────────

export type ReviewDecision = {
  headline: string;
  sub: string;
  /** The single next action, phrased as something the reviewer can do now. */
  next: string;
  tone: ReviewTone;
};

function remainingFiles(reviewed: number, readable: number): number {
  return Math.max(0, readable - reviewed);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The inspector's lead: what this item's state means, and the one thing to do
 * about it. Every branch is reachable from facts the deck has already read —
 * an unknown says it is unknown rather than guessing a next step.
 */
export function reviewDecision(input: {
  selected: boolean;
  isPr: boolean;
  draft: boolean;
  ready: boolean;
  blockers: readonly TriagedBlocker[];
  checksPending: boolean;
  mergeableUnknown: boolean;
  reviewedCount: number;
  readableCount: number;
}): ReviewDecision {
  if (!input.selected) {
    return {
      headline: "Nothing selected",
      sub: "The queue holds every session carrying review material.",
      next: "Pick an item from the queue.",
      tone: "muted",
    };
  }

  const left = remainingFiles(input.reviewedCount, input.readableCount);
  const readMore = `Read ${plural(left, "more file")}`;

  if (!input.isPr) {
    return {
      headline: "Local review only",
      sub: "No pull request is linked, so GitHub state, checks and verdicts don't exist for this session yet.",
      next:
        left > 0
          ? `${readMore}, then open a pull request to unlock verdicts.`
          : "Open a pull request to unlock verdicts.",
      tone: "warning",
    };
  }

  if (input.draft) {
    return {
      headline: "Draft — not open for review",
      sub: "The author is still working. Verdicts don't count until it's marked ready.",
      next: "Nothing to do here. Move on with ].",
      tone: "muted",
    };
  }

  if (input.blockers.length > 0) {
    const mine = blockersOwnedByYou(input.blockers);
    const theirs = input.blockers.length - mine;
    return {
      headline: "Not safe to merge",
      sub: `${plural(input.blockers.length, "blocker")} · ${
        mine > 0 ? `${mine} need${mine === 1 ? "s" : ""} you, ` : ""
      }${theirs} on the author.`,
      next:
        mine > 0
          ? `Clear your ${plural(mine, "item")}, then request changes citing the rest.`
          : "Request changes citing these blockers.",
      tone: "danger",
    };
  }

  if (input.ready) {
    return {
      headline: "Ready to merge",
      sub: "Approved, checks green, no unresolved threads, clean against the base.",
      next:
        left > 0
          ? `You've read ${input.reviewedCount} of ${input.readableCount} files — finish or merge as-is.`
          : "Squash & merge.",
      tone: "success",
    };
  }

  if (input.checksPending || input.mergeableUnknown) {
    return {
      headline: "Waiting on GitHub",
      sub: input.checksPending
        ? "Checks are still running; mergeability is still computing."
        : "GitHub hasn't finished computing the merge commit.",
      next:
        left > 0
          ? `${readMore} while it settles.`
          : "All files read — approve or request changes once GitHub settles.",
      tone: "accent",
    };
  }

  return {
    headline: "Awaiting your review",
    sub: "No approving review yet — yours would be the first.",
    next:
      left > 0
        ? `${readMore}, then approve.`
        : "All files read — approve or request changes.",
    tone: "accent",
  };
}

// ── File chip rail ───────────────────────────────────────────────────────────

export type FileChipState = "current" | "reviewed" | "flagged" | "unread";

/** What the chip's dot says about one file. Current wins — it is where you are. */
export function fileChipState(input: {
  current: boolean;
  reviewed: boolean;
  flagged: boolean;
}): FileChipState {
  if (input.current) return "current";
  if (input.reviewed) return "reviewed";
  if (input.flagged) return "flagged";
  return "unread";
}

export type FileChipWindow = {
  start: number;
  end: number;
  hidden: number;
};

/**
 * Which slice of the file list the rail shows.
 *
 * The rail is one row and never wraps, so it keeps the open file visible and
 * reports the rest as a "+N" chip rather than scrolling it out of reach. The
 * window is clamped to the list, so a change with fewer files than the cap
 * shows all of them and hides nothing.
 */
export function fileChipWindow(
  total: number,
  currentIndex: number,
  capacity: number,
): FileChipWindow {
  const cap = Math.max(1, Math.min(capacity, total));
  if (total <= cap) return { start: 0, end: total, hidden: 0 };
  const index = Math.max(0, Math.min(currentIndex, total - 1));
  const start = Math.max(0, Math.min(index - cap + 1, total - cap));
  return { start, end: start + cap, hidden: total - cap };
}

/**
 * How many chips fit. Derived from the measured centre-pane width so a narrow
 * workspace shows fewer rather than clipping one mid-word; two is the floor,
 * because one chip cannot show you moved.
 */
export function fileChipCapacity(centreWidth: number): number {
  const reserved = 300;
  const chip = centreWidth < 620 ? 108 : 152;
  return Math.max(2, Math.min(9, Math.floor((centreWidth - reserved) / chip)));
}

// ── Review threads, in the diff ──────────────────────────────────────────────

export type DiffThread = {
  id: string;
  where: string;
  author: string;
  excerpt: string;
};

export type ThreadRow = { kind: "thread"; key: string; thread: DiffThread };

/**
 * Which line of the open file a thread hangs on, or null when GitHub anchored
 * it to the file rather than a line (`path` with no `:line`), or to a
 * different file entirely.
 */
export function threadLine(where: string, path: string): number | null {
  if (!where.startsWith(path)) return null;
  const rest = where.slice(path.length);
  if (rest === "") return null;
  const match = /^:(\d+)$/.exec(rest);
  return match ? Number(match[1]) : null;
}

/**
 * Interleave a pull request's unresolved threads into the diff, each directly
 * under the line it was left on.
 *
 * A thread whose line is not in the visible rows — folded away, or past a
 * server-side patch truncation — is returned separately rather than dropped
 * silently or pinned to the wrong line. Losing a reviewer's own open question
 * because the diff was folded is exactly the failure this ordering exists to
 * prevent.
 */
export function interleaveThreads<T extends { kind: string; key: string }>(
  rows: readonly T[],
  threads: readonly DiffThread[],
  path: string,
  lineOf: (row: T) => number | null,
): { rows: Array<T | ThreadRow>; unplaced: DiffThread[] } {
  const byLine = new Map<number, DiffThread[]>();
  const unplaced: DiffThread[] = [];
  for (const thread of threads) {
    const line = threadLine(thread.where, path);
    if (line == null) {
      unplaced.push(thread);
      continue;
    }
    const bucket = byLine.get(line);
    if (bucket) bucket.push(thread);
    else byLine.set(line, [thread]);
  }

  const out: Array<T | ThreadRow> = [];
  const placed = new Set<string>();
  for (const row of rows) {
    out.push(row);
    const line = lineOf(row);
    if (line == null) continue;
    for (const thread of byLine.get(line) ?? []) {
      out.push({ kind: "thread", key: `thread-${thread.id}`, thread });
      placed.add(thread.id);
    }
  }

  for (const [, bucket] of byLine) {
    for (const thread of bucket) {
      if (!placed.has(thread.id)) unplaced.push(thread);
    }
  }
  return { rows: out, unplaced };
}

// ── Pane sizing ──────────────────────────────────────────────────────────────

export const QUEUE_PANE = { min: 210, max: 460, initial: 290 } as const;
export const INSPECTOR_PANE = { min: 240, max: 460, initial: 312 } as const;

/**
 * Clamp a dragged pane to its own bounds and to a share of the window, so a
 * pane dragged wide on a large display does not swallow the diff when the
 * window is later made small. The diff is the surface being read; the rails
 * report on it.
 */
export function clampPaneWidth(
  width: number,
  bounds: { min: number; max: number },
  viewportWidth: number,
  share: number,
): number {
  const ceiling = Math.min(bounds.max, Math.round(viewportWidth * share));
  return Math.max(bounds.min, Math.min(width, Math.max(bounds.min, ceiling)));
}
