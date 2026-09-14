import type { PrBucketFacts, ReviewTally } from "./review-readiness";

export const REVIEW_READ_TIMEOUT_MS = 15_000;

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export type ReviewItemFacts = PrBucketFacts & {
  headRef: string;
  headSha: string;
  commits: number;
};

/** Missing state is not an open PR. Missing pull details are not zero reviews. */
export function parseReviewItem(value: unknown): ReviewItemFacts {
  const item = record(value);
  if (
    item?.ok !== true || item.isPull !== true ||
    (item.state !== "open" && item.state !== "closed") ||
    typeof item.draft !== "boolean" || typeof item.merged !== "boolean"
  ) throw new Error("GitHub returned an incomplete pull request state.");

  const pull = record(item.pull);
  const reviews = record(pull?.reviews);
  const terminal = item.merged || item.state === "closed";
  if (!terminal && (
    !pull || !reviews || !count(reviews.approved) ||
    !count(reviews.changesRequested) || !count(reviews.commented) ||
    (pull.mergeable !== null && typeof pull.mergeable !== "boolean") ||
    typeof pull.mergeableState !== "string" || !pull.mergeableState ||
    typeof pull.baseRef !== "string"
  )) throw new Error("GitHub pull request details are unavailable.");

  const tally: ReviewTally = {
    approved: count(reviews?.approved) ? reviews.approved : 0,
    changesRequested: count(reviews?.changesRequested) ? reviews.changesRequested : 0,
    commented: count(reviews?.commented) ? reviews.commented : 0,
  };
  return {
    state: item.state,
    draft: item.draft,
    merged: item.merged,
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : undefined,
    baseRef: typeof pull?.baseRef === "string" ? pull.baseRef : "",
    headRef: typeof pull?.headRef === "string" ? pull.headRef : "",
    headSha: typeof pull?.headSha === "string" ? pull.headSha : "",
    commits: count(pull?.commits) ? pull.commits : 0,
    statsKnown: count(pull?.additions) && count(pull?.deletions),
    additions: count(pull?.additions) ? pull.additions : undefined,
    deletions: count(pull?.deletions) ? pull.deletions : undefined,
    changedFiles: count(pull?.changedFiles) ? pull.changedFiles : undefined,
    mergeable: typeof pull?.mergeable === "boolean" ? pull.mergeable : null,
    mergeableState: typeof pull?.mergeableState === "string" ? pull.mergeableState : "unknown",
    reviews: tally,
  };
}

/** Race the whole read, including JSON parsing, against cancellation/deadline. */
export async function readReviewJson(
  url: string,
  signal: AbortSignal,
  timeoutMs = REVIEW_READ_TIMEOUT_MS,
): Promise<unknown> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("GitHub read timed out.")), timeoutMs);
  const combined = AbortSignal.any([signal, deadline.signal]);
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      (async () => {
        combined.throwIfAborted();
        const response = await fetch(url, { cache: "no-store", signal: combined });
        if (!response.ok) throw new Error(`GitHub read failed (HTTP ${response.status}).`);
        const value: unknown = await response.json();
        const envelope = record(value);
        if (envelope?.ok !== true) {
          throw new Error(typeof envelope?.error === "string" ? envelope.error : "GitHub returned an invalid response.");
        }
        return value;
      })(),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(combined.reason);
        combined.addEventListener("abort", onAbort, { once: true });
        if (combined.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}
