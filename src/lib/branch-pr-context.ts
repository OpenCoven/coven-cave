// Branch → PR context for the sessions list, without ever blocking the poll.
//
// The composer git chip resolves its PR once per (root, branch) client-side
// (`/api/changes?pr=1`). The sessions list needs the same context for every
// visible thread on a 4s poll, so `gh pr view` (network-bound, ~hundreds of
// ms) can never sit on the request path. This module is a stale-while-
// revalidate cache: reads are synchronous from memory; a miss or an expired
// entry schedules one background `gh pr view` per (root, branch) and keeps
// serving the previous value (or nothing) meanwhile. Failures — no PR for the
// branch, gh missing/unauthenticated — negative-cache as null for a full TTL
// so an unauthenticated machine doesn't hammer gh.

import { execFile } from "node:child_process";
import type { SessionPullRequestContext } from "@/lib/types";

const PR_URL_RE = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;

/** stdout of `gh pr view <branch> --json number,url,state,isDraft` in `root`. */
export type BranchPrRunner = (root: string, branch: string) => Promise<string>;

/** Parse gh's JSON into the SessionRow.pullRequest shape (state lowercased). */
export function parseBranchPr(
  stdout: string,
  branch: string,
): SessionPullRequestContext | null {
  let parsed: { number?: unknown; url?: unknown; state?: unknown; isDraft?: unknown };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return null;
  }
  if (typeof parsed.number !== "number" || typeof parsed.url !== "string") return null;
  const match = PR_URL_RE.exec(parsed.url);
  if (!match) return null;
  return {
    repo: match[1]!,
    number: parsed.number,
    url: match[0],
    state: typeof parsed.state === "string" ? parsed.state.toLowerCase() : "open",
    branch,
    draft: parsed.isDraft === true,
  };
}

const defaultRunner: BranchPrRunner = (root, branch) =>
  new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["pr", "view", branch, "--json", "number,url,state,isDraft"],
      { cwd: root, timeout: 10_000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });

type CacheEntry = {
  value: SessionPullRequestContext | null;
  fetchedAt: number;
};

export type BranchPrCache = {
  /** Cached PR for (root, branch) — null = known no-PR, undefined = not yet
   *  resolved. Schedules a background refresh when missing or stale. */
  get(root: string, branch: string): SessionPullRequestContext | null | undefined;
};

export function createBranchPrCache(options?: {
  runner?: BranchPrRunner;
  ttlMs?: number;
  /** Merged/closed PRs are terminal — cache them longer. */
  settledTtlMs?: number;
  maxConcurrent?: number;
  now?: () => number;
}): BranchPrCache {
  const runner = options?.runner ?? defaultRunner;
  const ttlMs = options?.ttlMs ?? 60_000;
  const settledTtlMs = options?.settledTtlMs ?? 15 * 60_000;
  const maxConcurrent = options?.maxConcurrent ?? 3;
  const now = options?.now ?? Date.now;

  const entries = new Map<string, CacheEntry>();
  const inFlight = new Set<string>();

  function ttlFor(entry: CacheEntry): number {
    const state = entry.value?.state;
    return state === "merged" || state === "closed" ? settledTtlMs : ttlMs;
  }

  function refresh(key: string, root: string, branch: string): void {
    if (inFlight.has(key) || inFlight.size >= maxConcurrent) return;
    inFlight.add(key);
    void runner(root, branch)
      .then((stdout) => {
        entries.set(key, { value: parseBranchPr(stdout, branch), fetchedAt: now() });
      })
      .catch(() => {
        // No PR for this branch, or gh missing/unauthenticated — negative-cache.
        entries.set(key, { value: null, fetchedAt: now() });
      })
      .finally(() => {
        inFlight.delete(key);
      });
  }

  return {
    get(root, branch) {
      const key = `${root}\u0000${branch}`;
      const entry = entries.get(key);
      if (!entry || now() - entry.fetchedAt >= ttlFor(entry)) refresh(key, root, branch);
      return entry?.value;
    },
  };
}

/** Process-wide cache instance for API routes (module state survives requests). */
export const branchPrCache: BranchPrCache = createBranchPrCache();
