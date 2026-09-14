"use client";

/**
 * use-pr-readiness — one hook, one truth about whether a PR is safe to merge.
 *
 * Fans out to `/api/github/item?pull=1`, `/api/github/checks` and
 * `/api/github/comments?isPull=1` for the selected session's pull request, then
 * reduces them to the `PrFacts` the deck renders. Missing evidence is an
 * explicit error, not an empty success. Item facts remain available for queue
 * reconciliation even when checks or comments fail.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { summarizeChecks } from "@/lib/github-checks";
import { createReviewRequestGate, type ReviewRequest } from "./review-deck";
import { parseReviewItem, readReviewJson, type ReviewItemFacts } from "./review-github-read";
import { isTerminalPr } from "./review-readiness";
import type { LatestReview, PrFacts, ReadinessCheckRun, ReadinessThread } from "./review-readiness";

export type ReadinessPhase = "idle" | "loading" | "ready" | "error";

export type PrReadiness = {
  phase: ReadinessPhase;
  facts: PrFacts | null;
  error: string | null;
  /** Epoch ms of the last successful read, for the rail's "checked N ago". */
  checkedAt: number | null;
  refreshing: boolean;
  refresh: () => void;
};

type ChecksWire = {
  ok?: boolean;
  sha?: string;
  runs?: Array<{ name?: string; status?: string; conclusion?: string | null; detailsUrl?: string | null }>;
  statuses?: Array<{ context?: string; state?: string; targetUrl?: string | null }>;
};

type CommentsWire = {
  ok?: boolean;
  reviewEvidenceComplete?: boolean;
  canResolve?: boolean;
  reviews?: Array<{ author?: { login?: string } | null; state?: string; submittedAt?: string | null }>;
  reviewThreads?: Array<{
    id?: string;
    isResolved?: boolean;
    isOutdated?: boolean;
    path?: string | null;
    line?: number | null;
    comments?: Array<{ author?: { login?: string } | null; body?: string }>;
  }>;
};

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function parseReadinessChecks(value: unknown): ChecksWire {
  const wire = object(value);
  if (wire?.ok !== true || typeof wire.sha !== "string" || !wire.sha ||
      !Array.isArray(wire.runs) || !Array.isArray(wire.statuses) ||
      !wire.runs.every((value) => {
        const run = object(value);
        return run && typeof run.name === "string" && typeof run.status === "string" &&
          (run.conclusion === null || typeof run.conclusion === "string");
      }) ||
      !wire.statuses.every((value) => {
        const status = object(value);
        return status && typeof status.context === "string" && typeof status.state === "string";
      })) throw new Error("Checks response is incomplete.");
  return wire as ChecksWire;
}

export function parseReadinessComments(value: unknown): CommentsWire {
  const wire = object(value);
  if (wire?.reviewEvidenceComplete !== true) {
    throw new Error(typeof wire?.reviewEvidenceError === "string" && wire.reviewEvidenceError
      ? wire.reviewEvidenceError : "Review thread evidence is incomplete.");
  }
  const person = (value: unknown) => value == null || typeof object(value)?.login === "string";
  if (wire?.ok !== true || !Array.isArray(wire.reviewThreads) || !Array.isArray(wire.reviews) ||
      !wire.reviews.every((value) => {
        const review = object(value);
        return review && typeof review.state === "string" && person(review.author) &&
          (review.submittedAt == null || typeof review.submittedAt === "string");
      }) ||
      !wire.reviewThreads.every((value) => {
        const thread = object(value);
        return thread && typeof thread.id === "string" && typeof thread.isResolved === "boolean" &&
          typeof thread.isOutdated === "boolean" && (thread.path == null || typeof thread.path === "string") &&
          (thread.line == null || typeof thread.line === "number") && Array.isArray(thread.comments) &&
          thread.comments.every((value) => {
            const comment = object(value);
            return comment && typeof comment.body === "string" && person(comment.author);
          });
      })) throw new Error("Review threads response is incomplete.");
  return wire as CommentsWire;
}

/** How many unresolved threads the composer quotes verbatim before summarizing. */
const QUOTED_THREADS = 3;
/** Longest thread excerpt kept — a whole review comment would swamp a chip. */
const EXCERPT_CHARS = 160;

