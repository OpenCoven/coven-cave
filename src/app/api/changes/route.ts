import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs, { writeFileSync } from "node:fs";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { parseNumstatZ, parsePorcelainZ, planRevert } from "@/lib/git-changes";

export const dynamic = "force-dynamic";

/**
 * Working-tree changes for a chat session's project root (CHAT-D8-01).
 *
 * GET  ?projectRoot=<abs>             → list uncommitted changes (git status)
 * GET  ?projectRoot=<abs>&path=<rel>  → unified diff for one file (capped)
 * POST { projectRoot, path, confirmUntracked? } → revert ONE file
 * POST { projectRoot, action: "checkpoint" } → save a patch snapshot
 *
 * Security posture: every git invocation goes through execFile with an
 * argument array — no shell, so paths are never string-interpolated into a
 * command. File paths from the client are repo-relative and must pass a
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
    const { stdout: numstat } = await git(repoRoot, ["diff", "--numstat", "-z", "HEAD", "--"]);
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
      ({ stdout: diff } = await git(repoRoot, ["diff", "HEAD", "--", relPath]));
    } catch {
      // No HEAD yet (unborn branch) — fall back to worktree-vs-index.
      ({ stdout: diff } = await git(repoRoot, ["diff", "--", relPath]));
    }
  } else {
    // Untracked: synthesize an all-additions diff. --no-index exits 1 when
    // the files differ, which execFile reports as an error — recover stdout.
    try {
      ({ stdout: diff } = await git(repoRoot, ["diff", "--no-index", "--", "/dev/null", absPath]));
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
    if (filePath === null) return await listChanges(root.repoRoot);
    const abs = resolveContainedFile(root.repoRoot, filePath);
    if (!abs) return pathNotAllowed();
    return await diffFile(root.repoRoot, filePath, abs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function checkpointChanges(repoRoot: string): Promise<string> {
  // Store snapshots under .git/coven-cave/checkpoints so the checkpoint never
  // creates new worktree changes.
  let patch = "";
  try {
    ({ stdout: patch } = await git(repoRoot, ["diff", "--binary", "HEAD", "--"]));
  } catch {
    ({ stdout: patch } = await git(repoRoot, ["diff", "--binary", "--"]));
  }

  const { stdout: statusOut } = await git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  for (const file of parsePorcelainZ(statusOut)) {
    if (file.status === "untracked") {
      const abs = resolveContainedFile(repoRoot, file.path);
      if (!abs || !fs.existsSync(/* turbopackIgnore: true */ abs)) continue;
      try {
        const { stdout } = await git(repoRoot, ["diff", "--no-index", "--", "/dev/null", abs]);
        patch += stdout;
      } catch (err) {
        const e = err as { code?: number; stdout?: string };
        if (e.code === 1 && typeof e.stdout === "string") patch += e.stdout;
        else throw err;
      }
    }
  }

  const { stdout: gitDirOut } = await git(repoRoot, ["rev-parse", "--git-dir"]);
  const gitDirRaw = gitDirOut.trim();
  const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(/* turbopackIgnore: true */ repoRoot, gitDirRaw);
  const checkpointDir = path.join(/* turbopackIgnore: true */ gitDir, "coven-cave", "checkpoints");
  fs.mkdirSync(/* turbopackIgnore: true */ checkpointDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const checkpointPath = path.join(/* turbopackIgnore: true */ checkpointDir, `${stamp}.patch`);
  writeFileSync(checkpointPath, patch, { mode: 0o600 });
  return checkpointPath;
}

// ── POST: revert one file / checkpoint changes ───────────────────────────────

export async function POST(req: NextRequest) {
  let body: { projectRoot?: string; path?: string; confirmUntracked?: boolean; action?: "revert" | "checkpoint" };
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

    switch (plan.action) {
      case "checkout":
        // `checkout HEAD --` updates index AND worktree, so staged edits and
        // staged/unstaged deletions all revert to the committed version —
        // matching the HEAD-relative diff the panel renders.
        await git(root.repoRoot, ["checkout", "HEAD", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "checkout", path: body.path });
      case "rm":
        // Staged new file: it never existed at HEAD, so reverting removes it
        // from both index and worktree.
        await git(root.repoRoot, ["rm", "-f", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "rm", path: body.path });
      case "clean":
        await git(root.repoRoot, ["clean", "-f", "--", body.path]);
        return NextResponse.json({ ok: true, reverted: "clean", path: body.path });
      case "confirm-required":
        return NextResponse.json(
          {
            ok: false,
            error: "new file — deleting it requires confirmUntracked",
            requiresConfirmUntracked: true,
          },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
