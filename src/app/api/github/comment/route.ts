/**
 * /api/github/comment
 *
 * Posts a comment to an issue or pull-request conversation timeline
 * (REST `POST /repos/{owner}/{repo}/issues/{number}/comments`). Used by the
 * GitHub surface composer, including the familiar-tagging flow where the body
 * already carries the `@familiar` mention text.
 *
 * Requires a PAT — the public API cannot write. The PAT is read-only from env,
 * never echoed to the client, never logged.
 */

import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

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

  const token = resolveSecret("GITHUB_PAT") ?? null;
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/issues/${number}/comments`, {
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
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== "object") {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 ? 403 : 502 },
      );
    }
    const d = data as Record<string, unknown>;
    const user = d.user as Record<string, unknown> | undefined;
    return NextResponse.json({
      ok: true,
      comment: {
        id: String(d.id ?? ""),
        author: user?.login
          ? {
              login: String(user.login),
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
      { ok: false, error: e instanceof Error ? e.message : "failed to post comment" },
      { status: 502 },
    );
  }
}
