// Automatic review of your own pull requests when they're marked ready
// (#5930 part 2): the pure trigger rules.
//
// This module only decides WHICH pull requests should get a review now. It
// starts nothing, reads no network, and touches no file. The watcher that
// would call it is not built yet: Cave has no supported way to start a
// read-only background familiar session from the server (see #5930). These
// rules are pinned now so that watcher has one tested contract to follow.
//
// The rules (from the issue):
//   - Turning the setting on records a BASELINE. PRs already ready do not fire.
//   - Fire when a PR is seen going from draft to ready, or when a PR first
//     appears already ready after the baseline.
//   - Fire ONCE per PR. Later pushes, and draft → ready again, do not re-fire.
//     (A manual Review row in the launcher still re-runs; that is not here.)
//   - Closed and merged PRs drop out of state.
//   - Poll REST at most every 3 minutes and back off on rate limits. Never
//     GraphQL: that budget is shared by every agent signed in as the user.

/** One PR as the watcher would persist it (under COVEN_CAVE_HOME). */
export type OwnPrWatchEntry = {
  /** Draft at the last observation. */
  lastDraft: boolean;
  /** When the automatic review fired; non-null means it never fires again. */
  reviewedAt: string | null;
  /** The head the review was started on. Later pushes keep this value. */
  reviewedHeadSha: string | null;
  /** The background session the caller started, once it records it. */
  sessionId: string | null;
};

export type OwnPrWatchState = {
  version: 1;
  /** When the setting was turned on; null means no baseline yet. */
  baselineAt: string | null;
  /** Keyed by PR URL. */
  prs: Record<string, OwnPrWatchEntry>;
};

export type OwnPrObservation = {
  prs: Array<{
    url: string;
    draft: boolean;
    headSha: string | null;
    /** The search is `is:open`; a PR read some other way may say it closed. */
    state?: "open" | "closed" | "merged";
  }>;
  /** Every open PR is listed. A capped search page is NOT complete, and an
   *  absent PR there may only be past the first page, so nothing is pruned
   *  for being absent. */
  complete: boolean;
};

export function emptyOwnPrWatchState(): OwnPrWatchState {
  return { version: 1, baselineAt: null, prs: {} };
}

function entry(draft: boolean): OwnPrWatchEntry {
  return { lastDraft: draft, reviewedAt: null, reviewedHeadSha: null, sessionId: null };
}

/**
 * The next state and the PR URLs to review now. Pure: `prev` is never
 * mutated. A fired PR is stamped `reviewedAt: now` here, so a second plan over
 * the same observation can never fire it twice; the caller records the
 * session id it starts.
 */
export function planOwnPrAutoReviews(
  prev: OwnPrWatchState,
  observed: OwnPrObservation,
  opts: { enabled: boolean; now: string },
): { state: OwnPrWatchState; fire: string[] } {
  // Off forgets everything, so turning it on again records a fresh baseline.
  if (!opts.enabled) return { state: emptyOwnPrWatchState(), fire: [] };

  const open = observed.prs.filter((pr) => (pr.state ?? "open") === "open");
  const closed = new Set(observed.prs.filter((pr) => (pr.state ?? "open") !== "open").map((pr) => pr.url));

  if (prev.baselineAt == null) {
    if (!observed.complete) {
      return { state: { ...prev, prs: { ...prev.prs } }, fire: [] };
    }
    const prs: Record<string, OwnPrWatchEntry> = {};
    for (const pr of open) prs[pr.url] = entry(pr.draft);
    return { state: { version: 1, baselineAt: opts.now, prs }, fire: [] };
  }

  const prs: Record<string, OwnPrWatchEntry> = {};
  const fire: string[] = [];
  const seenNow = new Set<string>();

  for (const pr of open) {
    seenNow.add(pr.url);
    const known = prev.prs[pr.url];
    if (!known) {
      // First seen after the baseline: opened ready fires; a draft waits.
      if (pr.draft) {
        prs[pr.url] = entry(true);
      } else {
        prs[pr.url] = { lastDraft: false, reviewedAt: opts.now, reviewedHeadSha: pr.headSha, sessionId: null };
        fire.push(pr.url);
      }
      continue;
    }
    const wentReady = known.lastDraft && !pr.draft;
    if (wentReady && known.reviewedAt == null) {
      prs[pr.url] = { ...known, lastDraft: false, reviewedAt: opts.now, reviewedHeadSha: pr.headSha };
      fire.push(pr.url);
    } else {
      prs[pr.url] = { ...known, lastDraft: pr.draft };
    }
  }

  // Keep PRs this observation could not see, unless it is complete (the
  // search is is:open, so absent means closed or merged) or it says so.
  for (const [url, known] of Object.entries(prev.prs)) {
    if (seenNow.has(url) || closed.has(url) || observed.complete) continue;
    prs[url] = { ...known };
  }

  return { state: { version: 1, baselineAt: prev.baselineAt, prs }, fire };
}

