// Branch → PR context for the sessions list, without ever blocking the poll.
//
// The composer git chip resolves its PR once per (root, branch) client-side
// (`/api/changes?pr=1`). The sessions list needs the same context for every
// visible thread on a 4s poll, so the PR lookup (network-bound, ~hundreds of
// ms) can never sit on the request path. This module is a stale-while-
// revalidate cache: reads are synchronous from memory; a miss or an expired
// entry schedules one background lookup per (root, branch) and keeps
// serving the previous value (or nothing) meanwhile. Failures — no PR for the
// branch, gh missing/unauthenticated — negative-cache as null for a full TTL
// so an unauthenticated machine doesn't hammer gh.
//
// The lookup uses `gh api` (GitHub REST) rather than `gh pr view` (GraphQL):
// the 4s poll across many project roots trivially drains the 5000/hr GraphQL
// budget, while the REST bucket is a separate, far roomier 5000/hr. REST
// `GET /repos/:owner/:repo/pulls?head=:owner::branch` returns the same PR
// fields, and PR-URL lookups hit `GET /repos/:owner/:repo/pulls/:number`.

import { execFile } from "node:child_process";
import { scrubSidecarInternalEnv } from "./coven-bin.ts";
import type { SessionPullRequestContext } from "@/lib/types";

const PR_URL_RE = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const GH_ENV = () => scrubSidecarInternalEnv({ ...process.env, GH_PROMPT_DISABLED: "1" });

/** stdout of the branch PR lookup (REST list JSON) in `root`. */
export type BranchPrRunner = (root: string, branch: string) => Promise<string>;

/** Normalize a single REST pull object into the SessionRow.pullRequest shape.
 *  REST uses `html_url` and `draft`; GraphQL used `url`/`isDraft`. `parseBranchPr`
 *  accepts either shape so cached callers and tests stay stable. */
function normalizePull(
  pull: { number?: unknown; url?: unknown; html_url?: unknown; state?: unknown; isDraft?: unknown; draft?: unknown },
  branch?: string,
): SessionPullRequestContext | null {
  const url = typeof pull.html_url === "string" ? pull.html_url : typeof pull.url === "string" ? pull.url : undefined;
  if (typeof pull.number !== "number" || !url) return null;
  const match = PR_URL_RE.exec(url);
  if (!match) return null;
  return {
    repo: match[1]!,
    number: pull.number,
    url: match[0],
    state: typeof pull.state === "string" ? pull.state.toLowerCase() : "open",
    ...(branch ? { branch } : {}),
    draft: pull.draft === true || pull.isDraft === true,
  };
}

/** Parse the PR lookup stdout into the SessionRow.pullRequest shape (state
 *  lowercased). Accepts a REST list (`[{...}]`), a single REST/GraphQL object
 *  (`{...}`), or the legacy `gh pr view` object. `branch` is stamped when known
 *  (branch-keyed lookups); URL-keyed lookups omit it. */
export function parseBranchPr(
  stdout: string,
  branch?: string,
): SessionPullRequestContext | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  // REST list endpoint returns an array; the head filter yields 0 or 1 open PR.
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    return first ? normalizePull(first as Parameters<typeof normalizePull>[0], branch) : null;
  }
  if (parsed && typeof parsed === "object") {
    return normalizePull(parsed as Parameters<typeof normalizePull>[0], branch);
  }
  return null;
}

/** Resolve a repo's `owner/name` from its origin remote via `git`, so the REST
 *  list query can be scoped to the right repository. */
function repoSlug(root: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", root, "remote", "get-url", "origin"],
      { timeout: 10_000, env: GH_ENV() },
      (err, stdout) => {
        if (err) return reject(err);
        const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(stdout.trim());
        if (!m) return reject(new Error("origin is not a github remote"));
        resolve(m[1]!);
      },
    );
  });
}

const defaultRunner: BranchPrRunner = async (root, branch) => {
  const slug = await repoSlug(root);
  const owner = slug.split("/")[0]!;
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      [
        "api",
        "-X",
        "GET",
        `repos/${slug}/pulls`,
        "-f",
        `head=${owner}:${branch}`,
        "-f",
        "state=all",
        "-f",
        "per_page=1",
      ],
      { cwd: root, timeout: 10_000, env: GH_ENV() },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
};

/** stdout of the PR-URL lookup (REST single-PR JSON; repo + number inferred
 *  from the URL, so no project cwd is needed). */
export type UrlPrRunner = (url: string) => Promise<string>;

const defaultUrlRunner: UrlPrRunner = (url) => {
  const match = PR_URL_RE.exec(url);
  if (!match) return Promise.reject(new Error("not a github PR url"));
  const slug = match[1]!;
  const number = match[2]!;
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["api", "-X", "GET", `repos/${slug}/pulls/${number}`],
      { timeout: 10_000, env: GH_ENV() },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
};

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

export type PrUrlCache = {
  /** Cached PR for a canonical PR URL — null = known unresolvable, undefined =
   *  not yet resolved. Schedules a background refresh when missing or stale. */
  get(url: string): SessionPullRequestContext | null | undefined;
};

/**
 * URL-keyed sibling of the branch cache, for transcript-derived attribution
 * (cave-u9wl): familiar chats report the PR they landed in a reply, and the
 * chat's own cwd never sits on that branch — so the lookup keys on the PR URL
 * itself. Same stale-while-revalidate posture: synchronous reads, one
 * background `gh pr view <url>` per URL, negative-cache on failure.
 */
export function createPrUrlCache(options?: {
  runner?: UrlPrRunner;
  ttlMs?: number;
  /** Merged/closed PRs are terminal — cache them longer. */
  settledTtlMs?: number;
  maxConcurrent?: number;
  now?: () => number;
}): PrUrlCache {
  const runner = options?.runner ?? defaultUrlRunner;
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

  function refresh(url: string): void {
    if (inFlight.has(url) || inFlight.size >= maxConcurrent) return;
    inFlight.add(url);
    void runner(url)
      .then((stdout) => {
        entries.set(url, { value: parseBranchPr(stdout), fetchedAt: now() });
      })
      .catch(() => {
        // PR gone, or gh missing/unauthenticated — negative-cache.
        entries.set(url, { value: null, fetchedAt: now() });
      })
      .finally(() => {
        inFlight.delete(url);
      });
  }

  return {
    get(url) {
      const entry = entries.get(url);
      if (!entry || now() - entry.fetchedAt >= ttlFor(entry)) refresh(url);
      return entry?.value;
    },
  };
}

/** Process-wide URL-keyed cache instance for API routes. */
export const prUrlCache: PrUrlCache = createPrUrlCache();
