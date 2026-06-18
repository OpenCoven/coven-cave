import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { daemonSessionRoots, resolveWithinSessionRoots } from "@/lib/server/session-project-roots";
import { parseRipgrepJson, type SearchResult } from "@/lib/project-search";

export const dynamic = "force-dynamic";

/**
 * Project-wide code search (CODE-SEARCH-01).
 *
 * GET ?root=<abs>&q=<query>[&regex=1][&case=smart|sensitive|insensitive][&glob=<pat>]
 *   → { ok, repo, root, files, totalMatches, truncated }
 *
 * Spawns ripgrep (`rg --json`) under the requested root and parses its event
 * stream via the pure parser in @/lib/project-search. ripgrep respects
 * .gitignore and skips hidden/binary files by default, so results track the
 * same "git-visible working tree" surface as the @-mention file index.
 *
 * Security posture mirrors /api/changes: every spawn goes through execFile with
 * an argument array (no shell, no interpolation), the query is passed after
 * `--` so it can never be read as a flag, and the root must be either inside
 * the static workspace allow-list OR a directory the daemon has an active
 * session for (user-sanctioned — the daemon already booted a harness there).
 */

const RG_TIMEOUT_MS = 15_000;
const MAX_RG_BUFFER = 16 * 1024 * 1024;
const MAX_QUERY_LEN = 1024;
/** Per-file cap handed to ripgrep itself (defense in depth; the parser caps
 *  again so the two stay independent). */
const RG_MAX_COUNT = 50;

type RgResult = { stdout: string; code: number };

/** Run ripgrep, tolerating exit code 1 (no matches) as a non-error. Exit code
 *  2 (a real ripgrep error) rejects. */
function runRipgrep(cwd: string, args: string[]): Promise<RgResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "rg",
      args,
      { cwd, timeout: RG_TIMEOUT_MS, maxBuffer: MAX_RG_BUFFER },
      (err, stdout) => {
        if (!err) return resolve({ stdout, code: 0 });
        const code = (err as { code?: number }).code;
        // ripgrep exits 1 when there are simply no matches — that's success.
        if (code === 1) return resolve({ stdout: stdout ?? "", code: 1 });
        reject(err);
      },
    );
  });
}

type RootResolution =
  | { ok: true; root: string }
  | { ok: false; status: number; error: string; notARepo?: boolean };

/** Validate root: absolute, allowed (static workspace OR daemon session root),
 *  exists, is a directory, sits inside a git work tree. Keeps the REQUESTED dir
 *  (not the repo toplevel) so result paths stay relative to what the user is
 *  browsing — same contract as /api/project/files. */
async function resolveSearchRoot(root: string): Promise<RootResolution> {
  if (!path.isAbsolute(root)) {
    return { ok: false, status: 400, error: "root must be an absolute path" };
  }
  let sessionRoots: string[] | null = null;
  const isAllowed = async (candidate: string): Promise<string | null> => {
    const staticAllowed = resolveAllowedProjectPath(candidate);
    if (staticAllowed) return staticAllowed;
    if (sessionRoots === null) sessionRoots = await daemonSessionRoots();
    return resolveWithinSessionRoots(candidate, sessionRoots);
  };

  const allowedRoot = await isAllowed(root);
  if (!allowedRoot) {
    return { ok: false, status: 403, error: "path not allowed" };
  }
  let real: string;
  let stat: fs.Stats;
  try {
    real = fs.realpathSync(path.resolve(allowedRoot));
    stat = fs.statSync(real);
  } catch {
    return { ok: false, status: 404, error: "root does not exist" };
  }
  if (!stat.isDirectory()) {
    return { ok: false, status: 400, error: "root is not a directory" };
  }
  // Confirm it's a git work tree so search tracks the same surface as the file
  // index. Reuse the daemon-session list already fetched above.
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: real, timeout: 10_000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout });
      });
    });
    if (stdout.trim() !== "true") {
      return { ok: false, status: 422, error: "not a git repository", notARepo: true };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, status: 500, error: "git unavailable" };
    }
    return { ok: false, status: 422, error: "not a git repository", notARepo: true };
  }
  return { ok: true, root: real };
}

/** Translate request params into a ripgrep argument array. The query goes last,
 *  after `--`, so it can never be parsed as a flag. */
function buildRgArgs(params: {
  query: string;
  regex: boolean;
  caseMode: "smart" | "sensitive" | "insensitive";
  glob: string | null;
}): string[] {
  const args = ["--json", "--max-count", String(RG_MAX_COUNT), "--max-columns", "2000", "--no-messages"];
  if (!params.regex) args.push("--fixed-strings");
  if (params.caseMode === "insensitive") args.push("--ignore-case");
  else if (params.caseMode === "sensitive") args.push("--case-sensitive");
  else args.push("--smart-case");
  if (params.glob) args.push("--glob", params.glob);
  // Pattern then an explicit search path. The path is REQUIRED: with no path
  // argument and a non-TTY stdin (which execFile gives the child), ripgrep
  // blocks reading stdin instead of walking the directory — so it would hang
  // until the timeout. "." searches the cwd we set on the spawn.
  args.push("--", params.query, ".");
  return args;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const root = sp.get("root");
  const query = sp.get("q");

  if (!root) {
    return NextResponse.json({ ok: false, error: "missing root param" }, { status: 400 });
  }
  if (!query) {
    return NextResponse.json({ ok: false, error: "missing q param" }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LEN) {
    return NextResponse.json({ ok: false, error: "query too long" }, { status: 400 });
  }

  const resolved = await resolveSearchRoot(root);
  if (!resolved.ok) {
    if (resolved.notARepo) {
      // Distinct, non-error state — the UI hides the search panel.
      return NextResponse.json({ ok: true, repo: false, error: resolved.error });
    }
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  }

  const caseParam = sp.get("case");
  const caseMode =
    caseParam === "sensitive" || caseParam === "insensitive" ? caseParam : "smart";
  const glob = sp.get("glob")?.trim() || null;
  const regex = sp.get("regex") === "1";

  const args = buildRgArgs({ query, regex, caseMode, glob });

  try {
    const { stdout } = await runRipgrep(resolved.root, args);
    const result: SearchResult = parseRipgrepJson(stdout);
    return NextResponse.json({ ok: true, repo: true, root: resolved.root, ...result });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json(
        { ok: false, error: "ripgrep unavailable — install ripgrep (rg) to search the project" },
        { status: 500 },
      );
    }
    // A bad regex makes ripgrep exit 2 with a message on stderr; surface a 400.
    if (regex) {
      return NextResponse.json({ ok: false, error: "invalid search pattern" }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
