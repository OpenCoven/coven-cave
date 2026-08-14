/**
 * /api/github/commit
 *
 * `?sha=` — detail for a single commit so chat commit cards can hydrate
 * (design: docs/chat-github-integration.md §2-3): message, author, date,
 * change stats, and a capped file list.
 *
 * `?number=` — the commit LIST for one pull request, which the PR reader's
 * Commits tab needs (cave-l82dm). It lives here rather than in a sibling route
 * because it is the same resource under the same repo guard and the same auth;
 * a second route would duplicate both for one different upstream path.
 *
 * Auth mirrors /api/github/item: a local-only PAT when present, otherwise the
 * unauthenticated public API. The PAT is never echoed back.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const MAX_FILES = 20;
/** One page. A PR past this is a rebase problem, not a reading problem, and
 *  the response says so through `truncated` rather than silently ending. */
const MAX_COMMITS = 100;

function ghHeaders(token: string | null) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** `?repo=&number=` → the pull request's commits, oldest first (GitHub's order). */
async function listPullCommits(repo: string, numberRaw: string) {
  const number = Number(numberRaw);
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  const token = resolveGitHubToken();
  try {
    // repo passed REPO_RE and number is a validated positive integer.
    const res = await fetch(
      `${GH}/repos/${repo}/pulls/${number}/commits?per_page=${MAX_COMMITS}`,
      { headers: ghHeaders(token), cache: "no-store" },
    );
    if (res.status === 404) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    const data = (await res.json().catch(() => null)) as Array<Record<string, unknown>> | null;
    if (!res.ok || !Array.isArray(data)) {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 ? 403 : 502 },
      );
    }
    const commits = data.map((entry) => {
      const commit = entry.commit as Record<string, unknown> | undefined;
      const author = commit?.author as Record<string, unknown> | undefined;
      const user = entry.author as Record<string, unknown> | undefined;
      const verification = commit?.verification as Record<string, unknown> | undefined;
      const message = typeof commit?.message === "string" ? commit.message : "";
      const split = message.indexOf("\n");
      return {
        sha: String(entry.sha ?? ""),
        // Subject and body separately: the reader shows the subject in the row
        // and the body only when the row is expanded.
        subject: split < 0 ? message : message.slice(0, split),
        body: split < 0 ? "" : message.slice(split + 1).trim(),
        authorLogin: typeof user?.login === "string" ? user.login : null,
        authorName: typeof author?.name === "string" ? author.name : null,
        date: typeof author?.date === "string" ? author.date : null,
        htmlUrl: typeof entry.html_url === "string" ? entry.html_url : null,
        // GitHub's own verification verdict. `git log --show-signature` is not
        // usable here (this checkout has no allowed-signers file), so the API
        // field is the only reliable signal — same rule the repo applies when
        // auditing a PR's own commits.
        verified: Boolean(verification?.verified),
        verifiedReason: typeof verification?.reason === "string" ? verification.reason : null,
      };
    });
    return NextResponse.json({
      ok: true,
      authed: Boolean(token),
      truncated: commits.length >= MAX_COMMITS,
      commits,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load commits" },
      { status: 502 },
    );
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = (url.searchParams.get("repo") ?? "").trim();
  const sha = (url.searchParams.get("sha") ?? "").trim();
  const number = (url.searchParams.get("number") ?? "").trim();

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  // The list mode is selected by `number` and is checked BEFORE the sha guard,
  // so a caller that passes only `number` is not rejected for a missing sha.
  if (number) return listPullCommits(repo, number);
  if (!SHA_RE.test(sha)) {
    return NextResponse.json({ ok: false, error: "invalid sha" }, { status: 400 });
  }

  const token = resolveGitHubToken();

  try {
    // repo passed REPO_RE and sha passed SHA_RE — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/commits/${sha}`, {
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
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data || typeof data !== "object") {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 ? 403 : 502 },
      );
    }

    const commit = data.commit as Record<string, unknown> | undefined;
    const commitAuthor = commit?.author as Record<string, unknown> | undefined;
    const user = data.author as Record<string, unknown> | undefined;
    const stats = data.stats as Record<string, unknown> | undefined;
    const rawFiles = Array.isArray(data.files) ? (data.files as Array<Record<string, unknown>>) : [];

    return NextResponse.json({
      ok: true,
      authed: Boolean(token),
      commit: {
        sha: String(data.sha ?? sha),
        message: typeof commit?.message === "string" ? commit.message : "",
        authorLogin: typeof user?.login === "string" ? user.login : null,
        authorName: typeof commitAuthor?.name === "string" ? commitAuthor.name : null,
        date: typeof commitAuthor?.date === "string" ? commitAuthor.date : null,
        htmlUrl: typeof data.html_url === "string" ? data.html_url : null,
        stats: {
          additions: Number(stats?.additions ?? 0),
          deletions: Number(stats?.deletions ?? 0),
          total: Number(stats?.total ?? 0),
        },
        fileCount: rawFiles.length,
        files: rawFiles.slice(0, MAX_FILES).map((f) => ({
          filename: typeof f.filename === "string" ? f.filename : "",
          status: typeof f.status === "string" ? f.status : "modified",
          additions: Number(f.additions ?? 0),
          deletions: Number(f.deletions ?? 0),
        })),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load commit" },
      { status: 502 },
    );
  }
}
