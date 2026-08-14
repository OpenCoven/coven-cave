/**
 * Pure model for the full PR reader (cave-l82dm).
 *
 * Frame: `Coven Pr.dc.html`, which the Coding Desk's review rail links to as
 * "Full PR view". This module owns the arithmetic the reader's chrome is built
 * from — tab vocabulary, the check rollup behind the donut, and the landing
 * gates — so the component stays a renderer and the honesty rules below are
 * testable rather than aspirational.
 *
 * Two of those rules are load-bearing:
 *
 *  - **Never claim "required" for a check we cannot verify.** GitHub's
 *    check-run payload does not say whether a context is required; that lives
 *    in branch protection. `summarizePrChecks` reports failing/passing/pending
 *    and nothing else, and `prLandingGates` marks the checks gate `unknown`
 *    rather than `blocked` when it has runs but no required-context list.
 *  - **A gate whose answer is unknown is not a pass.** The frame paints three
 *    bars (checks, review, conflicts); an unknown one renders as unknown, so a
 *    reader never mistakes "we could not tell" for "clear".
 */

/** Reader tabs, in the frame's order. */
export const PR_READER_TABS = ["conversation", "commits", "checks", "files"] as const;
export type PrReaderTab = (typeof PR_READER_TABS)[number];

export function isPrReaderTab(value: string | null | undefined): value is PrReaderTab {
  return (PR_READER_TABS as readonly string[]).includes(value ?? "");
}

export type PrCheckRun = {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  completedAt?: string | null;
  detailsUrl?: string | null;
};

export type PrCheckCounts = {
  failing: number;
  passing: number;
  /** Queued or in-progress. */
  pending: number;
  /** Skipped or neutral — reported separately so they never read as passes. */
  neutral: number;
  total: number;
};

/**
 * Count check runs by outcome.
 *
 * `neutral` is deliberately its own bucket. Folding skipped/neutral runs into
 * `passing` is how a rollup starts claiming a suite ran when half of it was
 * skipped — the exact shape of a green wall that means nothing.
 */
export function summarizePrChecks(runs: readonly PrCheckRun[]): PrCheckCounts {
  let failing = 0;
  let passing = 0;
  let pending = 0;
  let neutral = 0;
  for (const run of runs) {
    if (run.status !== "completed") {
      pending += 1;
    } else if (run.conclusion === "success") {
      passing += 1;
    } else if (run.conclusion === "skipped" || run.conclusion === "neutral") {
      neutral += 1;
    } else {
      failing += 1;
    }
  }
  return { failing, passing, pending, neutral, total: runs.length };
}

/** The frame's headline over the donut. */
export function prChecksHeadline(counts: PrCheckCounts): string {
  if (counts.total === 0) return "No checks reported";
  if (counts.failing > 0) return "Some checks were not successful";
  if (counts.pending > 0) return "Checks are still running";
  return "All checks have passed";
}

export type PrGateState = "pass" | "blocked" | "pending" | "unknown";

export type PrLandingGate = {
  id: "checks" | "review" | "conflicts";
  label: string;
  state: PrGateState;
  /** One line saying why it reads that way. Never empty. */
  detail: string;
};

export type PrGateInput = {
  counts: PrCheckCounts;
  /** Review tally from `/api/github/item?pull=1`. */
  reviews?: { approved: number; changesRequested: number } | null;
  /** GitHub's `mergeable` — null while it is still computing the merge commit. */
  mergeable?: boolean | null;
  mergeableState?: string | null;
};

/**
 * The frame's three landing gates.
 *
 * Every branch here can return `unknown`, and that is the point: GitHub answers
 * "is this mergeable?" with null while it computes, and answers "is this check
 * required?" not at all. A gate row that rendered those as a pass would be the
 * single most dangerous thing on this surface.
 */
export function prLandingGates(input: PrGateInput): PrLandingGate[] {
  const { counts, reviews, mergeable, mergeableState } = input;

  const checks: PrLandingGate =
    counts.total === 0
      ? { id: "checks", label: "checks", state: "unknown", detail: "no checks reported" }
      : counts.failing > 0
        ? {
            id: "checks",
            label: "checks",
            state: "blocked",
            detail: `${counts.failing} failing`,
          }
        : counts.pending > 0
          ? {
              id: "checks",
              label: "checks",
              state: "pending",
              detail: `${counts.pending} still running`,
            }
          : { id: "checks", label: "checks", state: "pass", detail: `${counts.passing} passed` };

  const review: PrLandingGate = !reviews
    ? { id: "review", label: "review", state: "unknown", detail: "review state unavailable" }
    : reviews.changesRequested > 0
      ? { id: "review", label: "review", state: "blocked", detail: "changes requested" }
      : reviews.approved > 0
        ? {
            id: "review",
            label: "review",
            state: "pass",
            detail: `${reviews.approved} approved`,
          }
        : { id: "review", label: "review", state: "pending", detail: "no review yet" };

  const conflicts: PrLandingGate =
    mergeable === false
      ? { id: "conflicts", label: "conflicts", state: "blocked", detail: mergeableState || "conflicts with the base" }
      : mergeable === true
        ? { id: "conflicts", label: "conflicts", state: "pass", detail: "none with the base" }
        : {
            id: "conflicts",
            label: "conflicts",
            state: "unknown",
            // This is GitHub's documented behaviour, not a failure of ours.
            detail: "GitHub is still computing the merge commit",
          };

  return [checks, review, conflicts];
}

/**
 * Can this PR be merged from here, and if not, why?
 *
 * `canMerge` is false whenever ANY gate is not a pass — including `unknown`.
 * The merge button on this surface never overrides a gate, and "we could not
 * tell" is not permission.
 */
export function prMergeVerdict(gates: readonly PrLandingGate[]): {
  canMerge: boolean;
  reason: string;
} {
  const blocked = gates.filter((gate) => gate.state === "blocked");
  if (blocked.length) {
    return {
      canMerge: false,
      reason: `Blocked by ${blocked.map((gate) => gate.label).join(" and ")}.`,
    };
  }
  const unresolved = gates.filter((gate) => gate.state !== "pass");
  if (unresolved.length) {
    return {
      canMerge: false,
      reason: `Waiting on ${unresolved.map((gate) => gate.label).join(" and ")}.`,
    };
  }
  return { canMerge: true, reason: "Every gate is clear." };
}

/**
 * The frame's five-block stat strip beside the diffstat: how many blocks are
 * "added" out of five. Rounds toward showing at least one block of each colour
 * whenever both exist, so a 1-line deletion in a 900-line PR is still visible.
 */
export function prStatBlocks(additions: number, deletions: number, blocks = 5): number {
  const add = Math.max(0, additions);
  const del = Math.max(0, deletions);
  const total = add + del;
  if (total === 0) return 0;
  if (del === 0) return blocks;
  if (add === 0) return 0;
  const raw = Math.round((add / total) * blocks);
  return Math.min(blocks - 1, Math.max(1, raw));
}
