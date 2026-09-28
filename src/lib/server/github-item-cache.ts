import { createHash } from "node:crypto";

/**
 * Short-lived cache for `/api/github/item` responses (#5615).
 *
 * Every PR card in a transcript asked the route for its item, and every
 * request made three live GitHub REST calls (issue, pull, reviews) — 0.5-0.9 s
 * each, repeated for the same PR on the same chat open, and spending the
 * token's hourly rate limit. A card's state (open, merged, review tally) may
 * lag by up to FRESH_MS; a card the user just acted on asks with `fresh=1`,
 * which bypasses and refreshes the entry.
 *
 * Keyed by the token's identity as well as the item: two tokens can see
 * different things, so one never serves the other's answer.
 */

export const GITHUB_ITEM_FRESH_MS = 30_000;
const MAX_ENTRIES = 256;

export type CachedGitHubItem = { status: number; body: string };

type Entry = { at: number; value: CachedGitHubItem };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<CachedGitHubItem>>();

/** A token's identity for cache keys: a digest prefix, never the token. */
export function githubTokenIdentity(token: string | null): string {
  return token ? createHash("sha256").update(token).digest("base64url").slice(0, 16) : "anon";
}

export function githubItemCacheKey(token: string | null, repo: string, number: number, pull: boolean): string {
  return `${githubTokenIdentity(token)}:${repo.toLowerCase()}#${number}:${pull ? "pull" : "item"}`;
}

/** Only answers that describe the item itself are worth keeping. */
function cacheable(value: CachedGitHubItem): boolean {
  return value.status === 200 || value.status === 404;
}

export async function readGitHubItemThroughCache(
  key: string,
  load: () => Promise<CachedGitHubItem>,
  options: { fresh?: boolean; now?: () => number } = {},
): Promise<CachedGitHubItem> {
  const now = options.now ?? Date.now;
  if (!options.fresh) {
    const hit = entries.get(key);
    if (hit && now() - hit.at < GITHUB_ITEM_FRESH_MS) return hit.value;
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const request = (async () => {
    const value = await load();
    if (cacheable(value)) {
      entries.delete(key);
      entries.set(key, { at: now(), value });
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    } else {
      entries.delete(key);
    }
    return value;
  })();
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    if (inflight.get(key) === request) inflight.delete(key);
  }
}

/** Test seam. */
export function clearGitHubItemCache(): void {
  entries.clear();
  inflight.clear();
}
