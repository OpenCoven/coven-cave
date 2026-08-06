import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { daemonSessionRoots, resolveWithinSessionRoots } from "@/lib/server/session-project-roots";
import { isCheckpointName, parseNumstatZ, parsePorcelainZ, planRevert } from "@/lib/git-changes";
import { isSafeBranchName } from "@/lib/issue-worktree";
import { normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import { provisionBranchWorktree } from "@/lib/server/issue-worktree-provision";
import { acquireProcessIntentLock } from "@/lib/server/process-intent-lock";
import {
  CHECKPOINT_METADATA_FILE,
  CHECKPOINT_PATCH_FILE,
  assertCheckpointStore,
  checkpointDeleteQuarantinePath,
  fsyncDirectoryIfSupported,
  markCheckpointQuarantineConflict,
  openCheckpointStore,
  publishCheckpointUnit,
  recoverCheckpointStore as recoverCheckpointStoreArtifacts,
  retireCheckpointQuarantine,
  restoreCheckpointDirectoryQuarantineNoReplace,
  restoreQuarantinedRegularFileNoReplace,
  type CheckpointStore,
} from "@/lib/server/checkpoint-store";
import {
  nativeGitRelativePathIdentityKey,
  nativeGitRelativePathsEqual,
  nativeProjectPathsEqual,
  resolveNativePathWithinRoot,
  resolveNativeProjectPathForGitRoot,
  resolveNativeRepoRelativePathWithinProject,
} from "@/lib/server/native-project-path";

export const dynamic = "force-dynamic";

/** Platform null device: `/dev/null` on POSIX, `nul` on Windows. */
const DEV_NULL = os.devNull;

/**
 * Working-tree changes for a chat session's project root (CHAT-D8-01).
 *
 * GET  ?projectRoot=<abs>                  → list uncommitted changes (git status)
 * GET  ?projectRoot=<abs>&path=<rel>       → unified diff for one file (capped)
 * GET  ?projectRoot=<abs>&checkpoints=1    → list saved checkpoints
 * GET  ?projectRoot=<abs>&checkpoint=<name>→ one checkpoint's patch text (capped)
 * GET  ?projectRoot=<abs>&branches=1       → local branches (current/worktree marked)
 * POST { projectRoot, path | repoRelativePath, confirmUntracked? } → revert ONE file
 * POST { projectRoot, action: "checkpoint" } → save a patch snapshot
 * POST { projectRoot, action: "restore-checkpoint", checkpoint } → git apply a snapshot
 * POST { projectRoot, action: "delete-checkpoint", checkpoint } → remove a snapshot
 * POST { projectRoot, action: "switch-branch", branch } → git switch (chat's branch menu)
 * POST { projectRoot, action: "create-worktree", branch, baseRef? } → .worktrees/<branch>
 *
 * Security posture: every git invocation goes through execFile with an
 * argument array — no shell, so paths are never string-interpolated into a
 * command. Diff commands additionally disable Git external diff helpers and
 * textconv filters so repository-controlled config cannot spawn commands.
 * Revert paths either resolve under the captured project (path) or under the
 * enclosing Git root (repoRelativePath, as returned by GET), then must pass
 * captured-project containment before mutation. Reverting an untracked file
 * deletes it, so that path is gated behind an explicit confirmUntracked flag;
 * the blast radius of a revert POST is one file. Aggregate snapshots and
 * commits are constrained to the resolved project's literal Git pathspec.
 */

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const MAX_GIT_BUFFER = 64 * 1024 * 1024;
const REPOSITORY_CHANGES_LOCK_TIMEOUT_MS = 5_000;
/** Diff payload cap (~200KB) so one giant lockfile diff can't flood the panel. */
const DIFF_CAP_CHARS = 200 * 1024;

// ── git helpers ───────────────────────────────────────────────────────────────

/** Run git via execFile (argument array, no shell interpolation). */
function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
  });
}

function gitWithInput(
  cwd: string,
  args: string[],
  input: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_GIT_BUFFER,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.stdin?.on("error", () => {
      // The exec callback reports the Git failure; ignore a concurrent EPIPE.
    });
    child.stdin?.end(input);
  });
}

/** Run `git diff` without repository-configured command hooks. */
function gitDiff(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return git(cwd, ["diff", "--no-ext-diff", "--no-textconv", ...args]);
}

/** Run `git status` without repository-configured fsmonitor commands. */
function gitStatus(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return git(cwd, ["-c", "core.fsmonitor=false", "status", ...args]);
}

async function repositoryChangesLockDir(repoRoot: string): Promise<string> {
  const { stdout } = await git(repoRoot, ["rev-parse", "--git-common-dir"]);
  const raw = stripGitLineEnding(stdout);
  if (!raw) throw new Error("could not resolve repository lock directory");
  const commonDir = path.isAbsolute(raw)
    ? raw
    : path.resolve(/* turbopackIgnore: true */ repoRoot, raw);
  return path.join(
    /* turbopackIgnore: true */ commonDir,
    "coven-cave",
    "changes-transactions.locks",
  );
}

async function withRepositoryChangesLock<T>(
  repoRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  const configuredTimeout = Number(
    process.env.COVEN_CAVE_CHANGES_LOCK_TIMEOUT_MS,
  );
  const timeoutMs =
    Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : REPOSITORY_CHANGES_LOCK_TIMEOUT_MS;
  const release = await acquireProcessIntentLock({
    intentsDirectory: await repositoryChangesLockDir(repoRoot),
    timeoutMs,
    label: "repository changes",
  });
  try {
    const checkpointStore = openCheckpointStore(await checkpointDirOf(repoRoot));
    if (checkpointStore) {
      recoverCheckpointStoreArtifacts(
        checkpointStore,
        (raw) => parseCheckpointMetadata(raw) !== "invalid",
      );
    }
    return await operation();
  } finally {
    await release();
  }
}

function isRepositoryChangesLockTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "timed out waiting for repository changes lock"
  );
}

function repositoryBusyResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "repository is busy with another changes request; retry shortly" },
    { status: 409, headers: { "Retry-After": "1" } },
  );
}

/** Network git (push) and `gh` can take longer than the read-only 10s budget. */
const NET_TIMEOUT_MS = 60_000;
function gitLong(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, timeout: NET_TIMEOUT_MS, maxBuffer: MAX_GIT_BUFFER });
}
/** Run the GitHub CLI (argument array, no shell) for PR creation. */
function ghCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("gh", args, { cwd, timeout: NET_TIMEOUT_MS, maxBuffer: MAX_GIT_BUFFER });
}

const PR_URL_RE = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/;

/** Current branch name, or "HEAD" when detached. */
async function currentBranch(repoRoot: string): Promise<string> {
  const { stdout } = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

/** Linked-worktree name (the checkout dir's basename) when repoRoot is a
 *  `git worktree` checkout rather than the primary clone, else null. A linked
 *  worktree's --git-dir (.git/worktrees/<name>) differs from its
 *  --git-common-dir (the primary clone's .git). */
async function worktreeName(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await git(repoRoot, ["rev-parse", "--git-dir", "--git-common-dir"]);
    const [gitDir, commonDir] = stdout.trim().split("\n");
    if (!gitDir || !commonDir) return null;
    if (path.resolve(repoRoot, gitDir) === path.resolve(repoRoot, commonDir)) return null;
    return path.basename(repoRoot);
  } catch {
    return null;
  }
}

/** The repo's default branch: origin/HEAD when known, else main/master, else main. */
async function defaultBranch(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await git(repoRoot, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    const m = stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  } catch { /* no origin/HEAD ref */ }
  for (const b of ["main", "master"]) {
    try {
      await git(repoRoot, ["rev-parse", "--verify", "--quiet", b]);
      return b;
    } catch { /* not present */ }
  }
  return "main";
}

/** True when `ref` resolves to a commit in this repo. */
async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

type BranchRow = {
  name: string;
  /** This checkout's current branch. */
  current: boolean;
  /** Checkout dir basename when some worktree has the branch checked out. */
  worktree: string | null;
  /** Absolute path of that worktree — lets the client open a chat there. */
  worktreePath: string | null;
};

/** Branch-menu payload cap: enough for real repos, bounded for pathological ones. */
const MAX_BRANCH_ROWS = 40;

