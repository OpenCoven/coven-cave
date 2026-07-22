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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const EVENTS = new Set(["APPROVE", "REQUEST_CHANGES", "COMMENT"]);

export async function POST(req: Request) {
  let body: { repo?: unknown; number?: unknown; event?: unknown; body?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = Number.parseInt(String(body.number ?? ""), 10);
  const event = typeof body.event === "string" ? body.event.toUpperCase() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  if (!EVENTS.has(event)) {
    return NextResponse.json({ ok: false, error: "invalid event" }, { status: 400 });
  }
  if (event !== "APPROVE" && !text) {
    return NextResponse.json({ ok: false, error: "review body required" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/pulls/${number}/reviews`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ event, ...(text ? { body: text } : {}) }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data) {
      // Surface GitHub's own message verbatim (e.g. "Can not approve your own
      // pull request") — the card renders it as the actionable error.
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return NextResponse.json({ ok: false, error: message }, { status: res.status === 403 ? 403 : 502 });
    }
    return NextResponse.json({
      ok: true,
      review: {
        id: String(data.id ?? ""),
        state: String(data.state ?? event),
        url: typeof data.html_url === "string" ? data.html_url : null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to submit review" },
      { status: 502 },
    );
  }
}
