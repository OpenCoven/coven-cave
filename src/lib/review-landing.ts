import type { CheckSummary } from "./github/github-checks.ts";

export type ReviewGateState = "pass" | "blocked" | "pending" | "unknown";

export type ReviewLandingState = {
  checks: ReviewGateState;
  review: ReviewGateState;
  conflicts: ReviewGateState;
  threads: ReviewGateState;
  canReview: boolean;
  canMerge: boolean;
  hasUnknown: boolean;
};

export type ReviewLandingInput = {
  state: string | null | undefined;
  draft: boolean | null | undefined;
  checks: CheckSummary;
  reviews: { approved: number; changesRequested: number } | null | undefined;
  mergeable: boolean | null | undefined;
  mergeableState: string | null | undefined;
  unresolvedThreads: number | null | undefined;
};

function checksGate(summary: CheckSummary): ReviewGateState {
  if (summary === "passing") return "pass";
  if (summary === "failing") return "blocked";
  if (summary === "pending") return "pending";
  return "unknown";
}

function reviewGate(
  reviews: ReviewLandingInput["reviews"],
): ReviewGateState {
  if (!reviews) return "unknown";
  if (reviews.changesRequested > 0) return "blocked";
  if (reviews.approved > 0) return "pass";
  return "pending";
}

function conflictsGate(
  mergeable: ReviewLandingInput["mergeable"],
): ReviewGateState {
  if (mergeable === true) return "pass";
  if (mergeable === false) return "blocked";
  return "unknown";
}

function threadsGate(
  unresolvedThreads: ReviewLandingInput["unresolvedThreads"],
): ReviewGateState {
  if (unresolvedThreads == null) return "unknown";
  return unresolvedThreads > 0 ? "blocked" : "pass";
}

/**
 * Canonical landing decision shared by the Review Deck and the full PR reader.
 * Unknown is a real state and never grants merge permission. Review submission
 * preserves the existing GitHub rule: an open, non-draft PR can still receive
 * a verdict while checks or mergeability are being computed.
 */
export function deriveReviewLandingState(
  input: ReviewLandingInput,
): ReviewLandingState {
  const checks = checksGate(input.checks);
  const review = reviewGate(input.reviews);
  const conflicts = conflictsGate(input.mergeable);
  const threads = threadsGate(input.unresolvedThreads);
  const canReview = input.state === "open" && input.draft === false;
  const gates = [checks, review, conflicts, threads];
  return {
    checks,
    review,
    conflicts,
    threads,
    canReview,
    canMerge: canReview && gates.every((gate) => gate === "pass"),
    hasUnknown: gates.some((gate) => gate === "unknown"),
  };
}

export type ReviewWorkItem =
  | {
      kind: "pull-request";
      id: string;
      title: string;
      repo: string;
      number: number;
      baseRef: string;
      headRef: string;
      revision: string;
    }
  | {
      kind: "local";
      id: string;
      title: string;
      sessionId: string;
      branch: string | null;
      revision: string;
    };

export function pullRequestReviewWorkItem(input: {
  title: string;
  repo: string;
  number: number;
  baseRef: string;
  headRef: string;
  headSha: string;
}): ReviewWorkItem {
  return {
    kind: "pull-request",
    id: `pr:${input.repo}#${input.number}`,
    title: input.title,
    repo: input.repo,
    number: input.number,
    baseRef: input.baseRef,
    headRef: input.headRef,
    revision: input.headSha,
  };
}

/**
 * Local changes do not expose a head SHA through `/api/changes`. Their review
 * revision is therefore an explicit file-list fingerprint, never a fabricated
 * commit identity.
 */
export function localReviewWorkItem(input: {
  title: string;
  sessionId: string;
  branch: string | null;
  revision: string;
}): ReviewWorkItem {
  return {
    kind: "local",
    id: `local:${input.sessionId}`,
    title: input.title,
    sessionId: input.sessionId,
    branch: input.branch,
    revision: input.revision,
  };
}

export function localReviewRevision(
  sessionUpdatedAt: string,
  files: readonly {
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }[],
): string {
  let hash = 2166136261;
  const source = `${sessionUpdatedAt}\n${files
    .map(
      (file) =>
        `${file.path}\0${file.status}\0${file.additions}\0${file.deletions}`,
    )
    .join("\n")}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `working-tree-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
