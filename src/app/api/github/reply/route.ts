/**
 * /api/github/reply
 *
 * Posts a reply to a top-level pull-request review comment. This is separate
 * from /api/github/comment: GitHub's review-comment replies endpoint keeps the
 * response in the inline review thread rather than the PR conversation.
 *
 * Requires a PAT — the public API cannot write. The PAT is read-only from env,
 * never echoed to the client, never logged.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";
import { upstreamFetch } from "@/lib/server/upstream-fetch";
import { ambiguousWrite, isAmbiguousWriteStatus, isRecord, resourceId, userLogin, writeThrew, upstreamFailureResponse } from "@/lib/server/upstream-answer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function positiveInteger(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(req: Request) {
  let body: { repo?: unknown; number?: unknown; commentId?: unknown; body?: unknown };
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = positiveInteger(body.number);
  const commentId = positiveInteger(body.commentId);
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (number == null) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  if (commentId == null) {
    return NextResponse.json({ ok: false, error: "invalid commentId" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "empty reply" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo, number, and commentId are validated above — safe to interpolate.
    let res: Response;
    try {
      res = await upstreamFetch("github", `${GH}/repos/${repo}/pulls/${number}/comments/${commentId}/replies`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ body: text }),
      });
    } catch (e) {
      // The request may have reached GitHub before this failed; only a
      // write that provably never left is a plain, retryable failure (#6369).
      return writeThrew("GitHub", "reply", e, "failed to post reply");
    }
    // A 5xx after GitHub received the write leaves its outcome unknown (#6369).
    if (isAmbiguousWriteStatus(res.status)) return ambiguousWrite("GitHub", "reply");
    const data = await res.json().catch(() => null);
    // GitHub accepted the reply; an unreadable answer leaves it unconfirmed,
    // and a blind retry could post it twice (#6368).
    if (res.ok && !isRecord(data)) return ambiguousWrite("GitHub", "reply");
    if (!res.ok || !data || typeof data !== "object") {
      return upstreamFailureResponse(res, "GitHub", `github error (${res.status})`, res.status === 403 ? 403 : 502);
    }
    const d = data as Record<string, unknown>;
    const id = resourceId(d.id);
    if (!id) return ambiguousWrite("GitHub", "reply");
    const user = isRecord(d.user) ? d.user : undefined;
    const authorLogin = userLogin(user);
    return NextResponse.json({
      ok: true,
      comment: {
        id,
        author: user && authorLogin
          ? {
              login: authorLogin,
              avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
              url: typeof user.html_url === "string" ? user.html_url : null,
            }
          : null,
        body: typeof d.body === "string" ? d.body : text,
        createdAt: typeof d.created_at === "string" ? d.created_at : null,
        url: typeof d.html_url === "string" ? d.html_url : null,
        authorAssociation: typeof d.author_association === "string" ? d.author_association : null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to post reply" },
      { status: 502 },
    );
  }
}
