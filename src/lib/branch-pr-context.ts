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
import fs from "node:fs";
import path from "node:path";
import { githubCliSpawnEnvAsync, scrubSidecarInternalEnv } from "./coven-bin.ts";
import { prLookupArgs, resolvePrTarget } from "./github-pr-target.ts";
import type { SessionPullRequestContext } from "@/lib/types";

const PR_URL_RE = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;

/** stdout of the branch PR lookup (REST list JSON) in `root`. */
export type BranchPrRunner = (root: string, branch: string) => Promise<string>;

/** Normalize a single REST pull object into the SessionRow.pullRequest shape.
 *  REST uses `html_url` and `draft`; GraphQL used `url`/`isDraft`. `parseBranchPr`
 *  accepts either shape so cached callers and tests stay stable.
 *
 *  ⚠️ REST reports a merged PR as `state: "closed"` — merged-ness lives in
 *  `merged_at` (list + single) and `merged` (single only). Without this
 *  derivation every merged PR badges as red "closed" and the merged-chat
 *  auto-archive sweep (which matches `state === "merged"`) never fires. */
function normalizePull(
  pull: {
    number?: unknown;
    url?: unknown;
    html_url?: unknown;
    state?: unknown;
    isDraft?: unknown;
    draft?: unknown;
    merged?: unknown;
    merged_at?: unknown;
    mergedAt?: unknown;
  },
  branch?: string,
): SessionPullRequestContext | null {
  const url = typeof pull.html_url === "string" ? pull.html_url : typeof pull.url === "string" ? pull.url : undefined;
  if (typeof pull.number !== "number" || !url) return null;
  const match = PR_URL_RE.exec(url);
  if (!match) return null;
  const merged =
    pull.merged === true ||
    (typeof pull.merged_at === "string" && pull.merged_at.length > 0) ||
    (typeof pull.mergedAt === "string" && pull.mergedAt.length > 0);
  return {
    repo: match[1]!,
    number: pull.number,
    url: match[0],
    state: merged ? "merged" : typeof pull.state === "string" ? pull.state.toLowerCase() : "open",
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
  // REST list endpoint returns an array; with `state=all` + `per_page=1` this yields at most one PR of any state.
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    return first ? normalizePull(first as Parameters<typeof normalizePull>[0], branch) : null;
  }
  if (parsed && typeof parsed === "object") {
    return normalizePull(parsed as Parameters<typeof normalizePull>[0], branch);
  }
  return null;
}

/** The branch's PR, looked up where it was opened (#5795): origin's parent
 *  when origin is a fork, by `<origin owner>:<branch>`. Origin alone missed
 *  every PR a fork opened. */
const defaultRunner: BranchPrRunner = async (root, branch) => {
  const target = await resolvePrTarget(root);
  if (!target) throw new Error("origin is not a github remote");
  // `gh` as the user's shell finds it (#5795): on the desktop sidecar's own
  // PATH a Homebrew `gh` was missing, and every lookup cached "no PR".
  const env = await githubCliSpawnEnvAsync();
  return new Promise((resolve, reject) => {
    execFile("gh", prLookupArgs(target, branch), { windowsHide: true, cwd: root, timeout: 10_000, env }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
};

/** The newest commit on a local branch: its id and commit time (ms). */
export type BranchTipReader = (root: string, branch: string) => Promise<{ oid: string; committedAt: number } | null>;

const defaultBranchTip: BranchTipReader = (root, branch) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["log", "-1", "--format=%H %ct", `refs/heads/${branch}`, "--"],
      { windowsHide: true, cwd: root, timeout: 10_000, env: scrubSidecarInternalEnv({ ...process.env }) },
      (err, stdout) => {
        const [oid, seconds] = String(stdout ?? "").trim().split(" ");
        resolve(err || !oid || !seconds ? null : { oid, committedAt: Number(seconds) * 1000 });
      },
    );
  });

/** The commit a settled (merged or closed) PR ended at, and when it settled,
 *  from the lookup's REST (or GraphQL) answer. */
function settledPullOf(stdout: string): { headSha: string | null; settledAt: number | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { headSha: null, settledAt: null };
  }
  const pull = (Array.isArray(parsed) ? parsed[0] : parsed) as {
    head?: { sha?: unknown } | null;
    headRefOid?: unknown;
    merged_at?: unknown;
    mergedAt?: unknown;
    closed_at?: unknown;
    closedAt?: unknown;
  } | undefined;
  const headSha = typeof pull?.head?.sha === "string" ? pull.head.sha : typeof pull?.headRefOid === "string" ? pull.headRefOid : null;
  const at = [pull?.merged_at, pull?.mergedAt, pull?.closed_at, pull?.closedAt].find((value) => typeof value === "string" && value);
  const settledAt = typeof at === "string" ? Date.parse(at) : NaN;
  return { headSha, settledAt: Number.isFinite(settledAt) ? settledAt : null };
}

/** stdout of the PR-URL lookup (REST single-PR JSON; repo + number inferred
 *  from the URL, so no project cwd is needed). */
export type UrlPrRunner = (url: string) => Promise<string>;

const defaultUrlRunner: UrlPrRunner = (url) => {
  const match = PR_URL_RE.exec(url);
  if (!match) return Promise.reject(new Error("not a github PR url"));
  const slug = match[1]!;
  const number = match[2]!;
  return githubCliSpawnEnvAsync().then((env) => new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["api", "-X", "GET", `repos/${slug}/pulls/${number}`],
      { windowsHide: true, timeout: 10_000, env },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  }));
};

