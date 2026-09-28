/**
 * One fetch of `/api/github/item?pull=1` shared by every card that shows the
 * same issue or PR (#5615). A transcript mentioning PR #30 three times used to
 * make three requests on every open, each three live GitHub calls, and they
 * queued the transcript itself behind them in the browser's per-host
 * connection pool. Identical requests in flight are joined, and a successful
 * answer is reused for FRESH_MS. `fresh` is a card refreshing after an action:
 * it skips the reuse here and asks the server to skip its own.
 */

import { createSharedRequests } from "./shared-requests.ts";

export type GitHubItemResponse = { status: number; data: unknown };

const FRESH_MS = 30_000;

// Generation-aware (#5671): a card's refresh after an action is never
// overwritten by an older request for the same item.
const items = createSharedRequests<GitHubItemResponse>({
  keep: (value) => value.status >= 200 && value.status < 300,
  maxEntries: 128,
});
const lookups = createSharedRequests<GitHubItemResponse>({
  keep: (value) => value.status >= 200 && value.status < 300,
  maxEntries: 128,
});

async function getJson(url: string): Promise<GitHubItemResponse> {
  const res = await fetch(url, { cache: "no-store" });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function itemUrl(repo: string, number: number, fresh: boolean): string {
  return `/api/github/item?repo=${encodeURIComponent(repo)}&number=${number}&pull=1${fresh ? "&fresh=1" : ""}`;
}

export function fetchGitHubItem(
  repo: string,
  number: number,
  options: { fresh?: boolean; now?: () => number } = {},
): Promise<GitHubItemResponse> {
  const fresh = Boolean(options.fresh);
  return items.run(`${repo.toLowerCase()}#${number}`, () => getJson(itemUrl(repo, number, fresh)), {
    force: fresh,
    freshMs: FRESH_MS,
    now: options.now,
  });
}

/**
 * The same sharing for the other card lookups (#5627): checks and review
 * threads. Identical requests in flight are joined and a successful answer is
 * reused for `freshMs`; `fresh` (a card refreshing after an action) skips the
 * reuse. The routes behind these keep no answers of their own.
 */
export function fetchSharedGitHubJson(
  url: string,
  options: { freshMs: number; fresh?: boolean; now?: () => number },
): Promise<GitHubItemResponse> {
  return lookups.run(url, () => getJson(url), {
    force: options.fresh,
    freshMs: options.freshMs,
    now: options.now,
  });
}

/** Test seam. */
export function clearGitHubItemFetchCache(): void {
  items.clear();
  lookups.clear();
}