/** Local branches (newest commit first, current branch pinned to the top)
 *  plus which worktree, if any, has each one checked out — powers the chat
 *  composer's branch menu. */
async function listBranches(repoRoot: string) {
  const [{ stdout: refsOut }, { stdout: wtOut }, current] = await Promise.all([
    git(repoRoot, ["for-each-ref", "refs/heads", "--sort=-committerdate", "--format=%(refname:short)"]),
    git(repoRoot, ["worktree", "list", "--porcelain"]),
    currentBranch(repoRoot),
  ]);
  const checkedOut = new Map<string, string>();
  let dir: string | null = null;
  for (const line of wtOut.split("\n")) {
    if (line.startsWith("worktree ")) dir = line.slice("worktree ".length).trim();
    else if (line.startsWith("branch refs/heads/") && dir) {
      checkedOut.set(line.slice("branch refs/heads/".length).trim(), dir);
    }
  }
  const branches: BranchRow[] = [];
  for (const raw of refsOut.split("\n")) {
    const name = raw.trim();
    if (!name) continue;
    // Tool-internal refs (e.g. beads' __dolt_remote_info__) aren't human
    // switch targets — keep them out of the menu.
    if (/^__.*__$/.test(name)) continue;
    const worktreeDir = checkedOut.get(name) ?? null;
    branches.push({
      name,
      current: name === current,
      worktree: worktreeDir ? path.basename(worktreeDir) : null,
      worktreePath: worktreeDir,
    });
    if (branches.length >= MAX_BRANCH_ROWS) break;
  }
  // Stable sort: current branch first, recency order preserved within the rest.
  branches.sort((a, b) => Number(b.current) - Number(a.current));
  return NextResponse.json({ ok: true, branches });
}

/** Server-generated, shell-safe feature branch name derived from the commit
 *  message. `cave/<slug>-<base36-stamp>` — never client-controlled. */
function featureBranchName(message: string, nowMs: number): string {
  const slug = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    // Trim leading/trailing dashes with anchored single-char replaces.
    // The collapse above already reduces any run of separators to a single
    // "-", so a linear-time trim suffices and avoids the polynomial-ReDoS
    // backtracking of `/^-+|-+$/g` on attacker-influenced input.
    .replace(/^-/, "")
    .replace(/-$/, "")
    .slice(0, 32) || "changes";
  return `cave/${slug}-${nowMs.toString(36)}`;
}

function stderrOf(err: unknown): string {
  const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
  return String(e?.stderr || e?.stdout || e?.message || err).trim();
}

function stripGitLineEnding(value: string): string {
  if (process.platform === "win32" && value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

type RootResolution =
  | { ok: true; projectRoot: string; repoRoot: string; projectPathspec: string }
  | { ok: false; status: number; error: string; notARepo?: boolean };
type ResolvedRepoRoot = Extract<RootResolution, { ok: true }>;

function projectPathspecForGitRoot(projectRoot: string, repoRoot: string): string | null {
  if (nativeProjectPathsEqual(projectRoot, repoRoot)) return ".";
  const target = resolveNativePathWithinRoot(repoRoot, projectRoot);
  if (!target) return null;
  return process.platform === "win32"
    ? target.relativePath.replace(/\\/g, "/")
    : target.relativePath;
}

/** Validate projectRoot: absolute, exists, is a directory, is a git work tree.
 *  Resolves to the repo toplevel so status paths line up with diff/revert. */
async function resolveRepoRoot(
  projectRoot: string,
): Promise<RootResolution> {
  if (
    !projectRoot.trim() ||
    /[\0-\x1f\x7f]/.test(projectRoot) ||
    !path.isAbsolute(projectRoot)
  ) {
    return { ok: false, status: 400, error: "projectRoot must be an absolute path" };
  }
  // A path is allowed if it's under the static workspace allow-list OR under a
  // directory the daemon has an active session for (the daemon already spawned
  // a harness there, so it's user-sanctioned). The session-root list is fetched
  // once and reused for the post-`rev-parse` repo-toplevel re-check. A nested
  // project authorizes only itself: every operation that runs from the enclosing
  // repository must independently authorize that repository boundary first.
  let sessionRoots: string[] | null = null;
  const isAllowed = async (candidate: string): Promise<string | null> => {
    const staticAllowed = resolveAllowedProjectPath(candidate);
    if (staticAllowed) return staticAllowed;
    if (sessionRoots === null) sessionRoots = await daemonSessionRoots();
    return resolveWithinSessionRoots(candidate, sessionRoots);
  };

  const allowedRoot = await isAllowed(projectRoot);
  if (!allowedRoot) {
    return { ok: false, status: 403, error: "path not allowed" };
  }
  let real: string;
  let stat: fs.Stats;
  try {
    real = fs.realpathSync(path.resolve(allowedRoot));
    stat = fs.statSync(real);
  } catch {
    return { ok: false, status: 404, error: "projectRoot does not exist" };
  }
  if (!stat.isDirectory()) {
    return { ok: false, status: 400, error: "projectRoot is not a directory" };
  }
  try {
    const { stdout } = await git(real, ["rev-parse", "--show-toplevel"]);
    const top = stripGitLineEnding(stdout);
    if (!top) return { ok: false, status: 422, error: "not a git repository", notARepo: true };
    const repoRoot = fs.realpathSync(top);
    const projectPathspec = projectPathspecForGitRoot(real, repoRoot);
    if (!projectPathspec) {
      return { ok: false, status: 403, error: "path not allowed" };
    }
    if (!(await isAllowed(repoRoot))) {
      return { ok: false, status: 403, error: "path not allowed" };
    }
    return { ok: true, projectRoot: real, repoRoot, projectPathspec };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, status: 500, error: "git unavailable" };
    }
    return { ok: false, status: 422, error: "not a git repository", notARepo: true };
  }
}

/** Containment check: repo-relative path only — reject absolute paths, NUL,
 *  `..` traversal, and anything that resolves outside repoRoot. */
function resolveContainedFile(repoRoot: string, relPath: string): string | null {
  if (path.isAbsolute(relPath)) return null;
  const target = resolveNativePathWithinRoot(repoRoot, relPath);
  if (!target) return null;
  try {
    if (fs.existsSync(target.absolutePath)) {
      const real = fs.realpathSync(target.absolutePath);
      if (!resolveNativePathWithinRoot(repoRoot, real)) return null;
    }
  } catch {
    return null;
  }
  return target.absolutePath;
}

function pathNotAllowed(): NextResponse {
  return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
}

// ── status parsing ────────────────────────────────────────────────────────────
// parsePorcelainZ / parseNumstatZ / statusOf live in @/lib/git-changes so the
// NUL/rename parsing can be unit-tested without next/server or a git process.

async function isTracked(repoRoot: string, relPath: string): Promise<boolean> {
  try {
    await git(repoRoot, ["ls-files", "--error-unmatch", "--", literalGitPathspec(relPath)]);
    return true;
  } catch {
    return false;
  }
}

/** True when <relPath> exists in the HEAD tree. False on an unborn branch
 *  (no HEAD) or when the path was never committed. */
async function existsInHead(repoRoot: string, relPath: string): Promise<boolean> {
  try {
    await git(repoRoot, ["cat-file", "-e", `HEAD:${relPath}`]);
    return true;
  } catch {
    return false;
  }
}

function literalGitPathspec(value: string): string {
  return `:(literal)${value}`;
}

async function changedFilePaths(repoRoot: string, projectPathspec?: string): Promise<Set<string>> {
  const args = ["--porcelain=v1", "-z", "--untracked-files=all"];
  if (projectPathspec) {
    args.push("--no-renames", "--", literalGitPathspec(projectPathspec));
  }
  const { stdout } = await gitStatus(repoRoot, args);
  return new Set(
    parsePorcelainZ(stdout)
      .map((file) => nativeGitRelativePathIdentityKey(file.path))
      .filter((file): file is string => file !== null),
  );
}

async function isChangedFile(
  repoRoot: string,
  relPath: string,
  projectPathspec?: string,
): Promise<boolean> {
  const key = nativeGitRelativePathIdentityKey(relPath);
  return key !== null && (await changedFilePaths(repoRoot, projectPathspec)).has(key);
}

// ── GET: change list / single-file diff ───────────────────────────────────────

