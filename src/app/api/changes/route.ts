import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import { stampChangedFiles } from "@/lib/server/change-file-versions";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { daemonSessionRoots, resolveWithinSessionRoots } from "@/lib/server/session-project-roots";
import { isCheckpointName, parseNumstatZ, parsePorcelainZ, planRevert, type ChangedFile } from "@/lib/git-changes";
import { isSafeBranchName } from "@/lib/issue-worktree";
import { normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import { branchPrCache } from "@/lib/branch-pr-context";
import {
  canvasCommitRequiresDefaultBranch,
  exactBranchPushRef,
  remoteBranchMatchesExpectedHead,
} from "@/lib/canvas-git-delivery";
import { provisionBranchWorktree } from "@/lib/server/issue-worktree-provision";
import { withRepositoryMutation } from "@/lib/server/keyed-transaction-lock";
import {
  CHECKPOINT_MAX_UNTRACKED_BYTES,
  PATCH_DIFF_ARGS,
  restoreCheckpointPatch,
  writeCheckpointPatch,
  type CheckpointRestoreOutcome,
} from "@/lib/server/checkpoint-restore";
import { gitOperationInProgress, operationInProgressMessage } from "@/lib/server/git-operation-in-progress";
import { captureCommitStart, createPrivateIndex, deskCommitLanded, rollbackCommitStart } from "@/lib/server/commit-rollback";
import { prCreateArgs, resolvePrTarget } from "@/lib/github-pr-target";

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
 * POST { projectRoot, action: "restore-checkpoint", checkpoint } → bring back what the
 *        snapshot holds, file by file, keeping anything changed since (#5756)
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

/** Run git via execFile (argument array, no shell interpolation). `env`
 *  adds to the server's own, for a commit's private index (#5795). */
function git(cwd: string, args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    windowsHide: true,
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

/** Run git with `input` on stdin. Paths go through `--pathspec-from-file=-`
 *  this way, so a long list can't overrun the OS argument limit (#5756).
 *  Still execFile with an argument array: the promise carries its child. */
function gitWithInput(cwd: string, args: string[], input: string, env?: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  const pending = execFileAsync("git", args, {
    windowsHide: true,
    cwd,
    timeout: GIT_TIMEOUT_MS * 3,
    maxBuffer: MAX_GIT_BUFFER,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  pending.child.stdin?.end(input);
  return pending;
}

/** Run `git diff` without repository-configured command hooks, and in the
 *  standard patch shape whatever the user's colour and prefix config (#5781).
 *  Paths are literal (#5756): `app/[id]/page.tsx` is that file, not a glob
 *  that also matches `app/i/page.tsx`. */
function gitDiff(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return git(cwd, ["--literal-pathspecs", "diff", ...PATCH_DIFF_ARGS, ...args]);
}

/** Run `git status` without repository-configured fsmonitor commands. */
function gitStatus(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return git(cwd, ["-c", "core.fsmonitor=false", "status", ...args]);
}

/** Network git (push), `gh` and a commit's hooks can take longer than the
 *  read-only 10s budget. Tests shorten it (`COVEN_CAVE_GIT_LONG_TIMEOUT_MS`)
 *  to drive a hook past it. */
const NET_TIMEOUT_MS = Number(process.env.COVEN_CAVE_GIT_LONG_TIMEOUT_MS) || 60_000;
function gitLong(cwd: string, args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    windowsHide: true,
    cwd,
    timeout: NET_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}
/** Run the GitHub CLI (argument array, no shell) for PR creation. */
function ghCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("gh", args, { windowsHide: true, cwd, timeout: NET_TIMEOUT_MS, maxBuffer: MAX_GIT_BUFFER });
}

const PR_URL_RE = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/;

/** Current branch name, or "HEAD" when detached. Before the first commit
 *  (#5781), `rev-parse` can't name HEAD, so the symbolic ref does. */
async function currentBranch(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  } catch (err) {
    const { stdout } = await git(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => {
      throw err;
    });
    return stdout.trim();
  }
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
const REMOTE_HEAD_TTL_MS = 5 * 60_000;
const REMOTE_HEAD_FAILED_TTL_MS = 30_000;
const remoteHeadCache = new Map<string, { branch: string | null; at: number }>();

/** The remote's own default branch (#5795). `origin/HEAD` is written once, at
 *  clone: it goes stale when the default is renamed, and a repository made
 *  with `git init` and pushed has none, so the desk committed on the real
 *  default and Create PR pushed to it. Null with no `origin`, or when it
 *  can't be asked without a prompt. */
async function remoteHeadBranch(repoRoot: string): Promise<string | null> {
  const url = await git(repoRoot, ["remote", "get-url", "origin"]).then(({ stdout }) => stdout.trim(), () => "");
  if (!url) return null;
  const key = `${repoRoot}\0${url}`;
  const hit = remoteHeadCache.get(key);
  if (hit && Date.now() - hit.at < (hit.branch ? REMOTE_HEAD_TTL_MS : REMOTE_HEAD_FAILED_TTL_MS)) return hit.branch;
  const branch = await execFileAsync("git", ["ls-remote", "--symref", "origin", "HEAD"], {
    windowsHide: true,
    cwd: repoRoot,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).then(({ stdout }) => /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(stdout)?.[1] ?? null, () => null);
  remoteHeadCache.set(key, { branch, at: Date.now() });
  return branch;
}

async function defaultBranch(repoRoot: string): Promise<string> {
  const remote = await remoteHeadBranch(repoRoot);
  if (remote) return remote;
  try {
    const { stdout } = await git(repoRoot, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    const m = stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    // Only while what it names still exists (#5795).
    if (m && (await refExists(repoRoot, `refs/remotes/origin/${m[1]}`))) return m[1];
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
    // Tool-internal refs (e.g. the leftover Dolt __dolt_remote_info__) aren't human
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

type RootResolution =
  | { ok: true; repoRoot: string }
  | { ok: false; status: number; error: string; notARepo?: boolean; missingRoot?: boolean };

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
    return { ok: false, status: 404, error: "projectRoot does not exist", missingRoot: true };
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
 *  `..` traversal, and anything that resolves outside repoRoot.
 *
 *  The folders on the way are followed through links; the file itself is not
 *  (#5781). A tracked symlink that points outside the repository is still a
 *  file inside it, which git diffs, reverts and restores as a link, never
 *  through it. Following it made its diff and Revert a 403, and any checkpoint
 *  holding it impossible to restore. A path under a linked folder that leads
 *  outside is still refused. */
function resolveContainedFile(repoRoot: string, relPath: string): string | null {
  const resolved = lexicallyContained(repoRoot, relPath);
  if (!resolved) return null;
  try {
    let parent = path.dirname(resolved);
    while (parent !== repoRoot && !fs.existsSync(parent)) parent = path.dirname(parent);
    return withinRepo(repoRoot, fs.realpathSync(parent)) ? resolved : null;
  } catch {
    return null;
  }
}

/** The path inside repoRoot by its spelling alone, or null. */
function lexicallyContained(repoRoot: string, relPath: string): string | null {
  if (!relPath || relPath.includes("\0") || path.isAbsolute(relPath)) return null;
  if (relPath.split(/[\\/]+/).includes("..")) return null;
  const resolved = path.resolve(repoRoot, relPath);
  return resolved !== repoRoot && resolved.startsWith(repoRoot + path.sep) ? resolved : null;
}

function withinRepo(repoRoot: string, real: string): boolean {
  return real === repoRoot || real.startsWith(repoRoot + path.sep);
}

/** Async containment for the polling loop; filesystem checks share its bound.
 *  The same rule: folders followed, the file itself not (#5781). */
async function resolveContainedFileMetadata(repoRoot: string, relPath: string): Promise<string | null> {
  const resolved = lexicallyContained(repoRoot, relPath);
  if (!resolved) return null;
  let parent = path.dirname(resolved);
  for (;;) {
    try {
      return withinRepo(repoRoot, await fs.promises.realpath(parent)) ? resolved : null;
    } catch (error) {
      // Missing paths still receive the helper's stable "missing" stamp.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === repoRoot) throw error;
      parent = path.dirname(parent);
    }
  }
}

function pathNotAllowed(): NextResponse {
  return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
}

// ── status parsing ────────────────────────────────────────────────────────────
// parsePorcelainZ / parseNumstatZ / statusOf live in @/lib/git-changes so the
// NUL/rename parsing can be unit-tested without next/server or a git process.

async function isTracked(repoRoot: string, relPath: string): Promise<boolean> {
  try {
    await git(repoRoot, ["--literal-pathspecs", "ls-files", "--error-unmatch", "--", relPath]);
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

/** The file's entry in the change list, or null when it isn't changed. A
 *  revert reads its status from here (#5781): a rename reverts as a whole,
 *  and a conflict is refused. */
async function changedEntry(repoRoot: string, relPath: string): Promise<ChangedFile | null> {
  const { stdout } = await gitStatus(repoRoot, ["--porcelain=v1", "-z", "--untracked-files=all"]);
  // Either Unicode form names the file (#5781): the tree reads names as the
  // disk stores them (NFD on macOS), while git reports them precomposed.
  const wanted = relPath.normalize("NFC");
  return parsePorcelainZ(stdout).find((file) => file.path.normalize("NFC") === wanted) ?? null;
}

// ── GET: change list / single-file diff ───────────────────────────────────────

/** The working tree as the status list sees it, with `path\0changeVersion`
 *  keys from the same stamps. A commit can name the list it was reviewed
 *  against and be refused when the tree has moved since (#5745). */
async function changeSnapshot(repoRoot: string): Promise<{ files: ChangedFile[]; keys: string[] }> {
  const { stdout } = await gitStatus(repoRoot, ["--porcelain=v1", "-z", "--untracked-files=all"]);
  const files = parsePorcelainZ(stdout);
  await stampChangedFiles(files, (filePath) => resolveContainedFileMetadata(repoRoot, filePath));
  return { files, keys: files.map((file) => `${file.path}\0${file.changeVersion ?? ""}`).sort() };
}

function sameChangeKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** Parse a commit's `expectedChanges` into sorted keys, or null when absent. */
/** How many files one desk commit may name; the list rides in the request. */
const MAX_EXPECTED_CHANGES = 5000;

function expectedChangeKeys(raw: unknown): string[] | null | "invalid" | "too-many" {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return "invalid";
  // Its own answer (#5756): "must list entries" said nothing about the cause.
  if (raw.length > MAX_EXPECTED_CHANGES) return "too-many";
  const keys: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return "invalid";
    const { path: filePath, changeVersion } = entry as { path?: unknown; changeVersion?: unknown };
    if (typeof filePath !== "string" || !filePath || typeof changeVersion !== "string") return "invalid";
    keys.push(`${filePath}\0${changeVersion}`);
  }
  return keys.sort();
}

async function listChanges(repoRoot: string): Promise<NextResponse> {
  const { stdout } = await gitStatus(repoRoot, ["--porcelain=v1", "-z", "--untracked-files=all"]);
  const files = parsePorcelainZ(stdout);
  // A rewrite can keep the same path/status/diffstat. Cheap filesystem stamps
  // let the collapsed Code tab notice it without fetching full diffs on polls.
  await stampChangedFiles(files, (filePath) => resolveContainedFileMetadata(repoRoot, filePath));

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

/** PR context for the current branch (composer git chip): the pull request
 *  heading this branch — null when there is no PR, no branch (detached/unborn
 *  HEAD), or `gh` is unavailable/unauthenticated. Read-only and network-bound,
 *  so it's a separate `?pr=1` query rather than part of the 5s status poll.
 *
 *  Answered through the chat list's branch→PR cache (#5619): the chip
 *  remounts on every chat open, and running `gh pr view` each time cost
 *  ~0.5 s per open and spent the shared GraphQL quota. The cache uses REST
 *  and is shared with the sessions list, so an open usually costs nothing. */
async function branchPr(repoRoot: string): Promise<NextResponse> {
  let branch: string | null = null;
  try {
    branch = await currentBranch(repoRoot);
  } catch {
    /* no HEAD yet */
  }
  if (!branch || branch === "HEAD") return NextResponse.json({ ok: true, branch, pr: null });
  const pr = await branchPrCache.resolve(repoRoot, branch).catch(() => null);
  if (pr?.url && PR_URL_RE.test(pr.url)) {
    return NextResponse.json({
      ok: true,
      branch,
      pr: {
        number: pr.number,
        url: pr.url,
        // The chip's shape predates the cache: GraphQL's uppercase state.
        state: (pr.state ?? "open").toUpperCase(),
        isDraft: pr.draft === true,
      },
    });
  }
  return NextResponse.json({ ok: true, branch, pr: null });
}

async function diffFile(repoRoot: string, entry: ChangedFile): Promise<NextResponse> {
  const relPath = entry.path;
  let diff = "";
  if (entry.status !== "untracked") {
    // Against HEAD so staged edits show up too, or before the first commit
    // the empty tree (#5781): the index alone left a staged file's start out.
    const base = await git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
      .then(({ stdout }) => stdout.trim())
      .catch(async () => (await gitWithInput(repoRoot, ["hash-object", "-t", "tree", "--stdin"], "")).stdout.trim());
    // A rename names both its paths, so it reads as a rename with its edit,
    // not a whole new file (#5781).
    const paths = entry.renamedFrom && !entry.copied ? [entry.renamedFrom, relPath] : [relPath];
    // Against the worktree, which is what the desk commits: a `git rm`'d
    // file shows its deletion, where the old tracked check sent it down the
    // untracked path and read it as empty (#5781).
    ({ stdout: diff } = await gitDiff(repoRoot, ["-M", base, "--", ...paths]));
  } else {
    // Untracked: synthesize an all-additions diff, by its repo-relative path
    // (cwd is the repo), so the headers don't carry the absolute one (#5781).
    // --no-index exits 1 when the files differ, which execFile reports as an
    // error — recover stdout.
    try {
      ({ stdout: diff } = await gitDiff(repoRoot, ["--no-index", "--", DEV_NULL, relPath]));
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
    // Said outright (#5781): a session whose folder is gone gets one notice,
    // not a retry in each of the tree, the rail and the header.
    return NextResponse.json(
      { ok: false, error: root.error, ...(root.missingRoot ? { missingRoot: true } : {}) },
      { status: root.status },
    );
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
    if (wantRemote !== null) return await originRemoteUrl(root.repoRoot);
    if (wantBranches !== null) return await listBranches(root.repoRoot);
    if (filePath === null) return await listChanges(root.repoRoot);
    const abs = resolveContainedFile(root.repoRoot, filePath);
    if (!abs) return pathNotAllowed();
    const entry = await changedEntry(root.repoRoot, filePath);
    if (!entry) return pathNotAllowed();
    return await diffFile(root.repoRoot, entry);
  } catch (err) {
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

/** The newest checkpoints kept (#5781): every revert writes one, a patch of
 *  the whole working tree, and none was ever removed. */
const CHECKPOINTS_KEPT = 50;

async function checkpointChanges(repoRoot: string): Promise<{ path: string; skipped: string[] }> {
  // Store snapshots under .git/coven-cave/checkpoints so the checkpoint never
  // creates new worktree changes.
  const checkpointDir = await checkpointDirOf(repoRoot);
  fs.mkdirSync(/* turbopackIgnore: true */ checkpointDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const checkpointPath = path.join(/* turbopackIgnore: true */ checkpointDir, `${stamp}.patch`);
  try {
    const { skipped } = await writeCheckpointPatch(repoRoot, (relPath) => resolveContainedFile(repoRoot, relPath), checkpointPath);
    pruneCheckpoints(checkpointDir);
    return { path: checkpointPath, skipped };
  } catch (err) {
    fs.rmSync(/* turbopackIgnore: true */ checkpointPath, { force: true }); // never a half-written undo
    throw err;
  }
}

/** Drop all but the newest checkpoints. Names are stamps, so they sort by age. */
function pruneCheckpoints(dir: string): void {
  const names = fs.readdirSync(/* turbopackIgnore: true */ dir).filter(isCheckpointName).sort();
  for (const name of names.slice(0, Math.max(0, names.length - CHECKPOINTS_KEPT))) {
    fs.rmSync(/* turbopackIgnore: true */ path.join(dir, name), { force: true });
  }
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

/** Bring back what a checkpoint holds, file by file (#5756). Files changed
 *  since it was taken are kept, and the state before restoring is itself
 *  saved as a checkpoint first, so the restore can be undone too. */
async function restoreCheckpoint(repoRoot: string, abs: string): Promise<CheckpointRestoreOutcome> {
  return restoreCheckpointPatch(repoRoot, abs, {
    contain: (relPath) => resolveContainedFile(repoRoot, relPath),
    beforeWrite: async () => (await checkpointChanges(repoRoot)).path,
  });
}

// ── POST: revert one file / checkpoint changes ───────────────────────────────

export async function POST(req: NextRequest) {
  let body: {
    projectRoot?: string;
    path?: string;
    confirmUntracked?: boolean;
    /** The reverted row's version, as the user reviewed it (#5795). */
    expectedChangeVersion?: string;
    action?: "revert" | "checkpoint" | "restore-checkpoint" | "delete-checkpoint" | "commit" | "create-pr" | "switch-branch" | "create-worktree";
    checkpoint?: string;
    message?: string;
    title?: string;
    prBody?: string;
    paths?: unknown;
    expectedChanges?: unknown;
    expectedBranch?: string;
    expectedHead?: string;
    requireDefaultBranch?: boolean;
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
      const { path: checkpointPath, skipped } = await checkpointChanges(root.repoRoot);
      return NextResponse.json({ ok: true, checkpointPath, skipped });
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
    let targetedPaths: string[] | null = null;
    if (body.paths !== undefined) {
      if (
        !Array.isArray(body.paths)
        || body.paths.length === 0
        || body.paths.length > 20
        || body.paths.some((entry) => typeof entry !== "string")
      ) {
        return NextResponse.json({ ok: false, error: "paths must be a non-empty list of file paths" }, { status: 400 });
      }
      targetedPaths = [...new Set(body.paths.map((entry) => entry.trim().replaceAll("\\", "/")))];
      if (
        targetedPaths.some((entry) => !entry || !resolveContainedFile(root.repoRoot, entry))
      ) {
        return NextResponse.json({ ok: false, error: "invalid commit path" }, { status: 400 });
      }
    }
    const expectedChanges = expectedChangeKeys(body.expectedChanges);
    if (expectedChanges === "too-many") {
      const count = Array.isArray(body.expectedChanges) ? body.expectedChanges.length : 0;
      return NextResponse.json(
        {
          ok: false,
          error: `this commit covers ${count} changed files; the desk commits at most ${MAX_EXPECTED_CHANGES} at once. Commit from a terminal, or in smaller parts`,
        },
        { status: 413 },
      );
    }
    if (expectedChanges === "invalid") {
      return NextResponse.json({ ok: false, error: "expectedChanges must list {path, changeVersion} entries" }, { status: 400 });
    }
    return withRepositoryMutation(root.repoRoot, async () => {
      try {
        // Never mid-rebase, merge, cherry-pick, revert or am (#5781): the
        // commit landed inside the paused operation.
        const paused = await gitOperationInProgress(root.repoRoot);
        if (paused) {
          return NextResponse.json({ ok: false, error: operationInProgressMessage(paused, "commit") }, { status: 409 });
        }
        // Commit only what was reviewed (#5745): refuse when the working tree
        // no longer matches the list the caller showed. The repository lock is
        // process-local, so an agent can still write between this check and
        // staging; `verified` closes that window below.
        const staleCommit = () =>
          NextResponse.json(
            {
              ok: false,
              stale: true,
              error: "the working tree changed since you reviewed it; review the new changes, then commit",
            },
            { status: 409 },
          );
        let verified: { files: ChangedFile[]; indexTree: string } | null = null;
        if (expectedChanges && !targetedPaths) {
          const snapshot = await changeSnapshot(root.repoRoot);
          if (!sameChangeKeys(snapshot.keys, expectedChanges)) return staleCommit();
          // The index as it stands, to restore if the staged snapshot moves.
          const { stdout: indexTree } = await git(root.repoRoot, ["write-tree"]);
          verified = { files: snapshot.files, indexTree: indexTree.trim() };
        } else if (expectedChanges) {
          const snapshot = await changeSnapshot(root.repoRoot);
          if (!sameChangeKeys(snapshot.keys, expectedChanges)) return staleCommit();
        }
        const pathArgs = targetedPaths ? ["--", ...targetedPaths] : [];
      // Untracked files count whatever `status.showUntrackedFiles` says
      // (#5781): with it set to "no", a list of new files read as clean.
      const { stdout: statusOut } = await git(
        root.repoRoot,
        targetedPaths
          ? ["--literal-pathspecs", "-c", "core.fsmonitor=false", "status", "--porcelain", "--untracked-files=all", ...pathArgs]
          : ["-c", "core.fsmonitor=false", "status", "--porcelain", "--untracked-files=all"],
      );
      if (!statusOut.trim()) {
        return NextResponse.json({ ok: false, error: "nothing to commit — the working tree is clean" }, { status: 400 });
      }
      const cur = await currentBranch(root.repoRoot);
      const def = await defaultBranch(root.repoRoot);
      if (canvasCommitRequiresDefaultBranch(cur, def, body.requireDefaultBranch === true)) {
        return NextResponse.json(
          { ok: false, error: `Canvas commits must start from ${def}; switch to ${def} and try again` },
          { status: 409 },
        );
      }
      // Where things stood, so a refused or failed commit leaves no trace
      // (#5756): it used to leave the files staged, and strand a new branch,
      // checked out when HEAD had been detached.
      // A reviewed commit is built in a private index (#5795): the real one
      // is never staged, so another process's `git add` while the commit's
      // hooks run can't join it, and a rollback has no index to put back.
      const privateIndex = verified ? await createPrivateIndex(root.repoRoot) : null;
      try {
      const start = privateIndex
        ? { ...(await captureCommitStart(root.repoRoot, cur, verified?.indexTree)), index: null }
        : await captureCommitStart(root.repoRoot, cur, verified?.indexTree);
      let branch = cur;
      let branchCreated = false;
      const rollback = () => rollbackCommitStart(root.repoRoot, start, branchCreated ? branch : null);
      // Every step before the commit rolls back on failure too (#5775
      // review): a failed `git add` used to strand the new branch and any
      // partial staging. Nothing after a commit that landed is undone.
      try {
        // The first commit stays on its branch (#5781): there is no history
        // to keep clean, and a feature branch would have no base for a PR.
        if ((cur === def || cur === "HEAD") && start.oid) {
          branch = featureBranchName(message, Date.now());
          await git(root.repoRoot, ["checkout", "-b", branch]);
          branchCreated = true;
        }
        if (targetedPaths) {
          await git(root.repoRoot, ["--literal-pathspecs", "add", "--", ...targetedPaths]);
        } else if (verified) {
          // Stage exactly the verified files (and a rename's old path), so a
          // file created after the check is never swept in. On stdin: a few
          // thousand deep paths overran the argument limit (#5756).
          const paths = verified.files.flatMap((file) => (file.renamedFrom ? [file.path, file.renamedFrom] : [file.path]));
          // An empty list would read as no pathspec, and `add -A` would
          // stage everything (#5781).
          if (paths.length === 0) {
            await rollback();
            return NextResponse.json({ ok: false, error: "nothing to commit — the working tree is clean" }, { status: 400 });
          }
          await gitWithInput(
            root.repoRoot,
            ["--literal-pathspecs", "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
            paths.join("\0"),
            privateIndex?.env,
          );
        } else {
          await git(root.repoRoot, ["add", "-A"]);
        }
        if (verified) {
          // Re-stamp what was just staged. Stamps are file metadata, which
          // staging leaves alone, so any difference is a write that may have
          // reached the index. Then the index goes back as it was and the
          // commit is refused rather than committing content nobody saw.
          const restamped: ChangedFile[] = verified.files.map((file) => ({ path: file.path, status: file.status }));
          await stampChangedFiles(restamped, (filePath) => resolveContainedFileMetadata(root.repoRoot, filePath));
          if (restamped.some((file, index) => file.changeVersion !== verified.files[index].changeVersion)) {
            await rollback();
            return staleCommit();
          }
        }
      } catch (err) {
        await rollback();
        throw err;
      }
      let warning: string | undefined;
      try {
        await gitLong(
          root.repoRoot,
          targetedPaths
            ? ["--literal-pathspecs", "commit", "-S", "--only", "-m", message, "--", ...targetedPaths]
            : ["commit", "-S", "-m", message],
          privateIndex?.env,
        );
      } catch (err) {
        const timedOut = (err as { killed?: boolean }).killed === true;
        // A commit that landed is a commit (#5781), but only the desk's own
        // (#5795): an agent's commit in the session's terminal moves HEAD
        // too, and was reported as the desk's.
        const landed = await deskCommitLanded(root.repoRoot, start, { indexEnv: privateIndex?.env, message });
        if (landed) {
          warning = timedOut
            ? `the commit landed, but a hook after it was still running after ${NET_TIMEOUT_MS / 1000} seconds`
            : `the commit landed, but git reported: ${stderrOf(err)}`;
        } else {
          // Nothing staged, no new branch, HEAD where it was, unless another
          // process committed meanwhile, which is said and left alone.
          await rollback();
          const head = await git(root.repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
            .then(({ stdout }) => stdout.trim(), () => null);
          const foreign = head !== start.oid
            ? `; another commit landed on ${branch} while the desk was committing, and it isn't the desk's`
            : "";
          if (timedOut) {
            return NextResponse.json(
              { ok: false, error: `the commit didn't finish within ${NET_TIMEOUT_MS / 1000} seconds, so nothing was committed; a commit hook may be slow${foreign}` },
              { status: 504 },
            );
          }
          const detail = stderrOf(err);
          const signing = /gpg|signing|ssh|secret key|sign/i.test(detail);
          return NextResponse.json(
            { ok: false, error: `${signing ? `commit signing failed: ${detail}` : `commit failed: ${detail}`}${foreign}` },
            { status: 500 },
          );
        }
      }
      if (privateIndex && verified) {
        // The real index learns what was committed, for those paths only:
        // anything else another process staged meanwhile stays staged.
        const paths = verified.files.flatMap((file) => (file.renamedFrom ? [file.path, file.renamedFrom] : [file.path]));
        await gitWithInput(
          root.repoRoot,
          ["--literal-pathspecs", "reset", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"],
          paths.join("\0"),
        ).catch(() => {});
      }
      const { stdout: sha } = await git(root.repoRoot, ["rev-parse", "--short", "HEAD"]);
      const { stdout: headOid } = await git(root.repoRoot, ["rev-parse", "HEAD"]);
      return NextResponse.json({
        ok: true,
        sha: sha.trim(),
        headOid: headOid.trim(),
        branch,
        branchCreated,
        onDefaultBranch: branch === def,
        defaultBranch: def,
        ...(warning ? { warning } : {}),
      });
      } finally {
        privateIndex?.dispose();
      }
      } catch (err) {
        return NextResponse.json({ ok: false, error: stderrOf(err) }, { status: 500 });
      }
    });
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
    const expectedBranch = typeof body.expectedBranch === "string" ? body.expectedBranch.trim() : "";
    const expectedHead = typeof body.expectedHead === "string" ? body.expectedHead.trim() : "";
    if (expectedBranch && !isSafeBranchName(expectedBranch)) {
      return NextResponse.json({ ok: false, error: "invalid expected branch" }, { status: 400 });
    }
    if (expectedHead && !/^[0-9a-f]{40}$/i.test(expectedHead)) {
      return NextResponse.json({ ok: false, error: "invalid expected head" }, { status: 400 });
    }
    return withRepositoryMutation(root.repoRoot, async () => {
      try {
        // A paused operation's branch is half-rewritten (#5781): don't push it.
        const paused = await gitOperationInProgress(root.repoRoot);
        if (paused) {
          return NextResponse.json({ ok: false, error: operationInProgressMessage(paused, "open a pull request") }, { status: 409 });
        }
        const branch = await currentBranch(root.repoRoot);
      const def = await defaultBranch(root.repoRoot);
      if (branch === def || branch === "HEAD") {
        return NextResponse.json(
          { ok: false, error: `you're on ${branch} — commit to a feature branch first, then open a PR` },
          { status: 400 },
        );
      }
      if (expectedBranch && branch !== expectedBranch) {
        return NextResponse.json(
          { ok: false, stale: true, error: `the project moved to ${branch}; switch back to ${expectedBranch} before opening the PR` },
          { status: 409 },
        );
      }
      if (expectedHead) {
        const { stdout } = await git(root.repoRoot, ["rev-parse", "HEAD"]);
        if (stdout.trim() !== expectedHead) {
          return NextResponse.json(
            { ok: false, stale: true, error: "the branch changed after the commit; review the new commit before opening the PR" },
            { status: 409 },
          );
        }
      }
      try {
        const pushSource = expectedHead || branch;
        await gitLong(root.repoRoot, [
          "push",
          "-u",
          "origin",
          exactBranchPushRef(branch, pushSource),
        ]);
        if (expectedHead) {
          const { stdout } = await gitLong(root.repoRoot, [
            "ls-remote",
            "--heads",
            "origin",
            `refs/heads/${branch}`,
          ]);
          if (!remoteBranchMatchesExpectedHead(stdout, expectedHead)) {
            return NextResponse.json(
              { ok: false, error: "the remote branch changed before the pull request could be opened" },
              { status: 409 },
            );
          }
        }
      } catch (err) {
        return NextResponse.json({ ok: false, error: `git push failed: ${stderrOf(err)}` }, { status: 502 });
      }
      // In origin's parent when origin is a fork, from origin's branch, and
      // always named (#5795): left to itself, gh picked the fork, or an
      // `upstream` remote where the branch was never pushed.
      const target = await resolvePrTarget(root.repoRoot);
      const prArgs = prCreateArgs(target, { base: def, branch, title, body: prBody });
      const base = prArgs[prArgs.indexOf("--base") + 1]!;
      try {
        const { stdout } = await ghCli(root.repoRoot, prArgs);
        const url = stdout.match(PR_URL_RE)?.[0] ?? stdout.trim();
        return NextResponse.json({ ok: true, url, branch, base });
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { stderr?: string };
        if (e.code === "ENOENT") {
          return NextResponse.json({ ok: false, error: "GitHub CLI (gh) not found — install it to open PRs" }, { status: 500 });
        }
        const detail = stderrOf(err);
        // gh exits non-zero when a PR already exists; its message includes the URL.
        const existing = detail.match(PR_URL_RE);
        if (existing) return NextResponse.json({ ok: true, url: existing[0], branch, base, existed: true });
        return NextResponse.json({ ok: false, error: `gh pr create failed: ${detail}` }, { status: 502 });
      }
      } catch (err) {
        return NextResponse.json({ ok: false, error: stderrOf(err) }, { status: 500 });
      }
    });
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
    return withRepositoryMutation(root.repoRoot, async () => {
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
    });
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
    return withRepositoryMutation(root.repoRoot, async () => {
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
      return await withRepositoryMutation(root.repoRoot, async () => {
        const outcome = await restoreCheckpoint(root.repoRoot, abs);
        return NextResponse.json({
          ok: true,
          checkpoint: body.checkpoint,
          restored: outcome.restored,
          unchanged: outcome.unchanged,
          kept: outcome.kept,
          checkpointPath: outcome.safetyCheckpointPath,
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
  return withRepositoryMutation(root.repoRoot, async () => {
  if (typeof body.path !== "string") {
    return NextResponse.json(
      { ok: false, error: "projectRoot and path are required" },
      { status: 400 },
    );
  }
  const abs = resolveContainedFile(root.repoRoot, body.path);
  if (!abs) return pathNotAllowed();
  const entry = await changedEntry(root.repoRoot, body.path);
  if (!entry) return pathNotAllowed();
  const from = entry.renamedFrom && resolveContainedFile(root.repoRoot, entry.renamedFrom) ? entry.renamedFrom : undefined;
  // The file as the desk decides on it (#5795): the version the user reviewed
  // when the client sends it, and again after the safety checkpoint, which
  // can take a while. A write that landed meanwhile was reverted, and was in
  // no checkpoint.
  const stamp = async () => {
    const files: ChangedFile[] = [body.path as string, ...(from ? [from] : [])].map((p) => ({ path: p, status: entry.status }));
    await stampChangedFiles(files, (filePath) => resolveContainedFileMetadata(root.repoRoot, filePath));
    return files.map((file) => file.changeVersion ?? "").join("\n");
  };
  const changedSinceReview = () =>
    NextResponse.json(
      { ok: false, stale: true, error: "this file changed since you reviewed it; nothing was reverted. Review it again" },
      { status: 409 },
    );
  const decided = await stamp();
  if (typeof body.expectedChangeVersion === "string" && body.expectedChangeVersion !== decided.split("\n")[0]) {
    return changedSinceReview();
  }

  try {
    // Decide how to revert based on whether the file exists at HEAD. Reverting
    // means "match HEAD": files in HEAD are restored (covers staged edits and
    // deletions); files NOT in HEAD are new, so reverting deletes them and is
    // gated behind an explicit confirmation.
    const [inHead, tracked, fromInHead] = await Promise.all([
      existsInHead(root.repoRoot, body.path),
      isTracked(root.repoRoot, body.path),
      from ? existsInHead(root.repoRoot, from) : Promise.resolve(false),
    ]);
    const plan = planRevert({
      inHead,
      tracked,
      confirmDelete: body.confirmUntracked === true,
      entry: { status: entry.status, renamedFrom: from, copied: entry.copied },
      fromInHead,
    });

    if (plan.action === "conflicted") {
      return NextResponse.json(
        {
          ok: false,
          error: "this file has a merge conflict; resolve it, or stop the operation that left it, in a terminal before reverting",
        },
        { status: 409 },
      );
    }

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

    // An untracked file too large to checkpoint can't be deleted from here
    // (#5781): its undo couldn't bring it back.
    if (plan.action === "clean") {
      const size = fs.lstatSync(/* turbopackIgnore: true */ abs, { throwIfNoEntry: false })?.size ?? 0;
      if (size > CHECKPOINT_MAX_UNTRACKED_BYTES) {
        return NextResponse.json(
          {
            ok: false,
            error: `this untracked file is ${Math.round(size / (1024 * 1024))} MB, too large for the checkpoint a revert takes first; delete it in a terminal if you mean to`,
          },
          { status: 413 },
        );
      }
    }

    // Reverts are destructive (discard edits / delete files). Snapshot the whole
    // working tree first so the action is recoverable; if the safety snapshot
    // fails, abort rather than destroy without a backup.
    let checkpointPath: string;
    try {
      checkpointPath = (await checkpointChanges(root.repoRoot)).path;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: `could not create safety checkpoint, revert aborted: ${message}` },
        { status: 500 },
      );
    }
    if ((await stamp()) !== decided) return changedSinceReview();

    switch (plan.action) {
      case "checkout":
        // `checkout HEAD --` updates index AND worktree, so staged edits and
        // staged/unstaged deletions all revert to the committed version —
        // matching the HEAD-relative diff the panel renders.
        // Literal (#5756): a bracketed path also matched its siblings as a
        // glob, and reverted them too.
        await git(root.repoRoot, ["--literal-pathspecs", "checkout", "HEAD", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "checkout", path: body.path, checkpointPath });
      case "unrename":
        // The original back in index and worktree, then the new path gone.
        await git(root.repoRoot, ["--literal-pathspecs", "checkout", "HEAD", "--", plan.from]);
        await git(root.repoRoot, ["--literal-pathspecs", "rm", "-f", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "unrename", path: body.path, renamedFrom: plan.from, checkpointPath });
      case "rm":
        // Staged new file: it never existed at HEAD, so reverting removes it
        // from both index and worktree.
        await git(root.repoRoot, ["--literal-pathspecs", "rm", "-f", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "rm", path: body.path, checkpointPath });
      case "clean":
        await git(root.repoRoot, ["--literal-pathspecs", "clean", "-f", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "clean", path: body.path, checkpointPath });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
  });
}
