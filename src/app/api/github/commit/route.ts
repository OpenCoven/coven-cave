/**
 * /api/github/commit
 *
 * Detail for a single commit so chat commit cards can hydrate (design:
 * docs/chat-github-integration.md §2-3): message, author, date, change stats,
 * and a capped file list.
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = (url.searchParams.get("repo") ?? "").trim();
  const sha = (url.searchParams.get("sha") ?? "").trim();

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
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
