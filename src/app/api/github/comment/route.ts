/**
 * /api/github/comment
 *
 * Posts a comment to an issue or pull-request conversation timeline
 * (REST `POST /repos/{owner}/{repo}/issues/{number}/comments`). Used by the
 * GitHub surface reply composer; the body is posted verbatim.
 *
 * Requires a PAT — the public API cannot write. The PAT is read-only from env,
 * never echoed to the client, never logged.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export type GitHubCommentInput = { repo: string; number: number; body: string };
export type GitHubWriteFailureReason = "auth_required" | "upstream" | "network";
export type GitHubCommentResult =
  | {
      ok: true;
      comment: {
        id: string;
        author: {
          login: string;
          avatarUrl: string | null;
          url: string | null;
        } | null;
        body: string;
        createdAt: string | null;
        url: string | null;
        authorAssociation: string | null;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
      reason: GitHubWriteFailureReason;
    };

export async function executeGitHubComment(input: GitHubCommentInput): Promise<GitHubCommentResult> {
  const token = resolveGitHubToken();
  if (!token) {
    return { ok: false, status: 401, error: "auth_required", reason: "auth_required" };
  }

  try {
    const res = await fetch(`${GH}/repos/${input.repo}/issues/${input.number}/comments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ body: input.body }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data || typeof data !== "object") {
      return {
        ok: false,
        status: res.status,
        error: `github error (${res.status})`,
        reason: "upstream",
      };
    }
    const user = data.user as Record<string, unknown> | undefined;
    return {
      ok: true,
      comment: {
        id: String(data.id ?? ""),
        author: user?.login
          ? {
              login: String(user.login),
              avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
              url: typeof user.html_url === "string" ? user.html_url : null,
            }
          : null,
        body: typeof data.body === "string" ? data.body : input.body,
        createdAt: typeof data.created_at === "string" ? data.created_at : null,
        url: typeof data.html_url === "string" ? data.html_url : null,
        authorAssociation: typeof data.author_association === "string" ? data.author_association : null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : "failed to post comment",
      reason: "network",
    };
  }
}

function toLegacyResponse(result: GitHubCommentResult): Response {
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json(
    { ok: false, error: result.error },
    { status: result.reason === "auth_required" ? 401 : result.status === 403 ? 403 : 502 },
  );
}

export async function POST(req: Request) {
  let body: { repo?: unknown; number?: unknown; body?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = Number.parseInt(String(body.number ?? ""), 10);
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "empty comment" }, { status: 400 });
  }

  return toLegacyResponse(await executeGitHubComment({ repo, number, body: text }));
}
