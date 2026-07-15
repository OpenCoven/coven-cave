/**
 * Async git enrichment for /api/sessions/list rows (cave-n37w).
 *
 * The route previously shelled out synchronously — ~5 sequential git
 * probes per unique project root plus up to MAX_DIFF_CALLS `git diff`
 * invocations, each blocking the event loop for up to its 1s timeout. The
 * sessions list is polled every few seconds by the workspace, and the same
 * Node process serves SSE chat streaming and the PTY bridge, so those stalls
 * surfaced as token stutter and terminal lag.
 *
 * This module keeps the exact enrichment semantics (branch, worktree
 * detection, per-branch diffstat vs the repo base ref, PR-context lookup)
 * but runs every git call through async execFile, parallelised per project
 * root under a small concurrency cap so a machine with many roots neither
 * serialises the whole sweep nor forks an unbounded process herd.
 *
 * Security posture matches /api/changes: every invocation is execFile with an
 * argument array (no shell), a timeout, and stdout capped by maxBuffer.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { branchPrCache, type BranchPrCache } from "./branch-pr-context.ts";
import type { SessionGitContext, SessionRow } from "./types.ts";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 1000;
const MAX_GIT_BUFFER = 1024 * 1024;

/**
 * Bound the per-request git work; sessions arrive most-recent-first, so the
 * roll-up's visible rows are covered well within this cap.
 */
export const MAX_DIFF_CALLS = 32;

/** How many project roots are enriched concurrently. */
export const ROOT_CONCURRENCY = 4;

/**
 * Injectable git runner: resolves trimmed stdout, or null on any failure
 * (missing binary, non-zero exit, timeout). Tests substitute a fake.
 */
export type GitRunner = (projectRoot: string, args: string[]) => Promise<string | null>;

export const defaultGitRunner: GitRunner = async (projectRoot, args) => {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_BUFFER,
    });
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
};

function isTrueProjectCwd(projectRoot: string): boolean {
  const trimmed = projectRoot.trim();
  if (!trimmed) return false;
  try {
    return fs.statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

function resolveGitPath(projectRoot: string, value: string | null): string | null {
  if (!value) return null;
  return path.resolve(path.isAbsolute(value) ? value : path.join(projectRoot, value));
}

async function readGitContext(git: GitRunner, projectRoot: string): Promise<SessionGitContext | null> {
  const trimmed = projectRoot.trim();
  if (!isTrueProjectCwd(trimmed)) return null;
  // Cheap gate first: skip non-worktree roots before the slower probes.
  if ((await git(trimmed, ["rev-parse", "--is-inside-work-tree"])) !== "true") return null;

  // Independent probes — run together instead of serially.
  const [currentBranch, worktreeRoot, gitDirRaw, commonDirRaw] = await Promise.all([
    git(trimmed, ["branch", "--show-current"]),
    git(trimmed, ["rev-parse", "--show-toplevel"]),
    git(trimmed, ["rev-parse", "--git-dir"]),
    git(trimmed, ["rev-parse", "--git-common-dir"]),
  ]);
  const branch = currentBranch ?? (await git(trimmed, ["rev-parse", "--short", "HEAD"]));
  const gitDir = resolveGitPath(trimmed, gitDirRaw);
  const commonDir = resolveGitPath(trimmed, commonDirRaw);
  const isWorktree = Boolean(gitDir && commonDir && gitDir !== commonDir);

  if (!branch && !worktreeRoot && !isWorktree) return null;
  return { branch, worktreeRoot, isWorktree };
}

export type DiffStat = { additions: number; deletions: number };

export function parseShortstat(out: string | null): DiffStat | null {
  if (out == null) return null;
  const add = /(\d+) insertion/.exec(out);
  const del = /(\d+) deletion/.exec(out);
  return { additions: add ? Number(add[1]) : 0, deletions: del ? Number(del[1]) : 0 };
}

/**
 * The repo's default base ref (e.g. `origin/main`) to diff a session branch
 * against. Prefers `origin/HEAD`, then common fallbacks.
 */
async function defaultBaseRef(git: GitRunner, root: string): Promise<string | null> {
  const originHead = await git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (originHead) return originHead;
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if ((await git(root, ["rev-parse", "--verify", "--quiet", ref])) != null) return ref;
  }
  return null;
}

/** Run `tasks` with at most `limit` in flight at once; preserves result order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

type RootEnrichment = {
  gitContext: SessionGitContext | null;
  base: string | null;
  /** branch -> diffstat (or null when the diff was skipped/failed). */
  diffByBranch: Map<string, DiffStat | null>;
};