/** The 3-minute floor between REST polls. */
export const OWN_PR_POLL_MIN_MS = 3 * 60_000;
/**
 * The longest the exponential fallback, or an exhausted rate limit's reset,
 * waits. GitHub's rate-limit window is an hour, so a reset further out than
 * that means the local clock is behind (the reset is an absolute time) and is
 * not trusted past it.
 */
export const OWN_PR_POLL_MAX_MS = 60 * 60_000;

/**
 * The longest an explicit `retry-after` is honoured. It is relative, so clock
 * skew can't stretch it, and it is honoured past the hour (polling before it
 * only hits GitHub while it still refuses). This ceiling keeps a bogus value
 * from producing a delay no timer can hold: past 2^31-1 ms a `setTimeout`
 * fires at once.
 */
export const OWN_PR_RETRY_AFTER_MAX_MS = 24 * 60 * 60_000;

export type OwnPrPollOutcome = {
  status: number;
  /** `x-ratelimit-remaining`, when GitHub sent it. */
  rateLimitRemaining?: number | null;
  /** `x-ratelimit-reset`, epoch seconds. */
  rateLimitResetSec?: number | null;
  /** `retry-after`, seconds. */
  retryAfterSec?: number | null;
  nowMs: number;
  /** Failed polls in a row, including this one. */
  consecutiveFailures: number;
};

/**
 * How long to wait before the next poll. Never less than the 3-minute floor.
 * `retry-after` is honoured in full, up to a day. An exhausted rate limit
 * waits for its reset, up to an hour. Any other failure backs off
 * exponentially from the floor, capped at an hour. A missing, negative or
 * non-finite header is ignored rather than trusted.
 */
export function nextOwnPrPollDelayMs(outcome: OwnPrPollOutcome): number {
  const between = (ms: number, max: number) => Math.min(max, Math.max(OWN_PR_POLL_MIN_MS, ms));
  const ok = outcome.status >= 200 && outcome.status < 300;
  if (ok) return OWN_PR_POLL_MIN_MS;

  const usable = (value: number | null | undefined): value is number =>
    value != null && Number.isFinite(value) && value >= 0;
  if (usable(outcome.retryAfterSec)) {
    return between(outcome.retryAfterSec * 1000, OWN_PR_RETRY_AFTER_MAX_MS);
  }
  const limited = outcome.status === 403 || outcome.status === 429;
  if (limited && outcome.rateLimitRemaining === 0 && usable(outcome.rateLimitResetSec)) {
    return between(outcome.rateLimitResetSec * 1000 - outcome.nowMs, OWN_PR_POLL_MAX_MS);
  }
  const failures = Math.max(1, outcome.consecutiveFailures);
  return between(OWN_PR_POLL_MIN_MS * 2 ** failures, OWN_PR_POLL_MAX_MS);
}
