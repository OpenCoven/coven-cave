import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Workspace file index for the chat composer's `@`-mention picker
 * (CHAT-D1-04).
 *
 * GET ?root=<abs> → { ok, repo, root, files, truncated }
 *
 * Lists git-visible files under the requested root: tracked plus
 * untracked-but-not-ignored (`git ls-files --cached --others
 * --exclude-standard`), capped at MAX_FILES with a `truncated` flag. Paths
 * are relative to the requested root (the chat's project root — the same
 * directory the harness boots in), so the composer can insert them verbatim.
 *
 * Security posture mirrors /api/changes: every git invocation goes through
 * execFile with an argument array — no shell, so the root is never
 * string-interpolated into a command. The root must be an absolute path,
 * is realpath-resolved before use, and must be a directory inside a git
 * work tree. A non-repo root is a distinct non-error state
 * (`{ ok: true, repo: false }`) the composer can render or skip.
 */

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const MAX_GIT_BUFFER = 16 * 1024 * 1024;
/** Cap the index so a monorepo can't flood the client; the picker only ever
 * shows a dozen fuzzy matches, so the tail matters less than the bound. */
const MAX_FILES = 5000;
/** Module-level response cache: repeated keystrokes re-open the picker, but
 * the index only needs refreshing every few seconds. Keyed by realpathed
 * root. */
const CACHE_TTL_MS = 10_000;

type FilesPayload = {
  ok: true;
  repo: true;
  root: string;
  files: string[];
  truncated: boolean;
};

const cache = new Map<string, { at: number; payload: FilesPayload }>();

/** Run git via execFile (argument array, no shell interpolation). */
function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
  });
}

type RootResolution =
  | { ok: true; root: string }
  | { ok: false; status: number; error: string; notARepo?: boolean };

/** Validate root: absolute, exists (realpath), is a directory, and sits
 * inside a git work tree. Unlike /api/changes we keep the REQUESTED dir
 * (not the repo toplevel) so listed paths stay relative to the chat root. */
async function resolveIndexRoot(root: string): Promise<RootResolution> {
  if (!path.isAbsolute(root)) {
    return { ok: false, status: 400, error: "root must be an absolute path" };
  }
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(root));
  } catch {
    return { ok: false, status: 404, error: "root does not exist" };
  }
  if (!fs.statSync(real).isDirectory()) {
    return { ok: false, status: 400, error: "root is not a directory" };
  }
  try {
    const { stdout } = await git(real, ["rev-parse", "--is-inside-work-tree"]);
    if (stdout.trim() !== "true") {
      return { ok: false, status: 422, error: "not a git repository", notARepo: true };
    }
    return { ok: true, root: real };
  } catch {
    return { ok: false, status: 422, error: "not a git repository", notARepo: true };
  }
}

async function listFiles(root: string): Promise<FilesPayload> {
  const cached = cache.get(root);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;

  // Tracked + untracked-but-not-ignored, NUL-separated so filenames with
  // newlines can't split entries.
  const { stdout } = await git(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const all = stdout.split("\0").filter(Boolean);
  const truncated = all.length > MAX_FILES;
  const payload: FilesPayload = {
    ok: true,
    repo: true,
    root,
    files: truncated ? all.slice(0, MAX_FILES) : all,
    truncated,
  };
  cache.set(root, { at: Date.now(), payload });
  return payload;
}

export async function GET(req: NextRequest) {
  const root = req.nextUrl.searchParams.get("root");
  if (!root) {
    return NextResponse.json({ ok: false, error: "missing root param" }, { status: 400 });
  }

  const resolved = await resolveIndexRoot(root);
  if (!resolved.ok) {
    if (resolved.notARepo) {
      // Distinct, non-error state — the composer hides the picker.
      return NextResponse.json({ ok: true, repo: false, error: resolved.error });
    }
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  }

  try {
    return NextResponse.json(await listFiles(resolved.root));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
