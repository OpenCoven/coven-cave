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
 * and starts a new request, so the caller never reuses a response, or joins a
 * request, that began before whatever it is reacting to; shared callers that
 * come after it join that new request. A forced caller that names its `cause`
 * (the event it is reacting to) instead shares the request another forced
 * caller started for that same event (#5795): returning to the tab, or one
 * `cave:changes-refresh`, reached both the desk's hook and the changes panel,
 * and each started its own.
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
  /** Whether `origin` is a GitHub remote a pull request can be opened on.
   *  Absent from older servers, which reads as yes. */
  githubOrigin?: boolean;
};

export type ChangesSummaryResult = {
  /** HTTP-level `res.ok` — callers branch on this exactly as they did on the Response. */
  httpOk: boolean;
  status: number;
  json: ChangesSummaryResponse;
};

const TTL_MS = 4000;
/** A status read that never answers would hold every subscriber's one
 *  in-flight slot, freezing the list until a reload (#5756). */
export const CHANGES_SUMMARY_TIMEOUT_MS = 30_000;

// staleServeMs === ttlMs disables the serve-stale window: within the TTL the
// cached response is shared, past it the next caller blocks on a fresh fetch.
const cache = createSwrCache<ChangesSummaryResult>({ ttlMs: TTL_MS, staleServeMs: TTL_MS });

async function requestSummary(projectRoot: string): Promise<ChangesSummaryResult> {
  let res: Response;
  try {
    res = await fetch(
      `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`,
      { cache: "no-store", signal: AbortSignal.timeout(CHANGES_SUMMARY_TIMEOUT_MS) },
    );
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`the change list didn't answer in ${CHANGES_SUMMARY_TIMEOUT_MS / 1000} seconds`);
    }
    // A fetch that never reached the server rejects with "Failed to fetch"
    // (#5756), which said nothing about what to do.
    if (err instanceof TypeError) throw new Error("the server couldn't be reached");
    throw err;
  }
  // An error page (an HTML 500, a proxy's 502) is not a change list: say so
  // rather than surface the JSON parser's "Unexpected token '<'" (#5756).
  const json = (await res.json().catch(() => null)) as ChangesSummaryResponse | null;
  if (!json) throw new Error(`the server answered ${res.status} without a change list`);
  return { httpOk: res.ok, status: res.status, json };
}

/** The forced request each event started, by root (#5795). Held weakly: an
 *  event is let go once its listeners have run. */
const forcedFor = new WeakMap<object, Map<string, Promise<ChangesSummaryResult>>>();

export function fetchChangesSummary(
  projectRoot: string,
  opts?: { force?: boolean; cause?: object | null },
): Promise<ChangesSummaryResult> {
  if (!opts?.force) return cache.get(projectRoot, () => requestSummary(projectRoot));
  const cause = opts.cause ?? null;
  const joined = cause ? forcedFor.get(cause)?.get(projectRoot) : undefined;
  if (joined) return joined;
  cache.invalidate(projectRoot);
  const request = cache.get(projectRoot, () => requestSummary(projectRoot));
  if (cause) {
    let byRoot = forcedFor.get(cause);
    if (!byRoot) forcedFor.set(cause, (byRoot = new Map()));
    byRoot.set(projectRoot, request);
  }
  return request;
}

/** Test-only: drop all cached summaries so cases don't leak into each other. */
export function resetChangesSummaryCacheForTests(): void {
  cache.clear();
}