function isRepoRelativeFileRevertible(
  root: ResolvedRepoRoot,
  repoRelativePath: string,
): boolean {
  const target = resolveNativeRepoRelativePathWithinProject(
    root.projectRoot,
    root.repoRoot,
    repoRelativePath,
  );
  return (
    target !== null &&
    resolveContainedFile(root.projectRoot, target.projectRelativePath) !== null
  );
}

async function listChanges(root: ResolvedRepoRoot): Promise<NextResponse> {
  const { stdout } = await gitStatus(root.repoRoot, ["--porcelain=v1", "-z", "--untracked-files=all"]);
  const files = parsePorcelainZ(stdout).map((file) => ({
    ...file,
    revertible: isRepoRelativeFileRevertible(root, file.path),
  }));

  // Best-effort ins/del counts vs HEAD (covers staged + unstaged). Repos
  // without a first commit have no HEAD — skip counts rather than fail.
  try {
    const { stdout: numstat } = await gitDiff(root.repoRoot, ["--numstat", "-z", "HEAD", "--"]);
    const counts = parseNumstatZ(numstat);
    for (const file of files) {
      const c = counts.get(file.path);
      if (c) {
        file.insertions = c.insertions;
        file.deletions = c.deletions;
      }
    }
  } catch {
    /* no HEAD yet — list without counts */
  }

  // Current branch rides along so callers (the Projects hub's Git section)
  // don't need a second git endpoint. Unborn repos have no HEAD — omit.
  let branch: string | null = null;
  try {
    branch = await currentBranch(root.repoRoot);
  } catch {
    /* no HEAD yet */
  }

  // Linked-worktree name rides along too (composer git chip) — null in the
  // primary checkout, the checkout dir's basename in a `git worktree`.
  const worktree = await worktreeName(root.repoRoot);

  return NextResponse.json({ ok: true, repo: true, repoRoot: root.repoRoot, branch, worktree, files });
}

/** PR context for the current branch (composer git chip): the open/merged pull
 *  request heading this branch, via `gh pr view` — null when there is no PR,
 *  no branch (detached/unborn HEAD), or `gh` is unavailable/unauthenticated.
 *  Read-only and network-bound, so it's a separate `?pr=1` query the client
 *  fetches once per branch instead of riding the 5s status poll. */
async function branchPr(repoRoot: string): Promise<NextResponse> {
  let branch: string | null = null;
  try {
    branch = await currentBranch(repoRoot);
  } catch {
    /* no HEAD yet */
  }
  if (!branch || branch === "HEAD") return NextResponse.json({ ok: true, branch, pr: null });
  try {
    const { stdout } = await ghCli(repoRoot, [
      "pr", "view", branch, "--json", "number,url,state,isDraft",
    ]);
    const parsed = JSON.parse(stdout) as {
      number?: number; url?: string; state?: string; isDraft?: boolean;
    };
    if (typeof parsed.number === "number" && typeof parsed.url === "string" && PR_URL_RE.test(parsed.url)) {
      return NextResponse.json({
        ok: true,
        branch,
        pr: {
          number: parsed.number,
          url: parsed.url,
          state: typeof parsed.state === "string" ? parsed.state : "OPEN",
          isDraft: parsed.isDraft === true,
        },
      });
    }
  } catch {
    /* no PR for this branch, or gh missing/unauthenticated — a clean null */
  }
  return NextResponse.json({ ok: true, branch, pr: null });
}

async function diffFile(repoRoot: string, relPath: string, absPath: string): Promise<NextResponse> {
  let diff = "";
  if (await isTracked(repoRoot, relPath)) {
    const pathspec = literalGitPathspec(relPath);
    try {
      // Diff vs HEAD so staged edits show up too (status lists them).
      ({ stdout: diff } = await gitDiff(repoRoot, ["HEAD", "--", pathspec]));
    } catch {
      // No HEAD yet (unborn branch) — fall back to worktree-vs-index.
      ({ stdout: diff } = await gitDiff(repoRoot, ["--", pathspec]));
    }
  } else {
    // Untracked: synthesize an all-additions diff. --no-index exits 1 when
    // the files differ, which execFile reports as an error — recover stdout.
    try {
      ({ stdout: diff } = await gitDiff(repoRoot, ["--no-index", "--", DEV_NULL, absPath]));
    } catch (err) {
      const e = err as { code?: number; stdout?: string };
      if (e.code === 1 && typeof e.stdout === "string") diff = e.stdout;
      else throw err;
    }
  }

  const truncated = diff.length > DIFF_CAP_CHARS;
  return NextResponse.json({
    ok: true,
    diff: truncated ? diff.slice(0, DIFF_CAP_CHARS) : diff,
    truncated,
  });
}

