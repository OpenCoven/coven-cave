import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs, { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { daemonSessionRoots, resolveWithinSessionRoots } from "@/lib/server/session-project-roots";
import { isCheckpointName, parseNumstatZ, parsePorcelainZ, planRevert } from "@/lib/git-changes";
import { isSafeBranchName } from "@/lib/issue-worktree";
import { provisionBranchWorktree } from "@/lib/server/issue-worktree-provision";

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
 * POST { projectRoot, path, confirmUntracked? } → revert ONE file (auto-checkpoints first)
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
 * File paths from the client are repo-relative and must pass a
 * resolve + prefix containment check (absolute paths and `..` segments are
 * rejected). Reverting an untracked file deletes it, so that path is gated
 * behind an explicit confirmUntracked flag; the blast radius of POST is one
 * file per call.
 */

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const MAX_GIT_BUFFER = 64 * 1024 * 1024;
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

/** Run `git diff` without repository-configured command hooks. */
function gitDiff(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return git(cwd, ["diff", "--no-ext-diff", "--no-textconv", ...args]);
}

/** Run `git status` without repository-configured fsmonitor commands. */
function gitStatus(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return git(cwd, ["-c", "core.fsmonitor=false", "status", ...args]);
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
      checkedOut.set(line.slice("branch refs/heads/".length).trim(), path.basename(dir));
    }
  }
  const branches: BranchRow[] = [];
  for (const raw of refsOut.split("\n")) {
    const name = raw.trim();
    if (!name) continue;
    // Tool-internal refs (e.g. beads' __dolt_remote_info__) aren't human
    // switch targets — keep them out of the menu.
    if (/^__.*__$/.test(name)) continue;
    branches.push({
      name,
      current: name === current,
      worktree: checkedOut.get(name) ?? null,
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

type RootResolution =
  | { ok: true; repoRoot: string }
  | { ok: false; status: number; error: string; notARepo?: boolean };

/** Validate projectRoot: absolute, exists, is a directory, is a git work tree.
 *  Resolves to the repo toplevel so status paths line up with diff/revert. */
async function resolveRepoRoot(projectRoot: string): Promise<RootResolution> {
  if (!path.isAbsolute(projectRoot)) {
    return { ok: false, status: 400, error: "projectRoot must be an absolute path" };
  }
  // A path is allowed if it's under the static workspace allow-list OR under a
  // directory the daemon has an active session for (the daemon already spawned
  // a harness there, so it's user-sanctioned). The session-root list is fetched
  // once and reused for the post-`rev-parse` repo-toplevel re-check below.
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
    const top = stdout.trim();
    if (!top) return { ok: false, status: 422, error: "not a git repository", notARepo: true };
    const repoRoot = fs.realpathSync(top);
    if (!(await isAllowed(repoRoot))) {
      return { ok: false, status: 403, error: "path not allowed" };
    }
    return { ok: true, repoRoot };
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
  if (!relPath || relPath.includes("\0") || path.isAbsolute(relPath)) return null;
  if (relPath.split(/[\\/]+/).includes("..")) return null;
  const resolved = path.resolve(repoRoot, relPath);
  if (resolved === repoRoot) return null;
  if (!resolved.startsWith(repoRoot + path.sep)) return null;
  try {
    if (fs.existsSync(resolved)) {
      const real = fs.realpathSync(resolved);
      if (real === repoRoot) return null;
      if (!real.startsWith(repoRoot + path.sep)) return null;
    }
  } catch {
    return null;
  }
  return resolved;
}

function pathNotAllowed(): NextResponse {
  return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
}

// ── status parsing ────────────────────────────────────────────────────────────
// parsePorcelainZ / parseNumstatZ / statusOf live in @/lib/git-changes so the
// NUL/rename parsing can be unit-tested without next/server or a git process.

async function isTracked(repoRoot: string, relPath: string): Promise<boolean> {
  try {
    await git(repoRoot, ["ls-files", "--error-unmatch", "--", relPath]);
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

async function changedFilePaths(repoRoot: string): Promise<Set<string>> {
  const { stdout } = await gitStatus(repoRoot, ["--porcelain=v1", "-z", "--untracked-files=all"]);
  return new Set(parsePorcelainZ(stdout).map((file) => file.path));
}

async function isChangedFile(repoRoot: string, relPath: string): Promise<boolean> {
  return (await changedFilePaths(repoRoot)).has(relPath);
}

// ── GET: change list / single-file diff ───────────────────────────────────────

async function listChanges(repoRoot: string): Promise<NextResponse> {
  const { stdout } = await gitStatus(repoRoot, ["--porcelain=v1", "-z", "--untracked-files=all"]);
  const files = parsePorcelainZ(stdout);

  // Best-effort ins/del counts vs HEAD (covers staged + unstaged). Repos
  // without a first commit have no HEAD — skip counts rather than fail.
  try {
    const { stdout: numstat } = await gitDiff(repoRoot, ["--numstat", "-z", "HEAD", "--"]);
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
    branch = await currentBranch(repoRoot);
  } catch {
    /* no HEAD yet */
  }

  // Linked-worktree name rides along too (composer git chip) — null in the
  // primary checkout, the checkout dir's basename in a `git worktree`.
  const worktree = await worktreeName(repoRoot);

  return NextResponse.json({ ok: true, repo: true, repoRoot, branch, worktree, files });
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
    try {
      // Diff vs HEAD so staged edits show up too (status lists them).
      ({ stdout: diff } = await gitDiff(repoRoot, ["HEAD", "--", relPath]));
    } catch {
      // No HEAD yet (unborn branch) — fall back to worktree-vs-index.
      ({ stdout: diff } = await gitDiff(repoRoot, ["--", relPath]));
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
    if (wantCheckpoints !== null) {
      return NextResponse.json({ ok: true, checkpoints: await listCheckpoints(root.repoRoot) });
    }
    if (checkpointName !== null) {
      const abs = await resolveCheckpointPath(root.repoRoot, checkpointName);
      if (!abs) return NextResponse.json({ ok: false, error: "checkpoint not found" }, { status: 404 });
      let patch: string;
      try {
        patch = fs.readFileSync(/* turbopackIgnore: true */ abs, "utf8");
      } catch {
        return NextResponse.json({ ok: false, error: "checkpoint not found" }, { status: 404 });
      }
      const truncated = patch.length > DIFF_CAP_CHARS;
      return NextResponse.json({
        ok: true,
        patch: truncated ? patch.slice(0, DIFF_CAP_CHARS) : patch,
        truncated,
      });
    }
    if (wantPr !== null) return await branchPr(root.repoRoot);
    if (wantBranches !== null) return await listBranches(root.repoRoot);
    if (filePath === null) return await listChanges(root.repoRoot);
    const abs = resolveContainedFile(root.repoRoot, filePath);
    if (!abs) return pathNotAllowed();
    if (!(await isChangedFile(root.repoRoot, filePath))) return pathNotAllowed();
    return await diffFile(root.repoRoot, filePath, abs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Absolute path to this repo's checkpoint store (under .git so snapshots
 *  never themselves show up as worktree changes). */
async function checkpointDirOf(repoRoot: string): Promise<string> {
  const { stdout: gitDirOut } = await git(repoRoot, ["rev-parse", "--git-dir"]);
  const gitDirRaw = gitDirOut.trim();
  const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(/* turbopackIgnore: true */ repoRoot, gitDirRaw);
  return path.join(/* turbopackIgnore: true */ gitDir, "coven-cave", "checkpoints");
}

/** Validate a checkpoint name and resolve it inside the checkpoint dir.
 *  Returns null on a bad name or a path that escapes the dir. */
async function resolveCheckpointPath(repoRoot: string, name: string): Promise<string | null> {
  if (!isCheckpointName(name)) return null;
  // path.basename strips any directory component — a recognized path-injection
  // barrier and redundant with isCheckpointName (which already forbids slashes).
  const base = path.basename(name);
  if (base !== name) return null;
  const dir = await checkpointDirOf(repoRoot);
  const abs = path.join(/* turbopackIgnore: true */ dir, base);
  // Belt-and-braces: verify the join stayed inside the checkpoint dir.
  if (!abs.startsWith(dir + path.sep)) return null;
  return abs;
}

async function checkpointChanges(repoRoot: string): Promise<string> {
  // Store snapshots under .git/coven-cave/checkpoints so the checkpoint never
  // creates new worktree changes.
  let patch = "";
  try {
    ({ stdout: patch } = await gitDiff(repoRoot, ["--binary", "HEAD", "--"]));
  } catch {
    ({ stdout: patch } = await gitDiff(repoRoot, ["--binary", "--"]));
  }

  const { stdout: statusOut } = await git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  for (const file of parsePorcelainZ(statusOut)) {
    if (file.status === "untracked") {
      const abs = resolveContainedFile(repoRoot, file.path);
      if (!abs || !fs.existsSync(/* turbopackIgnore: true */ abs)) continue;
      try {
        // Pass the REPO-RELATIVE path (cwd is repoRoot) so the synthesized
        // add-file diff carries `b/<relpath>` headers that `git apply` can
        // place back — absolute paths here would make the checkpoint
        // un-restorable for untracked files.
        const { stdout } = await gitDiff(repoRoot, ["--no-index", "--", DEV_NULL, file.path]);
        patch += stdout;
      } catch (err) {
        const e = err as { code?: number; stdout?: string };
        if (e.code === 1 && typeof e.stdout === "string") patch += e.stdout;
        else throw err;
      }
    }
  }

  const checkpointDir = await checkpointDirOf(repoRoot);
  fs.mkdirSync(/* turbopackIgnore: true */ checkpointDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const checkpointPath = path.join(/* turbopackIgnore: true */ checkpointDir, `${stamp}.patch`);
  writeFileSync(checkpointPath, patch, { mode: 0o600 });
  return checkpointPath;
}

type CheckpointMeta = { name: string; savedAt: string; bytes: number };

/** List saved checkpoints, newest first. The stamp name sorts chronologically. */
async function listCheckpoints(repoRoot: string): Promise<CheckpointMeta[]> {
  const dir = await checkpointDirOf(repoRoot);
  let names: string[];
  try {
    names = fs.readdirSync(/* turbopackIgnore: true */ dir);
  } catch {
    return []; // no checkpoints taken yet
  }
  const metas: CheckpointMeta[] = [];
  for (const name of names) {
    if (!isCheckpointName(name)) continue;
    try {
      const st = fs.statSync(/* turbopackIgnore: true */ path.join(dir, name));
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
async function restoreCheckpoint(repoRoot: string, abs: string): Promise<void> {
  const patch = fs.readFileSync(/* turbopackIgnore: true */ abs, "utf8");
  if (!patch.trim()) return; // empty snapshot — nothing to apply
  await git(repoRoot, ["apply", "--3way", "--whitespace=nowarn", abs]);
}

// ── POST: revert one file / checkpoint changes ───────────────────────────────

export async function POST(req: NextRequest) {
  let body: {
    projectRoot?: string;
    path?: string;
    confirmUntracked?: boolean;
    action?: "revert" | "checkpoint" | "restore-checkpoint" | "delete-checkpoint" | "commit" | "create-pr" | "switch-branch" | "create-worktree";
    checkpoint?: string;
    message?: string;
    title?: string;
    prBody?: string;
    branch?: string;
    baseRef?: string;
  };
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
  const action = body.action ?? "revert";

  const root = await resolveRepoRoot(body.projectRoot);
  if (!root.ok) {
    return NextResponse.json({ ok: false, error: root.error }, { status: root.status });
  }
  if (action === "checkpoint") {
    try {
      const checkpointPath = await checkpointChanges(root.repoRoot);
      return NextResponse.json({ ok: true, checkpointPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
  // Stage all working-tree changes and commit them. To keep the default branch
  // clean (and set up the PR flow), a commit made while on the default branch
  // (or a detached HEAD) first spins up a fresh `cave/<slug>` feature branch.
  // The commit is signed (-S) to match the repo norm; a signing failure is
  // surfaced rather than silently dropped.
  if (action === "commit") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ ok: false, error: "commit message is required" }, { status: 400 });
    }
    try {
      const { stdout: statusOut } = await git(root.repoRoot, ["status", "--porcelain"]);
      if (!statusOut.trim()) {
        return NextResponse.json({ ok: false, error: "nothing to commit — the working tree is clean" }, { status: 400 });
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
      await git(root.repoRoot, ["add", "-A"]);
      try {
        await gitLong(root.repoRoot, ["commit", "-S", "-m", message]);
      } catch (err) {
        // Roll back the just-created branch so a failed commit doesn't strand it.
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
    const abs = await resolveCheckpointPath(root.repoRoot, body.checkpoint);
    if (!abs || !fs.existsSync(/* turbopackIgnore: true */ abs)) {
      return NextResponse.json({ ok: false, error: "checkpoint not found" }, { status: 404 });
    }
    try {
      if (action === "delete-checkpoint") {
        fs.unlinkSync(/* turbopackIgnore: true */ abs);
        return NextResponse.json({ ok: true, deleted: body.checkpoint });
      }
      await restoreCheckpoint(root.repoRoot, abs);
      return NextResponse.json({ ok: true, restored: body.checkpoint });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
  if (typeof body.path !== "string") {
    return NextResponse.json(
      { ok: false, error: "projectRoot and path are required" },
      { status: 400 },
    );
  }
  const abs = resolveContainedFile(root.repoRoot, body.path);
  if (!abs) return pathNotAllowed();
  if (!(await isChangedFile(root.repoRoot, body.path))) return pathNotAllowed();

  try {
    // Decide how to revert based on whether the file exists at HEAD. Reverting
    // means "match HEAD": files in HEAD are restored (covers staged edits and
    // deletions); files NOT in HEAD are new, so reverting deletes them and is
    // gated behind an explicit confirmation.
    const [inHead, tracked] = await Promise.all([
      existsInHead(root.repoRoot, body.path),
      isTracked(root.repoRoot, body.path),
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

    // Reverts are destructive (discard edits / delete files). Snapshot the whole
    // working tree first so the action is recoverable; if the safety snapshot
    // fails, abort rather than destroy without a backup.
    let checkpointPath: string;
    try {
      checkpointPath = await checkpointChanges(root.repoRoot);
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
        await git(root.repoRoot, ["checkout", "HEAD", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "checkout", path: body.path, checkpointPath });
      case "rm":
        // Staged new file: it never existed at HEAD, so reverting removes it
        // from both index and worktree.
        await git(root.repoRoot, ["rm", "-f", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "rm", path: body.path, checkpointPath });
      case "clean":
        await git(root.repoRoot, ["clean", "-f", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "clean", path: body.path, checkpointPath });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