/**
 * Only an author's LATEST submitted review counts on GitHub. PENDING (never
 * submitted) and DISMISSED (standing revoked) confer nothing, so neither can
 * become the verdict the deck reports.
 */
function latestSubmittedReview(reviews: CommentsWire["reviews"]): LatestReview | null {
  if (!Array.isArray(reviews)) return null;
  const perAuthor = new Map<string, LatestReview>();
  for (const raw of reviews) {
    const author = raw?.author?.login;
    const state = typeof raw?.state === "string" ? raw.state.toUpperCase() : "";
    if (!author) continue;
    if (state !== "APPROVED" && state !== "CHANGES_REQUESTED" && state !== "COMMENTED") continue;
    const candidate: LatestReview = { state, author, submittedAt: raw?.submittedAt ?? null };
    // "The author's own latest state wins" has to mean latest by timestamp, not
    // last in the array: GitHub's ordering is not a guarantee we should hang a
    // standing review state on, and a stale APPROVED outranking a later
    // CHANGES_REQUESTED is exactly the mistake that matters here.
    const held = perAuthor.get(author);
    if (held && (held.submittedAt ?? "") > (candidate.submittedAt ?? "")) continue;
    perAuthor.set(author, candidate);
  }
  let latest: LatestReview | null = null;
  for (const review of perAuthor.values()) {
    if (review.state === "COMMENTED") continue;
    if (!latest) {
      latest = review;
      continue;
    }
    const a = review.submittedAt ?? "";
    const b = latest.submittedAt ?? "";
    if (a > b) latest = review;
  }
  return latest;
}

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS - 1)}…` : flat;
}

function threadsFrom(wire: CommentsWire | null): PrFacts["threads"] {
  const raw = Array.isArray(wire?.reviewThreads) ? wire.reviewThreads : [];
  // Outdated threads hang off a diff the head has moved past — GitHub stops
  // counting them against a merge, and so does the deck.
  const open = raw.filter((thread) => thread?.isResolved !== true && thread?.isOutdated !== true);
  const items: ReadinessThread[] = open.slice(0, QUOTED_THREADS).map((thread, i) => {
    const first = thread?.comments?.[0];
    return {
      id: typeof thread?.id === "string" && thread.id ? thread.id : `thread-${i}`,
      where: thread?.path ? `${thread.path}${thread.line != null ? `:${thread.line}` : ""}` : "this pull request",
      author: first?.author?.login ?? "author",
      excerpt: excerpt(first?.body ?? ""),
    };
  });
  return {
    unresolved: open.length,
    total: raw.length,
    canResolve: wire?.canResolve === true,
    items,
  };
}

function checkRunsFrom(wire: ChecksWire | null): ReadinessCheckRun[] {
  const runs: ReadinessCheckRun[] = (Array.isArray(wire?.runs) ? wire.runs : []).map((run) => ({
    name: typeof run?.name === "string" && run.name ? run.name : "check",
    status: typeof run?.status === "string" ? run.status : "queued",
    conclusion: typeof run?.conclusion === "string" ? run.conclusion : null,
    detailsUrl: typeof run?.detailsUrl === "string" ? run.detailsUrl : null,
  }));
  // Legacy combined statuses are CI too — a repo whose required contexts are
  // all statuses would otherwise read as "no checks" and merge would unblock.
  for (const status of Array.isArray(wire?.statuses) ? wire.statuses : []) {
    const state = typeof status?.state === "string" ? status.state : "pending";
    runs.push({
      name: typeof status?.context === "string" && status.context ? status.context : "status",
      status: state === "pending" ? "in_progress" : "completed",
      conclusion: state === "pending" ? null : state === "success" ? "success" : "failure",
      detailsUrl: typeof status?.targetUrl === "string" ? status.targetUrl : null,
    });
  }
  return runs;
}

function itemFacts(item: ReviewItemFacts, repo: string, number: number): PrFacts {
  return {
    ...item, repo, number,
    additions: item.additions ?? 0,
    deletions: item.deletions ?? 0,
    changedFiles: item.changedFiles ?? 0,
    latestReview: null,
    checks: { rollup: null, runs: [] },
    threads: { unresolved: 0, total: 0, canResolve: false, items: [] },
  };
}

/**
 * Read GitHub's state for one pull request. `pr` null (no linked PR) parks the
 * hook in `idle` — the rail then says readiness needs a pull request rather
 * than showing an error for a session that never had one.
 */
export function usePrReadiness(pr: { repo: string; number: number } | null): PrReadiness {
  const [phase, setPhase] = useState<ReadinessPhase>("idle");
  const [facts, setFacts] = useState<PrFacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const scope = pr ? `${pr.repo}#${pr.number}` : "none";
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const gate = useRef(createReviewRequestGate());
  const controller = useRef<AbortController | null>(null);

  const repo = pr?.repo ?? null;
  const number = pr?.number ?? null;

  const load = useCallback(
    async (isRefresh: boolean) => {
      controller.current?.abort();
      const active = new AbortController();
      controller.current = active;
      const request: ReviewRequest = gate.current.begin(repo && number ? `${repo}#${number}` : "none");
      if (!repo || number == null) {
        setPhase("idle");
        setFacts(null);
        setError(null);
        setRefreshing(false);
        setCheckedAt(null);
        return;
      }
      setRefreshing(isRefresh);
      setPhase("loading");
      setFacts(null);
      setError(null);
      setCheckedAt(null);

      const query = `repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}`;
      const [itemResult, checksResult, commentsResult] = await Promise.allSettled([
        readReviewJson(`/api/github/item?${query}&pull=1`, active.signal).then(parseReviewItem).then((item) => {
          // Terminal state alone is enough to retire a stale queue row; a slow
          // checks/comments read must not keep a merged PR on the review desk.
          if (isTerminalPr(item) && !active.signal.aborted && gate.current.isCurrent(request, latestScope.current)) {
            setFacts(itemFacts(item, repo, number));
          }
          return item;
        }),
        readReviewJson(`/api/github/checks?${query}`, active.signal).then(parseReadinessChecks),
        readReviewJson(`/api/github/comments?${query}&isPull=1`, active.signal).then(parseReadinessComments),
      ]);

      if (active.signal.aborted || !gate.current.isCurrent(request, latestScope.current)) return;

      if (itemResult.status === "rejected") {
        setPhase("error");
        setFacts(null);
        setError(`Couldn't read ${repo}#${number}: ${itemResult.reason instanceof Error ? itemResult.reason.message : "GitHub read failed."}`);
        setRefreshing(false);
        return;
      }

      const item = itemResult.value;
      const checks = checksResult.status === "fulfilled" ? checksResult.value : null;
      const comments = commentsResult.status === "fulfilled" ? commentsResult.value : null;
      const failures: string[] = [];
      if (!item.headSha) failures.push("Pull request head is unavailable.");
      if (!checks || !Array.isArray(checks.runs) || !Array.isArray(checks.statuses)) {
        failures.push(checksResult.status === "rejected" && checksResult.reason instanceof Error
          ? `Checks: ${checksResult.reason.message}` : "Checks response is incomplete.");
      } else if (checks.sha !== item.headSha) {
        failures.push("Checks refer to a different or unknown pull request head; refresh to reconcile.");
      }
      if (!comments || !Array.isArray(comments.reviewThreads) || !Array.isArray(comments.reviews)) {
        failures.push(commentsResult.status === "rejected" && commentsResult.reason instanceof Error
          ? `Review threads: ${commentsResult.reason.message}` : "Review threads response is incomplete.");
      }
      const runs = checks?.sha === item.headSha ? checkRunsFrom(checks) : [];

      setFacts({
        ...itemFacts(item, repo, number),
        latestReview: latestSubmittedReview(comments?.ok ? comments.reviews : []),
        checks: { rollup: failures.length ? null : summarizeChecks(runs), runs },
        threads: threadsFrom(comments?.ok ? comments : null),
      });
      setPhase(failures.length ? "error" : "ready");
      setError(failures.length ? failures.join(" ") : null);
      setCheckedAt(failures.length ? null : Date.now());
      setRefreshing(false);
    },
    [repo, number],
  );

  useEffect(() => {
    void load(false);
    return () => {
      controller.current?.abort();
      gate.current.invalidate();
    };
  }, [load]);

  const latestLoad = useRef(load);
  latestLoad.current = load;
  const refresh = useCallback(() => {
    void latestLoad.current(true);
  }, []);

  const currentFacts = facts?.repo === repo && facts?.number === number ? facts : null;
  return {
    phase: pr && facts && !currentFacts ? "loading" : phase,
    facts: currentFacts, error, checkedAt, refreshing, refresh,
  };
}
