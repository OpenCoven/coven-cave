"use client";

/**
 * Shared, deduped fetch for the bare `/api/changes?projectRoot=` summary
 * (cave-v8hh).
 *
 * On the chat surface three subscribers poll the SAME root's summary every 5s
 * — the composer git chip and the stage header (both via useChangesSummary)
 * plus the code-rail badge in chat-surface — and the Changes panel adds a
 * fourth while a session runs. Each hand-rolled its own fetch, so one 5s tick
 * cost 2-4 identical requests (each a `git status` on the server). This module
 * gives them one gate: concurrent callers share a single in-flight request,
 * and callers within the microcache window reuse the last response.
 *
 * TTL: 4s — just under the 5s poll cadence, so each poll window still performs
 * exactly one real fetch, staggered subscribers coalesce onto it, and no
 * subscriber ever sees data older than one poll interval. A resolved error
 * payload can be served for at most one TTL; the next tick recomputes it.
 *
 * `force: true` (post-mutation refreshes: revert, commit, checkpoint restore,
 * branch switch, the `cave:changes-refresh` signal) drops the cached entry
 * first so the caller never reuses a pre-mutation response. If another
 * subscriber's request is mid-flight it is shared instead — it started after
 * the previous cached response, so it is as fresh as a new request would be.
 *
 * Network failures reject through to every awaiting caller and are never
 * cached (swr-cache only stores resolutions), so each caller's own catch
 * semantics ("keep last known summary") are unchanged.
 */

import { createSwrCache } from "./swr-cache.ts";

export type ChangesSummaryResponse = {
  ok?: boolean;
  error?: string;
  repo?: boolean;
  repoRoot?: string | null;
  files?: unknown[];
  branch?: string | null;
  worktree?: string | null;
};

export type ChangesSummaryResult = {
  /** HTTP-level `res.ok` — callers branch on this exactly as they did on the Response. */
  httpOk: boolean;
  status: number;
  json: ChangesSummaryResponse;
};

const TTL_MS = 4000;

// staleServeMs === ttlMs disables the serve-stale window: within the TTL the
// cached response is shared, past it the next caller blocks on a fresh fetch.
const cache = createSwrCache<ChangesSummaryResult>({ ttlMs: TTL_MS, staleServeMs: TTL_MS });

async function requestSummary(projectRoot: string): Promise<ChangesSummaryResult> {
  const res = await fetch(
    `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`,
    { cache: "no-store" },
  );
  const json = (await res.json()) as ChangesSummaryResponse;
  return { httpOk: res.ok, status: res.status, json };
}

export function fetchChangesSummary(
  projectRoot: string,
  opts?: { force?: boolean },
): Promise<ChangesSummaryResult> {
  if (opts?.force) cache.invalidate(projectRoot);
  return cache.get(projectRoot, () => requestSummary(projectRoot));
}

/** Test-only: drop all cached summaries so cases don't leak into each other. */
export function resetChangesSummaryCacheForTests(): void {
  cache.clear();
}