export async function GET(req: NextRequest) {
  const projectRoot = req.nextUrl.searchParams.get("projectRoot");
  const filePath = req.nextUrl.searchParams.get("path");
  const wantCheckpoints = req.nextUrl.searchParams.get("checkpoints");
  const checkpointName = req.nextUrl.searchParams.get("checkpoint");
  const wantPr = req.nextUrl.searchParams.get("pr");
  const wantBranches = req.nextUrl.searchParams.get("branches");
  const wantRemote = req.nextUrl.searchParams.get("remote");
  if (!projectRoot) {
    return NextResponse.json({ ok: false, error: "missing projectRoot param" }, { status: 400 });
  }

  const root = await resolveRepoRoot(projectRoot);
  if (!root.ok) {
    if (root.notARepo) {
      // Clear, non-error state the panel can render distinctly.
      return NextResponse.json({ ok: true, repo: false, error: root.error });
    }
    return NextResponse.json({ ok: false, error: root.error }, { status: root.status });
  }

  try {
    if (wantCheckpoints !== null || checkpointName !== null) {
      return await withRepositoryChangesLock(root.repoRoot, async () => {
        if (wantCheckpoints !== null) {
          return NextResponse.json({ ok: true, checkpoints: await listCheckpoints(root) });
        }
        const checkpoint = await resolveCheckpoint(root.repoRoot, checkpointName!);
        if (!checkpoint) return NextResponse.json({ ok: false, error: "checkpoint not found" }, { status: 404 });
        const metadata = readCheckpointMetadata(checkpoint);
        if (!checkpointAuthorizedForProject(root, metadata)) {
          return NextResponse.json(
            { ok: false, error: "checkpoint not authorized for project" },
            { status: 403 },
          );
        }
        let patch: string;
        try {
          patch = readPinnedCheckpointFile(checkpoint, checkpoint.patchPath);
        } catch {
          return NextResponse.json({ ok: false, error: "checkpoint not found" }, { status: 404 });
        }
        const truncated = patch.length > DIFF_CAP_CHARS;
        return NextResponse.json({
          ok: true,
          patch: truncated ? patch.slice(0, DIFF_CAP_CHARS) : patch,
          truncated,
        });
      });
    }
    if (wantPr !== null) return await branchPr(root.repoRoot);
    if (wantRemote !== null) return await originRemoteUrl(root.repoRoot);
    if (wantBranches !== null) return await listBranches(root.repoRoot);
    if (filePath === null) return await listChanges(root);
    const abs = resolveContainedFile(root.repoRoot, filePath);
    if (!abs) return pathNotAllowed();
    if (!(await isChangedFile(root.repoRoot, filePath))) return pathNotAllowed();
    return await diffFile(root.repoRoot, filePath, abs);
  } catch (err) {
    if (isRepositoryChangesLockTimeout(err)) return repositoryBusyResponse();
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Origin remote URL for the repo, normalized to a canonical GitHub HTTPS URL
 *  or null — read-only probe behind the project-setup modal's GitHub prefill.
 *  Credential-bearing remotes (https://token@github.com/…) and non-GitHub
 *  remotes are stripped to null so secrets never reach the client. */
async function originRemoteUrl(repoRoot: string): Promise<NextResponse> {
  try {
    const { stdout } = await git(repoRoot, ["config", "--get", "remote.origin.url"]);
    const remoteUrl = stdout.trim();
    return NextResponse.json({ ok: true, remoteUrl: normalizeGitHubRepoUrl(remoteUrl) });
  } catch {
    // `git config --get` exits 1 when the key is absent — a repo with no
    // origin remote is a normal state, not an error.
    return NextResponse.json({ ok: true, remoteUrl: null });
  }
}

/** Absolute path to this repo's checkpoint store (under .git so snapshots
 *  never themselves show up as worktree changes). */
async function checkpointDirOf(repoRoot: string): Promise<string> {
  const { stdout: gitDirOut } = await git(repoRoot, ["rev-parse", "--git-dir"]);
  const gitDirRaw = stripGitLineEnding(gitDirOut);
  const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(/* turbopackIgnore: true */ repoRoot, gitDirRaw);
  return path.join(/* turbopackIgnore: true */ gitDir, "coven-cave", "checkpoints");
}

type CheckpointUnit = {
  format: "directory" | "legacy";
  name: string;
  store: CheckpointStore;
  publishedPath: string;
  patchPath: string;
  metadataPath: string | null;
};

/** Validate and resolve only complete, published checkpoint units. */
async function resolveCheckpoint(
  repoRoot: string,
  name: string,
): Promise<CheckpointUnit | null> {
  if (!isCheckpointName(name)) return null;
  // path.basename strips any directory component — a recognized path-injection
  // barrier and redundant with isCheckpointName (which already forbids slashes).
  const base = path.basename(name);
  if (base !== name) return null;
  const dir = await checkpointDirOf(repoRoot);
  const store = openCheckpointStore(dir);
  if (!store) return null;
  assertCheckpointStore(store);
  const abs = path.join(/* turbopackIgnore: true */ dir, base);
  // Belt-and-braces: verify the join stayed inside the checkpoint dir.
  if (!abs.startsWith(dir + path.sep)) return null;
  return resolveCheckpointInDirectory(store, base);
}

type RevertCheckpointScope = {
  kind: "revert-target";
  projectRoot: string;
  targetProjectRelativePath: string;
  targetGitPath: string;
};

type ProjectCheckpointScope = {
  kind: "project-scope";
  projectRoot: string;
  projectPathspec: string;
};

type CheckpointScope = RevertCheckpointScope | ProjectCheckpointScope;

type CheckpointMetadata = CheckpointScope & {
  version: 1;
};

function legacyCheckpointMetadataPath(checkpointPath: string): string {
  return `${checkpointPath}.scope.json`;
}

function readCheckpointMetadata(
  checkpoint: CheckpointUnit,
): CheckpointMetadata | null | "invalid" {
  const metadataPath = checkpoint.metadataPath;
  if (!metadataPath) return null;
  let metadataFile: ReturnType<typeof openCheckpointFileIdentity>;
  try {
    assertCheckpointStore(checkpoint.store);
    metadataFile = openCheckpointFileIdentity(metadataPath);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" &&
      checkpoint.format === "legacy"
    ) {
      return null;
    }
    return "invalid";
  }
  try {
    const raw = fs.readFileSync(metadataFile.fd, "utf8");
    assertCheckpointStore(checkpoint.store);
    if (
      !sameCheckpointFileIdentity(metadataPath, metadataFile.identity)
    ) {
      return "invalid";
    }
    return parseCheckpointMetadata(raw);
  } finally {
    fs.closeSync(metadataFile.fd);
  }
}

function parseCheckpointMetadata(
  raw: string,
): CheckpointMetadata | "invalid" {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      typeof parsed.projectRoot !== "string"
    ) {
      return "invalid";
    }
    if (
      parsed.kind === "revert-target" &&
      typeof parsed.targetProjectRelativePath === "string" &&
      typeof parsed.targetGitPath === "string"
    ) {
      return parsed as CheckpointMetadata;
    }
    if (
      parsed.kind === "project-scope" &&
      typeof parsed.projectPathspec === "string"
    ) {
      return parsed as CheckpointMetadata;
    }
    return "invalid";
  } catch {
    return "invalid";
  }
}

function checkpointAuthorizedForProject(
  root: ResolvedRepoRoot,
  metadata: CheckpointMetadata | null | "invalid",
): metadata is CheckpointMetadata | null {
  if (metadata === "invalid") return false;
  if (!metadata) return nativeProjectPathsEqual(root.projectRoot, root.repoRoot);
  if (!nativeProjectPathsEqual(metadata.projectRoot, root.projectRoot)) {
    return false;
  }
  if (metadata.kind === "project-scope") {
    return nativeGitRelativePathsEqual(
      metadata.projectPathspec,
      root.projectPathspec,
    );
  }
  const target = resolveNativeProjectPathForGitRoot(
    root.projectRoot,
    root.repoRoot,
    metadata.targetProjectRelativePath,
  );
  return (
    target !== null &&
    nativeGitRelativePathsEqual(target.gitRelativePath, metadata.targetGitPath)
  );
}