/**
 * Enrich session rows with git context (branch/worktree), a committed-diff
 * stat vs the repo base ref, and cached PR context. All git work is async and
 * grouped per unique project root; roots are processed under a concurrency
 * cap and the total number of `git diff` calls stays bounded by
 * MAX_DIFF_CALLS across the whole request (matching the sync version).
 */
export async function enrichSessionsWithGitContext(
  sessions: SessionRow[],
  git: GitRunner = defaultGitRunner,
  prCache: BranchPrCache = branchPrCache,
): Promise<SessionRow[]> {
  // Collect unique roots and, per root, the branches sessions sit on — the
  // per-root git work happens once regardless of how many sessions share it.
  const roots: string[] = [];
  const seenRoots = new Set<string>();
  for (const session of sessions) {
    const root = session.project_root?.trim();
    if (root && !seenRoots.has(root)) {
      seenRoots.add(root);
      roots.push(root);
    }
  }

  // Global diff budget shared across roots. Reserving a slot synchronously
  // before each await keeps the cap exact even with concurrent workers.
  let diffCalls = 0;
  const enrichmentByRoot = new Map<string, RootEnrichment>();

  await mapWithConcurrency(roots, ROOT_CONCURRENCY, async (root) => {
    const entry: RootEnrichment = { gitContext: null, base: null, diffByBranch: new Map() };
    enrichmentByRoot.set(root, entry);
    entry.gitContext = await readGitContext(git, root);
    const branch = entry.gitContext?.branch;
    if (!branch) return;
    if (diffCalls >= MAX_DIFF_CALLS) return;
    entry.base = await defaultBaseRef(git, root);
    if (!entry.base) {
      entry.diffByBranch.set(branch, null);
      return;
    }
    // Re-check and reserve synchronously (no await between check and
    // increment) so the cap stays exact under concurrent root workers.
    if (diffCalls >= MAX_DIFF_CALLS) return;
    diffCalls += 1;
    const diff = parseShortstat(
      await git(root, ["diff", `${entry.base}...${branch}`, "--shortstat"]),
    ) ?? { additions: 0, deletions: 0 };
    entry.diffByBranch.set(branch, diff);
  });

  return sessions.map((session) => {
    const root = session.project_root?.trim();
    if (!root) return session;
    const entry = enrichmentByRoot.get(root);
    if (!entry) return session;

    const enriched: SessionRow = { ...session };
    if (entry.gitContext) enriched.git = entry.gitContext;
    const branch = entry.gitContext?.branch;
    const diff = branch ? entry.diffByBranch.get(branch) ?? null : null;
    if (diff) enriched.diff = diff;
    // PR context for the thread — synchronous read from the stale-while-
    // revalidate cache (never blocks the poll; see branch-pr-context.ts).
    // Powers the chat list's PR-status signal and the merged-chat auto-archive
    // sweep, so it must be attributed PER SESSION (cave-9q24): stamping the
    // root's currently checked-out branch's PR onto every session sharing the
    // root let one merged PR mass-archive unrelated chats. Use the branch the
    // chat itself recorded at its last turn; for rows without one, fall back
    // to the root's branch only when the root is a WORKTREE — worktrees are
    // branch-stable, so root-branch ≈ session-branch there. A shared checkout
    // without a recorded branch gets no PR context (and is never PR-swept).
    const attributedBranch =
      session.workBranch ??
      (entry.gitContext?.isWorktree ? entry.gitContext.branch ?? null : null);
    if (attributedBranch) {
      const pr = prCache.get(root, attributedBranch);
      if (pr) enriched.pullRequest = pr;
    }
    return enriched;
  });
}
