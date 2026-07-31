"use client";

/**
 * use-pr-readiness — one hook, one truth about whether a PR is safe to merge.
 *
 * Fans out to `/api/github/item?pull=1`, `/api/github/checks` and
 * `/api/github/comments?isPull=1` for the selected session's pull request, then
 * reduces them to the `PrFacts` the deck renders. The three reads land together
 * or not at all: a partial answer would let the rail claim "ready" off a stale
 * check list, so anything missing keeps the panel in its loading state.
 *
 * Checks and threads are fault-isolated the way the routes are — a failed
 * checks read degrades to "no CI signal", it never turns a working readiness
 * panel into an error. Only the item read failing is a real failure, because
 * without it there is no pull request to describe.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { summarizeChecks } from "@/lib/github-checks";
import { createReviewRequestGate, type ReviewRequest } from "./review-deck";
import type { LatestReview, PrFacts, ReadinessCheckRun, ReadinessThread, ReviewTally } from "./review-readiness";

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

type ItemWire = {
  ok?: boolean;
  state?: string;
  draft?: boolean;
  merged?: boolean;
  isPull?: boolean;
  pull?: {
    headRef?: string;
    baseRef?: string;
    headSha?: string;
    commits?: number;
    additions?: number;
    deletions?: number;
    changedFiles?: number;
    mergeable?: boolean | null;
    mergeableState?: string;
    reviews?: Partial<ReviewTally>;
  } | null;
};

type ChecksWire = {
  ok?: boolean;
  runs?: Array<{ name?: string; status?: string; conclusion?: string | null; detailsUrl?: string | null }>;
  statuses?: Array<{ context?: string; state?: string; targetUrl?: string | null }>;
};

type CommentsWire = {
  ok?: boolean;
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

/** How many unresolved threads the composer quotes verbatim before summarizing. */
const QUOTED_THREADS = 3;
/** Longest thread excerpt kept — a whole review comment would swamp a chip. */
const EXCERPT_CHARS = 160;

const EMPTY_TALLY: ReviewTally = { approved: 0, changesRequested: 0, commented: 0 };

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
    perAuthor.set(author, { state, author, submittedAt: raw?.submittedAt ?? null });
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

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as T | null;
    return json;
  } catch {
    return null;
  }
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

  const repo = pr?.repo ?? null;
  const number = pr?.number ?? null;

  const load = useCallback(
    async (isRefresh: boolean) => {
      const request: ReviewRequest = gate.current.begin(repo && number ? `${repo}#${number}` : "none");
      if (!repo || number == null) {
        setPhase("idle");
        setFacts(null);
        setError(null);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else {
        setPhase("loading");
        setFacts(null);
        setError(null);
      }

      const query = `repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}`;
      const [item, checks, comments] = await Promise.all([
        readJson<ItemWire>(`/api/github/item?${query}&pull=1`),
        readJson<ChecksWire>(`/api/github/checks?${query}`),
        readJson<CommentsWire>(`/api/github/comments?${query}&isPull=1`),
      ]);

      if (!gate.current.isCurrent(request, latestScope.current)) return;

      if (!item?.ok || !item.isPull) {
        setPhase("error");
        setFacts(null);
        setError(`Couldn't read ${repo}#${number} from GitHub.`);
        setRefreshing(false);
        return;
      }

      const pull = item.pull ?? null;
      const runs = checkRunsFrom(checks?.ok ? checks : null);
      const tally: ReviewTally = {
        approved: pull?.reviews?.approved ?? EMPTY_TALLY.approved,
        changesRequested: pull?.reviews?.changesRequested ?? EMPTY_TALLY.changesRequested,
        commented: pull?.reviews?.commented ?? EMPTY_TALLY.commented,
      };

      setFacts({
        repo,
        number,
        state: item.state ?? "open",
        draft: item.draft === true,
        merged: item.merged === true,
        headRef: pull?.headRef ?? "",
        baseRef: pull?.baseRef ?? "",
        headSha: pull?.headSha ?? "",
        commits: pull?.commits ?? 0,
        additions: pull?.additions ?? 0,
        deletions: pull?.deletions ?? 0,
        changedFiles: pull?.changedFiles ?? 0,
        // `mergeable` is absent (not false) when the `pull=1` block degraded —
        // unknown, which the banner reports rather than guessing.
        mergeable: typeof pull?.mergeable === "boolean" ? pull.mergeable : null,
        mergeableState: pull?.mergeableState ?? "unknown",
        reviews: tally,
        latestReview: latestSubmittedReview(comments?.ok ? comments.reviews : []),
        checks: { rollup: summarizeChecks(runs), runs },
        threads: threadsFrom(comments?.ok ? comments : null),
      });
      setPhase("ready");
      setError(null);
      setCheckedAt(Date.now());
      setRefreshing(false);
    },
    [repo, number],
  );

  useEffect(() => {
    void load(false);
    return () => gate.current.invalidate();
  }, [load]);

  const refresh = useCallback(() => {
    if (refreshing) return;
    void load(true);
  }, [load, refreshing]);

  return { phase, facts, error, checkedAt, refreshing, refresh };
}
