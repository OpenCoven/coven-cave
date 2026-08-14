"use client";

/**
 * Shared PR data hooks (cave-l82dm).
 *
 * Extracted from `code-session-pr-panel.tsx` so the rail's compact panel and
 * the full reader read the SAME endpoints with the same polling and the same
 * degradation rules. Two surfaces that disagree about whether a check failed
 * are worse than one surface, and that is what duplicating these would produce.
 *
 * Degradation posture, uniform across all four: a failed refresh keeps the last
 * good payload rather than blanking the pane. A PR reader that flashed empty on
 * a rate-limited poll would read as "nothing here", which is a different claim
 * from "we could not reach GitHub just now".
 */

import { useCallback, useEffect, useState } from "react";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { CheckSummary } from "@/lib/github-checks";
import type { PrCheckRun } from "@/lib/github-pr-reader";

const CHECKS_POLL_MS = 30_000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | null;
    if (!res.ok || !data || data.ok !== true) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Checks ───────────────────────────────────────────────────────────────────

export type PrChecksState =
  | { phase: "loading" }
  | { phase: "ready"; rollup: CheckSummary; runs: PrCheckRun[] }
  | { phase: "error" };

export function useGitHubPrChecks(repo: string, number: number): PrChecksState {
  const [state, setState] = useState<PrChecksState>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    void getJson<{ rollup: CheckSummary; runs: PrCheckRun[] }>(
      `/api/github/checks?repo=${encodeURIComponent(repo)}&number=${number}`,
    ).then((data) => {
      if (cancelled) return;
      if (!data) {
        setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
        return;
      }
      setState({ phase: "ready", rollup: data.rollup, runs: data.runs ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, [repo, number, tick]);
  // Only poll while something is actually in flight — a settled suite does not
  // change on its own, and polling it is a rate-limit cost with no reader.
  const pending = state.phase === "ready" && state.rollup === "pending";
  usePausablePoll(() => setTick((t) => t + 1), CHECKS_POLL_MS, { enabled: pending });
  return state;
}

// ── Review threads ───────────────────────────────────────────────────────────

export type PrReviewThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  comments: { id: string; author: { login: string } | null; body: string; createdAt: string | null }[];
};

export type PrThreadsState =
  | { phase: "loading" }
  | { phase: "ready"; threads: PrReviewThread[]; authed: boolean }
  | { phase: "error" };

export function useGitHubPrThreads(
  repo: string,
  number: number,
): PrThreadsState & { refresh: () => void } {
  const [state, setState] = useState<PrThreadsState>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // A manual refresh keeps the current list on screen; only the first load
    // shows the skeleton.
    setState((prev) => (tick > 0 && prev.phase === "ready" ? prev : { phase: "loading" }));
    void getJson<{ authed: boolean; reviewThreads: PrReviewThread[] }>(
      `/api/github/comments?repo=${encodeURIComponent(repo)}&number=${number}&isPull=1`,
    ).then((data) => {
      if (cancelled) return;
      if (!data) {
        setState({ phase: "error" });
        return;
      }
      setState({ phase: "ready", threads: data.reviewThreads ?? [], authed: Boolean(data.authed) });
    });
    return () => {
      cancelled = true;
    };
  }, [repo, number, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}

// ── Detail (`?pull=1`) ───────────────────────────────────────────────────────

export type PrDetail = {
  title: string;
  number: number;
  state: string;
  merged: boolean;
  draft: boolean;
  body: string;
  author: { login: string; avatarUrl: string | null } | null;
  createdAt: string | null;
  htmlUrl: string | null;
  pull: {
    headRef: string;
    baseRef: string;
    commits: number;
    additions: number;
    deletions: number;
    changedFiles: number;
    mergeable: boolean | null;
    mergeableState: string;
    reviews: { approved: number; changesRequested: number; commented: number };
  } | null;
};

export type PrDetailState =
  | { phase: "loading" }
  | { phase: "ready"; detail: PrDetail }
  | { phase: "error" };

export function useGitHubPrDetail(repo: string, number: number): PrDetailState {
  const [state, setState] = useState<PrDetailState>({ phase: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    void getJson<PrDetail>(
      `/api/github/item?repo=${encodeURIComponent(repo)}&number=${number}&pull=1`,
    ).then((data) => {
      if (cancelled) return;
      setState(data ? { phase: "ready", detail: data } : { phase: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [repo, number]);
  return state;
}

// ── Commits ──────────────────────────────────────────────────────────────────

export type PrCommit = {
  sha: string;
  subject: string;
  body: string;
  authorLogin: string | null;
  authorName: string | null;
  date: string | null;
  htmlUrl: string | null;
  verified: boolean;
  verifiedReason: string | null;
};

export type PrCommitsState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; commits: PrCommit[]; truncated: boolean }
  | { phase: "error" };

/** Lazy: only fetches once `enabled` (i.e. the Commits tab is actually open). */
export function useGitHubPrCommits(repo: string, number: number, enabled: boolean): PrCommitsState {
  const [state, setState] = useState<PrCommitsState>({ phase: "idle" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    void getJson<{ commits: PrCommit[]; truncated: boolean }>(
      `/api/github/commit?repo=${encodeURIComponent(repo)}&number=${number}`,
    ).then((data) => {
      if (cancelled) return;
      if (!data) {
        setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
        return;
      }
      setState({ phase: "ready", commits: data.commits ?? [], truncated: Boolean(data.truncated) });
    });
    return () => {
      cancelled = true;
    };
  }, [repo, number, enabled]);
  return state;
}

// ── Files ────────────────────────────────────────────────────────────────────

export type PrDiffFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  noPatchReason: string | null;
};

export type PrFilesState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; files: PrDiffFile[]; truncated: boolean; total: number }
  | { phase: "error" };

/** Lazy for the same reason as commits — a capped diff is still the heaviest
 *  payload on this surface, and most readings never open the Files tab. */
export function useGitHubPrFiles(repo: string, number: number, enabled: boolean): PrFilesState {
  const [state, setState] = useState<PrFilesState>({ phase: "idle" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    void getJson<{ files: PrDiffFile[]; truncated: boolean; total: number }>(
      `/api/github/diff?repo=${encodeURIComponent(repo)}&number=${number}`,
    ).then((data) => {
      if (cancelled) return;
      if (!data) {
        setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
        return;
      }
      setState({
        phase: "ready",
        files: data.files ?? [],
        truncated: Boolean(data.truncated),
        total: Number(data.total ?? 0),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [repo, number, enabled]);
  return state;
}