type CacheEntry = {
  value: SessionPullRequestContext | null;
  fetchedAt: number;
  /** A merged or closed PR whose branch has commits newer than its end
   *  (#5795): checked again at the open-PR pace, not left for 15 minutes. */
  unsettled?: boolean;
};

export type BranchPrCache = {
  /** Cached PR for (root, branch) — null = known no-PR, undefined = not yet
   *  resolved. Schedules a background refresh when missing or stale. */
  get(root: string, branch: string): SessionPullRequestContext | null | undefined;
  /**
   * The same answer for a caller that must have one (#5619): a cached value
   * at once — refreshing a stale one in the background — or, on a miss, the
   * result of the one shared lookup for this (root, branch).
   */
  resolve(root: string, branch: string): Promise<SessionPullRequestContext | null>;
  /**
   * Forget (root, branch), and any lookup for it in flight, so the next read
   * asks GitHub (#5795). Create PR calls it: the lookup kept answering "no
   * PR" for a minute after the desk opened one. Entries keyed by a folder
   * inside `root` go too, since the sessions list keys by the chat's folder.
   */
  invalidate(root: string, branch: string): void;
  /** Forget every entry that answered with this pull request (#5795). The
   *  merge route knows the PR, not the checkout: a merge kept reading as
   *  open, with Squash merge on offer again. */
  invalidatePullRequest(repo: string, number: number): void;
};

function realOrResolved(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/** Whether `candidate` is `root`, or a folder inside it. */
function inCheckout(candidate: string, root: string): boolean {
  const real = realOrResolved(candidate);
  const top = realOrResolved(root);
  return real === top || real.startsWith(top + path.sep);
}

export function createBranchPrCache(options?: {
  runner?: BranchPrRunner;
  /** Reads a local branch's newest commit, to tell a reused branch (#5795). */
  branchTip?: BranchTipReader;
  ttlMs?: number;
  /** Merged/closed PRs are terminal — cache them longer. */
  settledTtlMs?: number;
  maxConcurrent?: number;
  now?: () => number;
}): BranchPrCache {
  const runner = options?.runner ?? defaultRunner;
  const branchTip = options?.branchTip ?? defaultBranchTip;
  const ttlMs = options?.ttlMs ?? 60_000;
  const settledTtlMs = options?.settledTtlMs ?? 15 * 60_000;
  const maxConcurrent = options?.maxConcurrent ?? 3;
  const now = options?.now ?? Date.now;

  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<SessionPullRequestContext | null>>();
  // Bumped by invalidation: a lookup that started before it never lands.
  const generations = new Map<string, number>();

  function ttlFor(entry: CacheEntry): number {
    const state = entry.value?.state;
    return (state === "merged" || state === "closed") && !entry.unsettled ? settledTtlMs : ttlMs;
  }

  /** True when the branch moved on after its PR settled (#5795): a reused
   *  branch name showed its old PR as merged for 15 minutes. */
  async function movedSinceSettled(root: string, branch: string, stdout: string): Promise<boolean> {
    const { headSha, settledAt } = settledPullOf(stdout);
    if (!headSha) return false;
    const tip = await branchTip(root, branch).catch(() => null);
    if (!tip || tip.oid === headSha) return false;
    return settledAt === null || tip.committedAt > settledAt;
  }

  function lookup(key: string, root: string, branch: string): Promise<SessionPullRequestContext | null> {
    const pending = inFlight.get(key);
    if (pending) return pending;
    const generation = generations.get(key) ?? 0;
    const current = () => (generations.get(key) ?? 0) === generation;
    const request: Promise<SessionPullRequestContext | null> = runner(root, branch)
      .then(async (stdout) => {
        const value = parseBranchPr(stdout, branch);
        const settled = value?.state === "merged" || value?.state === "closed";
        const unsettled = settled && (await movedSinceSettled(root, branch, stdout));
        if (current()) entries.set(key, { value, fetchedAt: now(), ...(unsettled ? { unsettled } : {}) });
        return value;
      })
      .catch(() => {
        // No PR for this branch, or gh missing/unauthenticated — negative-cache.
        if (current()) entries.set(key, { value: null, fetchedAt: now() });
        return null;
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  }

  // Background refreshes stay capped so the list poll cannot fan out gh.
  function refresh(key: string, root: string, branch: string): void {
    if (inFlight.has(key) || inFlight.size >= maxConcurrent) return;
    void lookup(key, root, branch);
  }

  function forget(key: string): void {
    entries.delete(key);
    inFlight.delete(key);
    generations.set(key, (generations.get(key) ?? 0) + 1);
  }

  return {
    get(root, branch) {
      const key = `${root}\u0000${branch}`;
      const entry = entries.get(key);
      if (!entry || now() - entry.fetchedAt >= ttlFor(entry)) refresh(key, root, branch);
      return entry?.value;
    },
    async resolve(root, branch) {
      const key = `${root}\u0000${branch}`;
      const entry = entries.get(key);
      if (entry) {
        if (now() - entry.fetchedAt >= ttlFor(entry)) refresh(key, root, branch);
        return entry.value;
      }
      return lookup(key, root, branch);
    },
    invalidate(root, branch) {
      for (const key of [...new Set([...entries.keys(), ...inFlight.keys()])]) {
        const split = key.indexOf("\u0000");
        if (key.slice(split + 1) === branch && inCheckout(key.slice(0, split), root)) forget(key);
      }
    },
    invalidatePullRequest(repo, number) {
      for (const [key, entry] of [...entries]) {
        if (entry.value?.number === number && entry.value.repo.toLowerCase() === repo.toLowerCase()) forget(key);
      }
      // A lookup in flight may have read the PR before the merge.
      for (const key of [...inFlight.keys()]) forget(key);
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
