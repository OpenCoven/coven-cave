import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Working-tree changes for a chat session's project root (CHAT-D8-01).
 *
 * GET  ?projectRoot=<abs>             → list uncommitted changes (git status)
 * GET  ?projectRoot=<abs>&path=<rel>  → unified diff for one file (capped)
 * POST { projectRoot, path, confirmUntracked? } → revert ONE file
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
const MAX_GIT_BUFFER = 8 * 1024 * 1024;
/** Diff payload cap (~200KB) so one giant lockfile diff can't flood the panel. */
const DIFF_CAP_CHARS = 200 * 1024;

type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

type ChangedFile = {
  path: string;
  status: FileStatus;
  renamedFrom?: string;
  insertions?: number;
  deletions?: number;
};

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
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(projectRoot));
  } catch {
    return { ok: false, status: 404, error: "projectRoot does not exist" };
  }
  if (!fs.statSync(real).isDirectory()) {
    return { ok: false, status: 400, error: "projectRoot is not a directory" };
  }
  try {
    const { stdout } = await git(real, ["rev-parse", "--show-toplevel"]);
    const top = stdout.trim();
    if (!top) return { ok: false, status: 422, error: "not a git repository", notARepo: true };
    return { ok: true, repoRoot: fs.realpathSync(top) };
  } catch {
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
  return resolved;
}

function pathNotAllowed(): NextResponse {
  return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
}

// ── status parsing ────────────────────────────────────────────────────────────

function statusOf(x: string, y: string): FileStatus {
  if (x === "?") return "untracked";
  if (x === "R" || y === "R" || x === "C") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

/** Parse `git status --porcelain=v1 -z`. Entries are NUL-separated
 *  `XY <path>`; renames/copies carry the original path as the next token. */
function parsePorcelainZ(out: string): ChangedFile[] {
  const tokens = out.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4 || entry[2] !== " ") continue;
    const x = entry[0];
    const y = entry[1];
    const file: ChangedFile = { path: entry.slice(3), status: statusOf(x, y) };
    if (x === "R" || x === "C") {
      file.renamedFrom = tokens[i + 1];
      i++;
    }
    files.push(file);
  }
  return files;
}

/** Parse `git diff --numstat -z`: `ins\tdel\tpath` tokens; renames leave the
 *  path slot empty and append old/new as the following two tokens. Binary
 *  files report `-` and are skipped — counts are best-effort decoration. */
function parseNumstatZ(out: string): Map<string, { insertions: number; deletions: number }> {
  const map = new Map<string, { insertions: number; deletions: number }>();
  const tokens = out.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[i]);
    if (!m) continue;
    let file = m[3];
    if (file === "") {
      file = tokens[i + 2] ?? "";
      i += 2;
    }
    if (!file || m[1] === "-" || m[2] === "-") continue;
    map.set(file, { insertions: Number(m[1]), deletions: Number(m[2]) });
  }
  return map;
}

async function isTracked(repoRoot: string, relPath: string): Promise<boolean> {
  try {
    await git(repoRoot, ["ls-files", "--error-unmatch", "--", relPath]);
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

// ── POST: revert one file ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { projectRoot?: string; path?: string; confirmUntracked?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (typeof body.projectRoot !== "string" || typeof body.path !== "string") {
    return NextResponse.json(
      { ok: false, error: "projectRoot and path are required" },
      { status: 400 },
    );
  }

  const root = await resolveRepoRoot(body.projectRoot);
  if (!root.ok) {
    return NextResponse.json({ ok: false, error: root.error }, { status: root.status });
  }
  const abs = resolveContainedFile(root.repoRoot, body.path);
  if (!abs) return pathNotAllowed();

  try {
    if (await isTracked(root.repoRoot, body.path)) {
      // Restore the worktree copy (also resurrects a deleted tracked file).
      await git(root.repoRoot, ["checkout", "--", body.path]);
      return NextResponse.json({ ok: true, reverted: "checkout", path: body.path });
    }
    // Untracked: reverting means deleting the file — destructive, so it is
    // gated behind an explicit confirmUntracked flag from the client.
    if (body.confirmUntracked !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "untracked file — deleting it requires confirmUntracked",
          requiresConfirmUntracked: true,
        },
        { status: 400 },
      );
    }
    await git(root.repoRoot, ["clean", "-f", "--", body.path]);
    return NextResponse.json({ ok: true, reverted: "clean", path: body.path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
