import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs, { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { isCheckpointName, parseNumstatZ, parsePorcelainZ, planRevert } from "@/lib/git-changes";

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
 * POST { projectRoot, path, confirmUntracked? } → revert ONE file (auto-checkpoints first)
 * POST { projectRoot, action: "checkpoint" } → save a patch snapshot
 * POST { projectRoot, action: "restore-checkpoint", checkpoint } → git apply a snapshot
 * POST { projectRoot, action: "delete-checkpoint", checkpoint } → remove a snapshot
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

type RootResolution =
  | { ok: true; repoRoot: string }
  | { ok: false; status: number; error: string; notARepo?: boolean };

/** Validate projectRoot: absolute, exists, is a directory, is a git work tree.
 *  Resolves to the repo toplevel so status paths line up with diff/revert. */
async function resolveRepoRoot(projectRoot: string): Promise<RootResolution> {
  if (!path.isAbsolute(projectRoot)) {
    return { ok: false, status: 400, error: "projectRoot must be an absolute path" };
  }
  const allowedRoot = resolveAllowedProjectPath(projectRoot);
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
    if (!resolveAllowedProjectPath(repoRoot)) {
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

// ── GET: change list / single-file diff ───────────────────────────────────────

async function listChanges(repoRoot: string): Promise<NextResponse> {
  const { stdout } = await git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
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

  return NextResponse.json({ ok: true, repo: true, repoRoot, files });
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
      ({ stdout: diff } = await gitDiff(repoRoot, ["--no-index", "--", "/dev/null", absPath]));
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
    if (filePath === null) return await listChanges(root.repoRoot);
    const abs = resolveContainedFile(root.repoRoot, filePath);
    if (!abs) return pathNotAllowed();
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
        const { stdout } = await gitDiff(repoRoot, ["--no-index", "--", "/dev/null", file.path]);
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
    action?: "revert" | "checkpoint" | "restore-checkpoint" | "delete-checkpoint";
    checkpoint?: string;
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
