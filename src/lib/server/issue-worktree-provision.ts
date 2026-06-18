/**
 * Server-side git worktree provisioning for GitHub issues/PRs.
 *
 * The pure naming + isolation rules live in `src/lib/issue-worktree.ts`; this
 * is the side-effecting half that actually runs `git worktree add`. It's shared
 * by the explicit `/api/github/worktree` route and the board-chat session-start
 * flow so there is exactly one implementation of "where does issue N's worktree
 * live and how is it created".
 *
 * Security posture mirrors /api/changes: projectRoot must pass the workspace
 * allow-list / active-session-root check and resolve to a real git toplevel;
 * every git call uses execFile (argv array, no shell); the worktree directory
 * is derived from a sanitized slug + truncated integer and re-checked for
 * containment under repoRoot/.worktrees.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { daemonSessionRoots, resolveWithinSessionRoots } from "@/lib/server/session-project-roots";
import {
  issueWorktreeBranch,
  issueWorktreeDir,
  type IssueWorktreeRef,
} from "@/lib/issue-worktree";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_BUFFER = 16 * 1024 * 1024;

function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_GIT_BUFFER });
}

export type RepoRootResolution =
  | { ok: true; repoRoot: string }
  | { ok: false; status: number; error: string };

/** Validate projectRoot: allow-listed, real directory, git toplevel. */
export async function resolveRepoRoot(projectRoot: string): Promise<RepoRootResolution> {
  if (!projectRoot || !path.isAbsolute(projectRoot)) {
    return { ok: false, status: 400, error: "projectRoot must be an absolute path" };
  }
  let sessionRoots: string[] | null = null;
  const isAllowed = async (candidate: string): Promise<string | null> => {
    const staticAllowed = resolveAllowedProjectPath(candidate);
    if (staticAllowed) return staticAllowed;
    if (sessionRoots === null) sessionRoots = await daemonSessionRoots();
    return resolveWithinSessionRoots(candidate, sessionRoots);
  };

  const allowedRoot = await isAllowed(projectRoot);
  if (!allowedRoot) return { ok: false, status: 403, error: "path not allowed" };

  let real: string;
  try {
    real = fs.realpathSync(path.resolve(allowedRoot));
    if (!fs.statSync(real).isDirectory()) {
      return { ok: false, status: 400, error: "projectRoot is not a directory" };
    }
  } catch {
    return { ok: false, status: 404, error: "projectRoot does not exist" };
  }
  try {
    const { stdout } = await git(real, ["rev-parse", "--show-toplevel"]);
    const top = stdout.trim();
    if (!top) return { ok: false, status: 422, error: "not a git repository" };
    const repoRoot = fs.realpathSync(top);
    if (!(await isAllowed(repoRoot))) return { ok: false, status: 403, error: "path not allowed" };
    return { ok: true, repoRoot };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, status: 500, error: "git unavailable" };
    }
    return { ok: false, status: 422, error: "not a git repository" };
  }
}

/** Resolve the worktree directory and assert it stays under repoRoot/.worktrees. */
function resolveWorktreePath(repoRoot: string, relDir: string): string | null {
  if (!relDir || relDir.includes("\0") || path.isAbsolute(relDir)) return null;
  if (relDir.split(/[\\/]+/).includes("..")) return null;
  const resolved = path.resolve(repoRoot, relDir);
  const worktreesRoot = path.join(repoRoot, ".worktrees");
  if (resolved !== worktreesRoot && !resolved.startsWith(worktreesRoot + path.sep)) return null;
  return resolved;
}

/** Pick the base ref to branch from: prefer origin/main, then origin/HEAD, then HEAD. */
async function pickBaseRef(repoRoot: string, requested?: string | null): Promise<string> {
  const candidates = [requested, "origin/main", "origin/HEAD", "HEAD"].filter(
    (c): c is string => !!c && /^[A-Za-z0-9._/-]+$/.test(c),
  );
  for (const ref of candidates) {
    try {
      await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      /* try next */
    }
  }
  return "HEAD";
}

async function worktreeExists(repoRoot: string, absPath: string): Promise<boolean> {
  try {
    const { stdout } = await git(repoRoot, ["worktree", "list", "--porcelain"]);
    const real = fs.existsSync(absPath) ? fs.realpathSync(absPath) : absPath;
    return stdout.split("\n").some((line) => {
      if (!line.startsWith("worktree ")) return false;
      const p = line.slice("worktree ".length).trim();
      const rp = fs.existsSync(p) ? fs.realpathSync(p) : p;
      return rp === real || p === absPath;
    });
  } catch {
    return false;
  }
}

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export type ProvisionResult =
  | { ok: true; worktree: string; branch: string; created: boolean; baseRef: string | null }
  | { ok: false; status: number; error: string };

/**
 * Idempotently provision the worktree for `ref` under an already-resolved
 * repoRoot. Returns the existing worktree (created:false) if present, otherwise
 * creates a branch off the best base ref and adds the worktree.
 */
export async function provisionIssueWorktree(
  repoRoot: string,
  ref: IssueWorktreeRef,
  baseRefRequest?: string | null,
): Promise<ProvisionResult> {
  const relDir = issueWorktreeDir(ref);
  const branch = issueWorktreeBranch(ref);
  const absPath = resolveWorktreePath(repoRoot, relDir);
  if (!absPath) return { ok: false, status: 400, error: "invalid worktree path" };

  if (await worktreeExists(repoRoot, absPath)) {
    return { ok: true, worktree: absPath, branch, created: false, baseRef: null };
  }

  const baseRef = await pickBaseRef(repoRoot, baseRefRequest ?? null);
  try {
    const args = (await branchExists(repoRoot, branch))
      ? ["worktree", "add", absPath, branch]
      : ["worktree", "add", "-b", branch, absPath, baseRef];
    await git(repoRoot, args);
    return { ok: true, worktree: absPath, branch, created: true, baseRef };
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : "git worktree add failed" };
  }
}
