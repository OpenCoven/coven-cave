/**
 * /api/github/review
 *
 * Submit a pull-request review (design docs/chat-github-integration.md §3,
 * tier-2): APPROVE / REQUEST_CHANGES / COMMENT via REST
 * `POST /repos/{repo}/pulls/{number}/reviews`. GitHub requires a body for
 * REQUEST_CHANGES and COMMENT; the route enforces that so the card can show a
 * clear validation error instead of a GitHub 422.
 *
 * Requires a PAT — never echoed, never logged.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";
import { parseGitHubDiffRevision, validateGitHubReviewBody } from "@/lib/github-review";
import { assertCurrentGitHubRevision, GitHubRevisionError } from "@/lib/server/github-review-revision";
import { sanitizeGithubObjectSha } from "@/lib/github-object-sha";
import { upstreamApiError } from "@/lib/server/upstream-api-error";
import { upstreamFetch } from "@/lib/server/upstream-fetch";
import { ambiguousWrite, isAmbiguousWriteStatus, isRecord, resourceId, writeThrew } from "@/lib/server/upstream-answer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const EVENTS = new Set(["APPROVE", "REQUEST_CHANGES", "COMMENT"]);

export async function POST(req: Request) {
  let body: { repo?: unknown; number?: unknown; event?: unknown; body?: unknown; headSha?: unknown; reviewedRevision?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = Number.parseInt(String(body.number ?? ""), 10);
  const event = typeof body.event === "string" ? body.event.toUpperCase() : "";
  const reviewBody = validateGitHubReviewBody(body.body);
  const headSha = sanitizeGithubObjectSha(typeof body.headSha === "string" ? body.headSha : null);
  if (body.headSha !== undefined && !headSha) {
    return NextResponse.json({ ok: false, error: "invalid head SHA" }, { status: 400 });
  }
  const reviewedRevision = parseGitHubDiffRevision(body.reviewedRevision);
  if (body.reviewedRevision !== undefined && (!reviewedRevision ||
      reviewedRevision.repo.toLowerCase() !== repo.toLowerCase() ||
      reviewedRevision.number !== number || reviewedRevision.headSha !== headSha)) {
    return NextResponse.json({ ok: false, error: "invalid reviewed revision" }, { status: 400 });
  }

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  if (!EVENTS.has(event)) {
    return NextResponse.json({ ok: false, error: "invalid event" }, { status: 400 });
  }
  if (!reviewBody.ok) {
    return NextResponse.json({ ok: false, error: reviewBody.error }, { status: 400 });
  }
  const text = reviewBody.value;
  if (event !== "APPROVE" && !text) {
    return NextResponse.json({ ok: false, error: "review body required" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    await assertCurrentGitHubRevision(repo, number, token, headSha, reviewedRevision);
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    let res: Response;
    try {
      res = await upstreamFetch("github", `${GH}/repos/${repo}/pulls/${number}/reviews`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ event, ...(text ? { body: text } : {}), ...(headSha ? { commit_id: headSha } : {}) }),
      });
    } catch (e) {
      // The request may have reached GitHub before this failed; only a
      // write that provably never left is a plain, retryable failure (#6369).
      return writeThrew("GitHub", "review", e, "failed to submit review");
    }
    // A 5xx after GitHub received the write leaves its outcome unknown (#6369).
    if (isAmbiguousWriteStatus(res.status)) return ambiguousWrite("GitHub", "review");
    const raw: unknown = await res.json().catch(() => null);
    // GitHub accepted the review; an answer without a review id leaves it
    // unconfirmed, and a blind retry could submit it twice (#6368).
    if (res.ok && !(isRecord(raw) && resourceId(raw.id))) return ambiguousWrite("GitHub", "review");
    const data = isRecord(raw) ? raw : null;
    if (!res.ok || !data) {
      // Surface GitHub's own message verbatim (e.g. "Can not approve your own
      // pull request") — the card renders it as the actionable error.
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return upstreamApiError("GitHub", res, {
        configured: true,
        error: message,
        responseBody: data,
      });
    }
    return NextResponse.json({
      ok: true,
      review: {
        id: resourceId(data.id) as string,
        state: typeof data.state === "string" && data.state ? data.state : event,
        url: typeof data.html_url === "string" ? data.html_url : null,
      },
    });
  } catch (e) {
    if (e instanceof GitHubRevisionError && e.response && (e.status === 401 || e.status === 429)) {
      return upstreamApiError("GitHub", e.response, {
        configured: Boolean(token),
        error: e.message,
        responseBody: e.responseBody,
      });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to submit review" },
      { status: e instanceof GitHubRevisionError ? e.status : 502 },
    );
  }
}