type CheckpointFileIdentity = {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

type OpenCheckpointFile = {
  fd: number;
  identity: CheckpointFileIdentity;
  closed: boolean;
};

function checkpointFileIdentity(stat: fs.Stats): CheckpointFileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameCheckpointFileObject(
  actual: CheckpointFileIdentity,
  expected: CheckpointFileIdentity,
): boolean {
  return (
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.mode === expected.mode &&
    actual.size === expected.size &&
    actual.mtimeMs === expected.mtimeMs
  );
}

function sameOpenedCheckpointIdentity(
  actual: CheckpointFileIdentity,
  expected: CheckpointFileIdentity,
): boolean {
  return (
    sameCheckpointFileObject(actual, expected) &&
    actual.nlink === expected.nlink &&
    actual.ctimeMs === expected.ctimeMs
  );
}

function openCheckpointFileIdentity(file: string): OpenCheckpointFile {
  const pathStat = fs.lstatSync(/* turbopackIgnore: true */ file);
  if (!pathStat.isFile()) throw new Error("checkpoint is not a regular file");
  if (pathStat.nlink !== 1) throw new Error("checkpoint must not be hard-linked");
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(
    /* turbopackIgnore: true */ file,
    fs.constants.O_RDONLY | noFollow,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error("checkpoint is not a regular file");
    const identity = checkpointFileIdentity(stat);
    if (
      identity.nlink !== 1 ||
      !sameOpenedCheckpointIdentity(identity, checkpointFileIdentity(pathStat))
    ) {
      throw new Error("checkpoint changed while being inspected");
    }
    return {
      fd,
      identity,
      closed: false,
    };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function closeCheckpointFile(file: OpenCheckpointFile | null): void {
  if (!file || file.closed) return;
  fs.closeSync(file.fd);
  file.closed = true;
}

function readPinnedCheckpointFile(
  checkpoint: CheckpointUnit,
  file: string,
): string {
  assertCheckpointStore(checkpoint.store);
  const opened = openCheckpointFileIdentity(file);
  try {
    const contents = fs.readFileSync(opened.fd, "utf8");
    assertCheckpointStore(checkpoint.store);
    if (!sameCheckpointFileIdentity(file, opened.identity)) {
      throw new Error("checkpoint changed while being read");
    }
    return contents;
  } finally {
    closeCheckpointFile(opened);
  }
}

function sameCheckpointFileIdentity(
  file: string,
  expected: CheckpointFileIdentity,
): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(/* turbopackIgnore: true */ file);
  } catch {
    return false;
  }
  return (
    stat.isFile() &&
    stat.nlink === 1 &&
    sameCheckpointFileObject(checkpointFileIdentity(stat), expected)
  );
}

function resolveCheckpointInDirectory(
  store: CheckpointStore,
  name: string,
): CheckpointUnit | null {
  if (!isCheckpointName(name) || path.basename(name) !== name) return null;
  assertCheckpointStore(store);
  const checkpointDir = store.directory;
  const publishedPath = path.join(
    /* turbopackIgnore: true */ checkpointDir,
    name,
  );
  let publishedStat: fs.Stats;
  try {
    publishedStat = fs.lstatSync(/* turbopackIgnore: true */ publishedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (publishedStat.isSymbolicLink()) return null;

  if (publishedStat.isDirectory()) {
    const entries = fs.readdirSync(
      /* turbopackIgnore: true */ publishedPath,
    ).sort();
    if (
      entries.length !== 2 ||
      entries[0] !== CHECKPOINT_PATCH_FILE ||
      entries[1] !== CHECKPOINT_METADATA_FILE
    ) {
      return null;
    }
    const patchPath = path.join(publishedPath, CHECKPOINT_PATCH_FILE);
    const metadataPath = path.join(publishedPath, CHECKPOINT_METADATA_FILE);
    let patchFile: OpenCheckpointFile | null = null;
    let metadataFile: OpenCheckpointFile | null = null;
    try {
      patchFile = openCheckpointFileIdentity(patchPath);
      metadataFile = openCheckpointFileIdentity(metadataPath);
      const verifiedDirectory = fs.lstatSync(
        /* turbopackIgnore: true */ publishedPath,
      );
      const verifiedEntries = fs.readdirSync(
        /* turbopackIgnore: true */ publishedPath,
      ).sort();
      if (
        !verifiedDirectory.isDirectory() ||
        verifiedDirectory.dev !== publishedStat.dev ||
        verifiedDirectory.ino !== publishedStat.ino ||
        verifiedEntries.length !== 2 ||
        verifiedEntries[0] !== CHECKPOINT_PATCH_FILE ||
        verifiedEntries[1] !== CHECKPOINT_METADATA_FILE
      ) {
        return null;
      }
      assertCheckpointStore(store);
      return {
        format: "directory",
        name,
        store,
        publishedPath,
        patchPath,
        metadataPath,
      };
    } catch {
      return null;
    } finally {
      closeCheckpointFile(patchFile);
      closeCheckpointFile(metadataFile);
    }
  }

  if (!publishedStat.isFile()) return null;
  let patchFile: OpenCheckpointFile | null = null;
  try {
    patchFile = openCheckpointFileIdentity(publishedPath);
  } catch {
    return null;
  } finally {
    closeCheckpointFile(patchFile);
  }
  const metadataPath = legacyCheckpointMetadataPath(publishedPath);
  assertCheckpointStore(store);
  return {
    format: "legacy",
    name,
    store,
    publishedPath,
    patchPath: publishedPath,
    metadataPath: fileExists(metadataPath) ? metadataPath : null,
  };
}

type CheckpointQuarantine = {
  directory: string;
  checkpointPath: string;
  metadataPath: string;
};

function createCheckpointQuarantine(
  checkpoint: CheckpointUnit,
): CheckpointQuarantine {
  assertCheckpointStore(checkpoint.store);
  const directory = checkpointDeleteQuarantinePath(
    checkpoint.store,
    checkpoint.name,
    "legacy",
  );
  fs.mkdirSync(/* turbopackIgnore: true */ directory, { mode: 0o700 });
  fsyncDirectoryIfSupported(checkpoint.store.directory);
  const quarantinedCheckpoint = path.join(directory, "checkpoint.patch");
  const quarantinedMetadata = path.join(directory, "metadata.scope.json");
  if (
    path.dirname(quarantinedCheckpoint) !== directory ||
    path.dirname(quarantinedMetadata) !== directory
  ) {
    throw new Error("checkpoint quarantine path escaped");
  }
  return {
    directory,
    checkpointPath: quarantinedCheckpoint,
    metadataPath: quarantinedMetadata,
  };
}

function removeEmptyCheckpointQuarantine(quarantine: CheckpointQuarantine): void {
  try {
    fs.rmdirSync(/* turbopackIgnore: true */ quarantine.directory);
  } catch {
    // A non-empty quarantine can contain an unverified replacement. Preserve it.
  }
}

type DeleteCheckpointResult = "deleted" | "not-found" | "unauthorized";

function deleteDirectoryCheckpoint(
  root: ResolvedRepoRoot,
  checkpoint: CheckpointUnit,
): DeleteCheckpointResult {
  assertCheckpointStore(checkpoint.store);
  const directoryStat = fs.lstatSync(
    /* turbopackIgnore: true */ checkpoint.publishedPath,
  );
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("checkpoint changed during deletion");
  }
  const patch = openCheckpointFileIdentity(checkpoint.patchPath);
  const metadataFile = openCheckpointFileIdentity(checkpoint.metadataPath!);
  const metadataRaw = fs.readFileSync(metadataFile.fd, "utf8");
  const metadata = parseCheckpointMetadata(metadataRaw);
  if (!checkpointAuthorizedForProject(root, metadata)) {
    closeCheckpointFile(patch);
    closeCheckpointFile(metadataFile);
    return "unauthorized";
  }
  const quarantine = checkpointDeleteQuarantinePath(
    checkpoint.store,
    checkpoint.name,
    "directory",
  );
  let moved = false;
  try {
    closeCheckpointFile(patch);
    closeCheckpointFile(metadataFile);
    assertCheckpointStore(checkpoint.store);
    fs.renameSync(
      /* turbopackIgnore: true */ checkpoint.publishedPath,
      /* turbopackIgnore: true */ quarantine,
    );
    moved = true;
    fsyncDirectoryIfSupported(checkpoint.store.directory);
    const movedDirectory = fs.lstatSync(
      /* turbopackIgnore: true */ quarantine,
    );
    const movedPatch = openCheckpointFileIdentity(
      path.join(quarantine, CHECKPOINT_PATCH_FILE),
    );
    const movedMetadata = openCheckpointFileIdentity(
      path.join(quarantine, CHECKPOINT_METADATA_FILE),
    );
    try {
      if (
        !movedDirectory.isDirectory() ||
        movedDirectory.dev !== directoryStat.dev ||
        movedDirectory.ino !== directoryStat.ino ||
        !sameCheckpointFileObject(movedPatch.identity, patch.identity) ||
        !sameCheckpointFileObject(
          movedMetadata.identity,
          metadataFile.identity,
        )
      ) {
        throw new Error("checkpoint changed during deletion");
      }
    } finally {
      closeCheckpointFile(movedPatch);
      closeCheckpointFile(movedMetadata);
    }
    assertCheckpointStore(checkpoint.store);
    const finalEntries = fs.readdirSync(
      /* turbopackIgnore: true */ quarantine,
    ).sort();
    if (
      finalEntries.length !== 2 ||
      finalEntries[0] !== CHECKPOINT_PATCH_FILE ||
      finalEntries[1] !== CHECKPOINT_METADATA_FILE ||
      !sameCheckpointFileIdentity(
        path.join(quarantine, CHECKPOINT_PATCH_FILE),
        movedPatch.identity,
      ) ||
      !sameCheckpointFileIdentity(
        path.join(quarantine, CHECKPOINT_METADATA_FILE),
        movedMetadata.identity,
      )
    ) {
      throw new Error("checkpoint changed during deletion");
    }
    retireCheckpointQuarantine(checkpoint.store, quarantine, true);
    moved = false;
    return "deleted";
  } catch (error) {
    if (moved && !fileExists(checkpoint.publishedPath)) {
      try {
        const restored =
          restoreCheckpointDirectoryQuarantineNoReplace(
            checkpoint.store,
            quarantine,
            checkpoint.publishedPath,
            (raw) =>
              raw === metadataRaw &&
              checkpointAuthorizedForProject(
                root,
                parseCheckpointMetadata(raw),
              ),
          );
        if (restored) {
          moved = false;
        } else if (fileExists(checkpoint.publishedPath)) {
          markCheckpointQuarantineConflict(
            checkpoint.store,
            quarantine,
            checkpoint.publishedPath,
          );
        }
      } catch {
        // A complete unit remains quarantined for the next locked recovery.
      }
    }
    throw error;
  } finally {
    closeCheckpointFile(patch);
    closeCheckpointFile(metadataFile);
  }
}

function deleteAuthorizedCheckpoint(
  root: ResolvedRepoRoot,
  checkpointUnit: CheckpointUnit,
): DeleteCheckpointResult {
  assertCheckpointStore(checkpointUnit.store);
  if (checkpointUnit.format === "directory") {
    return deleteDirectoryCheckpoint(root, checkpointUnit);
  }
  const checkpointPath = checkpointUnit.publishedPath;
  const metadataPath = legacyCheckpointMetadataPath(checkpointPath);
  let checkpoint: OpenCheckpointFile;
  try {
    checkpoint = openCheckpointFileIdentity(checkpointPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      const orphanedMetadata = openCheckpointFileIdentity(metadataPath);
      closeCheckpointFile(orphanedMetadata);
      throw new Error("checkpoint metadata remains after checkpoint deletion");
    } catch (metadataError) {
      if ((metadataError as NodeJS.ErrnoException).code === "ENOENT") {
        return "not-found";
      }
      throw metadataError;
    }
  }
  let metadataFile: OpenCheckpointFile | null = null;
  let metadataRaw: string | null = null;
  let metadata: CheckpointMetadata | null | "invalid" = null;
  try {
    try {
      metadataFile = openCheckpointFileIdentity(metadataPath);
      metadataRaw = fs.readFileSync(metadataFile.fd, "utf8");
      metadata = parseCheckpointMetadata(metadataRaw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!checkpointAuthorizedForProject(root, metadata)) return "unauthorized";

    const quarantine = createCheckpointQuarantine(checkpointUnit);
    let checkpointMoved = false;
    let metadataMoved = false;
    let quarantinedCheckpoint: OpenCheckpointFile | null = null;
    let quarantinedMetadata: OpenCheckpointFile | null = null;
    try {
      assertCheckpointStore(checkpointUnit.store);
      fs.renameSync(
        /* turbopackIgnore: true */ checkpointPath,
        /* turbopackIgnore: true */ quarantine.checkpointPath,
      );
      checkpointMoved = true;
      fsyncDirectoryIfSupported(checkpointUnit.store.directory);

      try {
        assertCheckpointStore(checkpointUnit.store);
        fs.renameSync(
          /* turbopackIgnore: true */ metadataPath,
          /* turbopackIgnore: true */ quarantine.metadataPath,
        );
        metadataMoved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || metadataFile) {
          throw error;
        }
      }

      if (!metadataFile && metadataMoved) {
        throw new Error("checkpoint metadata changed during deletion");
      }

      quarantinedCheckpoint = openCheckpointFileIdentity(
        quarantine.checkpointPath,
      );
      if (
        !sameCheckpointFileObject(
          quarantinedCheckpoint.identity,
          checkpoint.identity,
        )
      ) {
        throw new Error("checkpoint changed during deletion");
      }

      if (metadataFile) {
        if (!metadataMoved || metadataRaw === null) {
          throw new Error("checkpoint metadata changed during deletion");
        }
        quarantinedMetadata = openCheckpointFileIdentity(quarantine.metadataPath);
        const quarantinedMetadataRaw = fs.readFileSync(
          quarantinedMetadata.fd,
          "utf8",
        );
        if (
          !sameCheckpointFileObject(
            quarantinedMetadata.identity,
            metadataFile.identity,
          ) ||
          quarantinedMetadataRaw !== metadataRaw ||
          !checkpointAuthorizedForProject(
            root,
            parseCheckpointMetadata(quarantinedMetadataRaw),
          )
        ) {
          throw new Error("checkpoint metadata changed during deletion");
        }
      } else {
        // Re-check immediately before unlinking the checkpoint. If legacy
        // metadata appeared after inspection, quarantine and preserve it.
        try {
          fs.renameSync(
            /* turbopackIgnore: true */ metadataPath,
            /* turbopackIgnore: true */ quarantine.metadataPath,
          );
          metadataMoved = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (metadataMoved) {
          throw new Error("checkpoint metadata changed during deletion");
        }
      }

      closeCheckpointFile(quarantinedCheckpoint);
      closeCheckpointFile(quarantinedMetadata);
      closeCheckpointFile(checkpoint);
      closeCheckpointFile(metadataFile);
      assertCheckpointStore(checkpointUnit.store);
      if (
        !sameCheckpointFileIdentity(
          quarantine.checkpointPath,
          quarantinedCheckpoint.identity,
        )
      ) {
        throw new Error("checkpoint changed during deletion");
      }
      if (
        quarantinedMetadata &&
        !sameCheckpointFileIdentity(
          quarantine.metadataPath,
          quarantinedMetadata.identity,
        )
      ) {
        throw new Error("checkpoint metadata changed during deletion");
      }

      retireCheckpointQuarantine(
        checkpointUnit.store,
        quarantine.directory,
        metadataMoved,
      );
      checkpointMoved = false;
      metadataMoved = false;
      return "deleted";
    } catch (error) {
      closeCheckpointFile(quarantinedCheckpoint);
      closeCheckpointFile(quarantinedMetadata);
      let storeIsPinned = true;
      try {
        assertCheckpointStore(checkpointUnit.store);
      } catch {
        storeIsPinned = false;
      }
      if (checkpointMoved && storeIsPinned) {
        if (metadataMoved) {
          const restored = restoreCheckpointDirectoryQuarantineNoReplace(
            checkpointUnit.store,
            quarantine.directory,
            checkpointPath,
            (raw) =>
              metadataRaw !== null &&
              raw === metadataRaw &&
              checkpointAuthorizedForProject(
                root,
                parseCheckpointMetadata(raw),
              ),
          );
          if (!restored && fileExists(checkpointPath)) {
            markCheckpointQuarantineConflict(
              checkpointUnit.store,
              quarantine.directory,
              checkpointPath,
            );
          }
        } else {
          const restored = restoreQuarantinedRegularFileNoReplace(
            quarantine.checkpointPath,
            checkpointPath,
          );
          if (!restored && fileExists(checkpointPath)) {
            markCheckpointQuarantineConflict(
              checkpointUnit.store,
              quarantine.directory,
              checkpointPath,
            );
          }
        }
      }
      if (storeIsPinned) removeEmptyCheckpointQuarantine(quarantine);
      throw error;
    }
  } finally {
    closeCheckpointFile(checkpoint);
    closeCheckpointFile(metadataFile);
  }
}

async function checkpointChanges(
  repoRoot: string,
  scope: CheckpointScope,
): Promise<string> {
  // Store snapshots under .git/coven-cave/checkpoints so the checkpoint never
  // creates new worktree changes.
  const scopedPathspec = literalGitPathspec(
    scope.kind === "revert-target"
      ? scope.targetGitPath
      : scope.projectPathspec,
  );
  let patch = "";
  try {
    ({ stdout: patch } = await gitDiff(
      repoRoot,
      ["--binary", "--no-renames", "HEAD", "--", scopedPathspec],
    ));
  } catch {
    ({ stdout: patch } = await gitDiff(
      repoRoot,
      ["--binary", "--no-renames", "--", scopedPathspec],
    ));
  }

  const statusArgs = ["--porcelain=v1", "-z", "--untracked-files=all"];
  statusArgs.push("--no-renames", "--", scopedPathspec);
  const { stdout: statusOut } = await gitStatus(repoRoot, statusArgs);
  for (const file of parsePorcelainZ(statusOut)) {
    if (file.status === "untracked") {
      const abs = resolveContainedFile(repoRoot, file.path);
      if (!abs || !fs.existsSync(/* turbopackIgnore: true */ abs)) {
        throw new Error("checkpoint path escaped project scope");
      }
      const projectTarget = resolveNativeProjectPathForGitRoot(
        scope.projectRoot,
        repoRoot,
        abs,
      );
      if (
        !projectTarget ||
        !resolveContainedFile(scope.projectRoot, projectTarget.projectRelativePath)
      ) {
        throw new Error("checkpoint path escaped project scope");
      }
      try {
        // Pass the REPO-RELATIVE path (cwd is repoRoot) so the synthesized
        // add-file diff carries `b/<relpath>` headers that `git apply` can
        // place back — absolute paths here would make the checkpoint
        // un-restorable for untracked files.
        const { stdout } = await gitDiff(repoRoot, [
          "--binary",
          "--no-index",
          "--",
          DEV_NULL,
          file.path,
        ]);
        patch += stdout;
      } catch (err) {
        const e = err as { code?: number; stdout?: string };
        if (e.code === 1 && typeof e.stdout === "string") patch += e.stdout;
        else throw err;
      }
    }
  }

  const checkpointDir = await checkpointDirOf(repoRoot);
  const checkpointStore = openCheckpointStore(checkpointDir, { create: true });
  if (!checkpointStore) throw new Error("could not create checkpoint store");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return publishCheckpointUnit(
    checkpointStore,
    `${stamp}.patch`,
    patch,
    JSON.stringify({
      version: 1,
      ...scope,
    } satisfies CheckpointMetadata),
  );
}

function fileExists(file: string): boolean {
  try {
    fs.lstatSync(/* turbopackIgnore: true */ file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

type CheckpointMeta = { name: string; savedAt: string; bytes: number };

/** List saved checkpoints, newest first. The stamp name sorts chronologically. */
async function listCheckpoints(root: ResolvedRepoRoot): Promise<CheckpointMeta[]> {
  const dir = await checkpointDirOf(root.repoRoot);
  const store = openCheckpointStore(dir);
  if (!store) return [];
  assertCheckpointStore(store);
  const names = fs.readdirSync(/* turbopackIgnore: true */ dir);
  const metas: CheckpointMeta[] = [];
  for (const name of names) {
    if (!isCheckpointName(name)) continue;
    try {
      const checkpoint = resolveCheckpointInDirectory(store, name);
      if (!checkpoint) continue;
      if (
        !checkpointAuthorizedForProject(
          root,
          readCheckpointMetadata(checkpoint),
        )
      ) {
        continue;
      }
      const st = fs.statSync(
        /* turbopackIgnore: true */ checkpoint.patchPath,
      );
      metas.push({ name, savedAt: st.mtime.toISOString(), bytes: st.size });
    } catch {
      /* vanished between readdir and stat — skip */
    }
  }
  metas.sort((a, b) => (a.name < b.name ? 1 : -1));
  return metas;
}

/** Apply a saved checkpoint patch onto the current worktree (3-way so it can
 *  reconstruct the snapshot even if the tree has moved since). */
function checkpointPatchPaths(numstat: string): string[] {
  const tokens = numstat.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const record = tokens[index];
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const directPath = record.slice(secondTab + 1);
    if (directPath) {
      paths.push(directPath);
      continue;
    }
    const oldPath = tokens[index + 1];
    const newPath = tokens[index + 2];
    if (oldPath) paths.push(oldPath);
    if (newPath) paths.push(newPath);
    index += 2;
  }
  return paths;
}

function checkpointPatchPathAuthorized(
  root: ResolvedRepoRoot,
  metadata: CheckpointMetadata,
  candidate: string,
): boolean {
  if (metadata.kind === "revert-target") {
    return nativeGitRelativePathsEqual(candidate, metadata.targetGitPath);
  }
  const target = resolveNativeRepoRelativePathWithinProject(
    root.projectRoot,
    root.repoRoot,
    candidate,
  );
  return (
    target !== null &&
    resolveContainedFile(root.projectRoot, target.projectRelativePath) !== null
  );
}

async function restoreCheckpoint(
  root: ResolvedRepoRoot,
  checkpoint: CheckpointUnit,
  metadata: CheckpointMetadata | null,
): Promise<void> {
  assertCheckpointStore(checkpoint.store);
  const patch = readPinnedCheckpointFile(checkpoint, checkpoint.patchPath);
  if (!patch.trim()) return; // empty snapshot — nothing to apply
  if (metadata) {
    const { stdout } = await gitWithInput(
      root.repoRoot,
      ["apply", "--numstat", "-z", "-"],
      patch,
    );
    const paths = checkpointPatchPaths(stdout);
    if (
      paths.length === 0 ||
      paths.some((candidate) => !checkpointPatchPathAuthorized(root, metadata, candidate))
    ) {
      throw new Error("checkpoint contains paths outside its authorized scope");
    }
  }
  await gitWithInput(
    root.repoRoot,
    ["apply", "--3way", "--whitespace=nowarn", "-"],
    patch,
  );
}

// ── POST: revert one file / checkpoint changes ───────────────────────────────

const POST_ACTIONS = new Set([
  "revert",
  "checkpoint",
  "restore-checkpoint",
  "delete-checkpoint",
  "commit",
  "create-pr",
  "switch-branch",
  "create-worktree",
] as const);
type PostAction = typeof POST_ACTIONS extends Set<infer T> ? T : never;

function isPostAction(value: unknown): value is PostAction {
  return typeof value === "string" && POST_ACTIONS.has(value as PostAction);
}

type PostBody = {
  projectRoot?: string;
  path?: string;
  repoRelativePath?: string;
  confirmUntracked?: boolean;
  action?: unknown;
  checkpoint?: string;
  message?: string;
  title?: string;
  prBody?: string;
  branch?: string;
  baseRef?: string;
};

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (typeof body.projectRoot !== "string") {
    return NextResponse.json(
      { ok: false, error: "projectRoot is required" },
      { status: 400 },
    );
  }
  const requestedAction = body.action ?? "revert";
  if (!isPostAction(requestedAction)) {
    return NextResponse.json(
      { ok: false, error: "unsupported action" },
      { status: 400 },
    );
  }
  const action = requestedAction;

  const root = await resolveRepoRoot(body.projectRoot);
  if (!root.ok) {
    return NextResponse.json({ ok: false, error: root.error }, { status: root.status });
  }
  try {
    return await withRepositoryChangesLock(
      root.repoRoot,
      () => performPostAction(root, action, body),
    );
  } catch (error) {
    if (isRepositoryChangesLockTimeout(error)) return repositoryBusyResponse();
    return NextResponse.json(
      { ok: false, error: stderrOf(error) },
      { status: 500 },
    );
  }
}

async function performPostAction(
  root: ResolvedRepoRoot,
  action: PostAction,
  body: PostBody,
): Promise<NextResponse> {
  if (action === "checkpoint") {
    try {
      const checkpointPath = await checkpointChanges(root.repoRoot, {
        kind: "project-scope",
        projectRoot: root.projectRoot,
        projectPathspec: root.projectPathspec,
      });
      return NextResponse.json({ ok: true, checkpointPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
  // Stage and commit only this project's working-tree changes. A commit made
  // while on the default branch (or a detached HEAD) first spins up a fresh
  // `cave/<slug>` feature branch so the default branch remains clean.
  // The commit is signed (-S) to match the repo norm; a signing failure is
  // surfaced rather than silently dropped.
  if (action === "commit") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ ok: false, error: "commit message is required" }, { status: 400 });
    }
    try {
      if ((await changedFilePaths(root.repoRoot, root.projectPathspec)).size === 0) {
        return NextResponse.json(
          { ok: false, error: "nothing to commit — the project is clean" },
          { status: 400 },
        );
      }
      const cur = await currentBranch(root.repoRoot);
      const def = await defaultBranch(root.repoRoot);
      let branch = cur;
      let branchCreated = false;
      if (cur === def || cur === "HEAD") {
        branch = featureBranchName(message, Date.now());
        await git(root.repoRoot, ["checkout", "-b", branch]);
        branchCreated = true;
      }
      const projectPathspec = literalGitPathspec(root.projectPathspec);
      try {
        await git(root.repoRoot, ["add", "-A", "--", projectPathspec]);
        await gitLong(root.repoRoot, [
          "commit",
          "-S",
          "-m",
          message,
          "--only",
          "--",
          projectPathspec,
        ]);
      } catch (err) {
        // Roll back the just-created branch after a failed stage or commit.
        if (branchCreated) await git(root.repoRoot, ["checkout", cur]).catch(() => {});
        const detail = stderrOf(err);
        const signing = /gpg|signing|ssh|secret key|sign/i.test(detail);
        return NextResponse.json(
          { ok: false, error: signing ? `commit signing failed: ${detail}` : `commit failed: ${detail}` },
          { status: 500 },
        );
      }
      const { stdout: sha } = await git(root.repoRoot, ["rev-parse", "--short", "HEAD"]);
      return NextResponse.json({
        ok: true,
        sha: sha.trim(),
        branch,
        branchCreated,
        onDefaultBranch: branch === def,
        defaultBranch: def,
      });
    } catch (err) {
      return NextResponse.json({ ok: false, error: stderrOf(err) }, { status: 500 });
    }
  }
  // Push the current feature branch and open a GitHub pull request via `gh`.
  // Refuses to run from the default branch (there'd be nothing to PR and the
  // push would be rejected by branch protection). If a PR already exists for
  // the branch, gh's message carries its URL — surfaced as a success.
  if (action === "create-pr") {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ ok: false, error: "PR title is required" }, { status: 400 });
    }
    const prBody = typeof body.prBody === "string" ? body.prBody : "";
    try {
      const branch = await currentBranch(root.repoRoot);
      const def = await defaultBranch(root.repoRoot);
      if (branch === def || branch === "HEAD") {
        return NextResponse.json(
          { ok: false, error: `you're on ${branch} — commit to a feature branch first, then open a PR` },
          { status: 400 },
        );
      }
      try {
        await gitLong(root.repoRoot, ["push", "-u", "origin", branch]);
      } catch (err) {
        return NextResponse.json({ ok: false, error: `git push failed: ${stderrOf(err)}` }, { status: 502 });
      }
      try {
        const { stdout } = await ghCli(root.repoRoot, [
          "pr", "create", "--base", def, "--head", branch, "--title", title, "--body", prBody,
        ]);
        const url = stdout.match(PR_URL_RE)?.[0] ?? stdout.trim();
        return NextResponse.json({ ok: true, url, branch, base: def });
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { stderr?: string };
        if (e.code === "ENOENT") {
          return NextResponse.json({ ok: false, error: "GitHub CLI (gh) not found — install it to open PRs" }, { status: 500 });
        }
        const detail = stderrOf(err);
        // gh exits non-zero when a PR already exists; its message includes the URL.
        const existing = detail.match(PR_URL_RE);
        if (existing) return NextResponse.json({ ok: true, url: existing[0], branch, base: def, existed: true });
        return NextResponse.json({ ok: false, error: `gh pr create failed: ${detail}` }, { status: 502 });
      }
    } catch (err) {
      return NextResponse.json({ ok: false, error: stderrOf(err) }, { status: 500 });
    }
  }
  // Switch the checkout's branch — the chat composer's branch menu. `git
  // switch` carries clean local edits along and refuses (with a precise
  // stderr) when they'd be clobbered or the branch is checked out in another
  // worktree; that refusal is surfaced verbatim rather than forced with -f.
  if (action === "switch-branch") {
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    if (!isSafeBranchName(branch)) {
      return NextResponse.json({ ok: false, error: "invalid branch name" }, { status: 400 });
    }
    const isLocal = await refExists(root.repoRoot, `refs/heads/${branch}`);
    if (!isLocal && !(await refExists(root.repoRoot, `refs/remotes/origin/${branch}`))) {
      return NextResponse.json({ ok: false, error: "branch not found" }, { status: 404 });
    }
    try {
      await git(root.repoRoot, ["switch", branch]);
      return NextResponse.json({ ok: true, branch: await currentBranch(root.repoRoot) });
    } catch (err) {
      return NextResponse.json({ ok: false, error: stderrOf(err) }, { status: 409 });
    }
  }
  // Provision a `.worktrees/<branch>` checkout for a user-named branch (the
  // chat composer's "New worktree…" flow) — idempotent; new branches start
  // from origin/main when available. Naming + validation live in
  // @/lib/issue-worktree; the git work in @/lib/server/issue-worktree-provision.
  if (action === "create-worktree") {
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    if (!isSafeBranchName(branch)) {
      return NextResponse.json({ ok: false, error: "invalid branch name" }, { status: 400 });
    }
    const result = await provisionBranchWorktree(
      root.repoRoot,
      branch,
      typeof body.baseRef === "string" ? body.baseRef : null,
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      worktree: result.worktree,
      branch: result.branch,
      created: result.created,
      baseRef: result.baseRef,
    });
  }
  if (action === "restore-checkpoint" || action === "delete-checkpoint") {
    if (typeof body.checkpoint !== "string") {
      return NextResponse.json({ ok: false, error: "checkpoint name is required" }, { status: 400 });
    }
    const checkpoint = await resolveCheckpoint(root.repoRoot, body.checkpoint);
    if (!checkpoint) {
      if (
        action === "delete-checkpoint" &&
        isCheckpointName(body.checkpoint)
      ) {
        return NextResponse.json({ ok: true, deleted: body.checkpoint });
      }
      return NextResponse.json({ ok: false, error: "checkpoint not found" }, { status: 404 });
    }
    try {
      if (action === "delete-checkpoint") {
        const result = deleteAuthorizedCheckpoint(root, checkpoint);
        if (result === "unauthorized") {
          return NextResponse.json(
            { ok: false, error: "checkpoint not authorized for project" },
            { status: 403 },
          );
        }
        return NextResponse.json({ ok: true, deleted: body.checkpoint });
      }
      const metadata = readCheckpointMetadata(checkpoint);
      if (!checkpointAuthorizedForProject(root, metadata)) {
        return NextResponse.json(
          { ok: false, error: "checkpoint not authorized for project" },
          { status: 403 },
        );
      }
      if (metadata) {
        await restoreCheckpoint(root, checkpoint, metadata);
      } else {
        // Legacy/manual checkpoints can span the repository. A captured nested
        // project may restore only target-scoped checkpoints; broad snapshots
        // still require the enclosing repository to pass standard authorization.
        await restoreCheckpoint(root, checkpoint, null);
      }
      return NextResponse.json({ ok: true, restored: body.checkpoint });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
  const hasProjectPath = typeof body.path === "string";
  const hasRepoRelativePath = typeof body.repoRelativePath === "string";
  if (
    (!hasProjectPath && !hasRepoRelativePath) ||
    (hasProjectPath && hasRepoRelativePath) ||
    (body.path !== undefined && !hasProjectPath) ||
    (body.repoRelativePath !== undefined && !hasRepoRelativePath)
  ) {
    return NextResponse.json(
      { ok: false, error: "provide exactly one of path or repoRelativePath" },
      { status: 400 },
    );
  }
  const projectTarget = hasProjectPath
    ? resolveNativeProjectPathForGitRoot(
        root.projectRoot,
        root.repoRoot,
        body.path!,
      )
    : resolveNativeRepoRelativePathWithinProject(
        root.projectRoot,
        root.repoRoot,
        body.repoRelativePath!,
      );
  if (!projectTarget) return pathNotAllowed();
  const abs = resolveContainedFile(root.projectRoot, projectTarget.projectRelativePath);
  if (!abs) return pathNotAllowed();
  if (!(await isChangedFile(root.repoRoot, projectTarget.gitRelativePath, root.projectPathspec))) {
    return pathNotAllowed();
  }

  try {
    // Decide how to revert based on whether the file exists at HEAD. Reverting
    // means "match HEAD": files in HEAD are restored (covers staged edits and
    // deletions); files NOT in HEAD are new, so reverting deletes them and is
    // gated behind an explicit confirmation.
    const [inHead, tracked] = await Promise.all([
      existsInHead(root.repoRoot, projectTarget.gitRelativePath),
      isTracked(root.repoRoot, projectTarget.gitRelativePath),
    ]);
    const plan = planRevert({ inHead, tracked, confirmDelete: body.confirmUntracked === true });

    if (plan.action === "confirm-required") {
      return NextResponse.json(
        {
          ok: false,
          error: "new file — deleting it requires confirmUntracked",
          requiresConfirmUntracked: true,
        },
        { status: 400 },
      );
    }

    // Reverts are destructive (discard edits / delete files). Snapshot exactly
    // the target first so unrelated files cannot block its later restoration.
    let checkpointPath: string;
    try {
      checkpointPath = await checkpointChanges(root.repoRoot, {
        kind: "revert-target",
        projectRoot: root.projectRoot,
        targetProjectRelativePath: projectTarget.projectRelativePath,
        targetGitPath: projectTarget.gitRelativePath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: `could not create safety checkpoint, revert aborted: ${message}` },
        { status: 500 },
      );
    }

    switch (plan.action) {
      case "checkout":
        // `checkout HEAD --` updates index AND worktree, so staged edits and
        // staged/unstaged deletions all revert to the committed version —
        // matching the HEAD-relative diff the panel renders.
        await git(root.repoRoot, [
          "checkout",
          "HEAD",
          "--",
          literalGitPathspec(projectTarget.gitRelativePath),
        ]);
        return NextResponse.json({ ok: true, reverted: "checkout", path: projectTarget.gitRelativePath, checkpointPath });
      case "rm":
        // Staged new file: it never existed at HEAD, so reverting removes it
        // from both index and worktree.
        await git(root.repoRoot, ["rm", "-f", "--", literalGitPathspec(projectTarget.gitRelativePath)]);
        return NextResponse.json({ ok: true, reverted: "rm", path: projectTarget.gitRelativePath, checkpointPath });
      case "clean":
        await git(root.repoRoot, ["clean", "-f", "--", literalGitPathspec(projectTarget.gitRelativePath)]);
        return NextResponse.json({ ok: true, reverted: "clean", path: projectTarget.gitRelativePath, checkpointPath });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
