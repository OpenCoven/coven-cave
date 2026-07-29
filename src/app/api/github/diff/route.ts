/**
 * /api/github/diff
 *
 * A pull request's changed files, bounded hard, so a familiar can be handed a
 * real review context instead of just the PR title.
 *
 * The bounds are the point of this route. The payload is destined for a model
 * prompt, where an unbounded diff is a silently truncated context window or a
 * blown token budget: at most MAX_FILES entries, each patch sliced to
 * MAX_PATCH_CHARS, and a shared PATCH_BUDGET across the whole response. Files
 * past the budget keep their metadata with `patch: null`, and `truncated` is
 * true whenever anything at all was dropped or sliced, so the caller can say so
 * in the prompt rather than presenting a partial diff as complete.
 *
 * Auth mirrors /api/github/item: a local-only PAT when present, otherwise the
 * unauthenticated public API. The PAT is never echoed back.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";

// owner/name — exactly one slash, each segment a safe GitHub identifier. This
// is the barrier that keeps the value safe to interpolate into the API path.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

const MAX_FILES = 40;
const MAX_PATCH_CHARS = 4_000;
const PATCH_BUDGET = 60_000;

type DiffFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = (url.searchParams.get("repo") ?? "").trim();
  const numberRaw = (url.searchParams.get("number") ?? "").trim();
  const number = Number.parseInt(numberRaw, 10);

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }

  const token = resolveGitHubToken();

  try {
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/pulls/${number}/files?per_page=100`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    });
    if (res.status === 404) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 ? 403 : 502 },
      );
    }

    const raw = data as Array<Record<string, unknown>>;
    let truncated = raw.length > MAX_FILES;
    let budget = PATCH_BUDGET;
    const files: DiffFile[] = [];

    for (const entry of raw.slice(0, MAX_FILES)) {
      const full = typeof entry.patch === "string" ? entry.patch : null;
      let patch: string | null = null;
      if (full !== null) {
        const room = Math.min(MAX_PATCH_CHARS, budget);
        if (room <= 0) {
          // Budget spent — the file still earns its metadata row, which is what
          // tells the model a change exists here that it cannot see.
          truncated = true;
        } else {
          patch = full.slice(0, room);
          if (patch.length < full.length) truncated = true;
          budget -= patch.length;
        }
      }
      files.push({
        filename: typeof entry.filename === "string" ? entry.filename : "",
        status: typeof entry.status === "string" ? entry.status : "modified",
        additions: num(entry.additions),
        deletions: num(entry.deletions),
        patch,
      });
    }

    return NextResponse.json({ ok: true, truncated, files });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load diff" },
      { status: 502 },
    );
  }
}
