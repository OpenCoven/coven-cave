/**
 * /api/github/issue
 *
 * GitHub issue writes for the chat card layer (design:
 * docs/chat-github-integration.md §3, tier-1 actions):
 *   - POST  — create an issue {repo, title, body?, labels?}
 *   - PATCH — set issue state {repo, number, state: "open" | "closed"}
 *
 * Both require a PAT — the public API cannot write. The PAT is read from the
 * vault/env, never echoed to the client, never logged. Issue state changes are
 * reversible (close ↔ reopen), which is what keeps them in tier-1.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
// owner/name — exactly one slash, each segment a safe GitHub identifier. The
// barrier that keeps the value safe to interpolate into the API path.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function issuePayload(d: Record<string, unknown>) {
  return {
    number: Number(d.number ?? 0),
    title: String(d.title ?? ""),
    state: String(d.state ?? "open"),
    htmlUrl: typeof d.html_url === "string" ? d.html_url : null,
  };
}

export async function POST(req: Request) {
  let body: { repo?: unknown; title?: unknown; body?: unknown; labels?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body : "";
  const labels = Array.isArray(body.labels)
    ? body.labels
        .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
        .map((l) => l.trim())
        .slice(0, 20)
    : [];

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ ok: false, error: "empty title" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/issues`, {
      method: "POST",
      headers: ghHeaders(token),
      cache: "no-store",
      body: JSON.stringify({ title, body: text, ...(labels.length ? { labels } : {}) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== "object") {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 || res.status === 404 ? res.status : 502 },
      );
    }
    return NextResponse.json({ ok: true, issue: issuePayload(data as Record<string, unknown>) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to create issue" },
      { status: 502 },
    );
  }
}

export async function PATCH(req: Request) {
  let body: { repo?: unknown; number?: unknown; state?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = Number.parseInt(String(body.number ?? ""), 10);
  const state = body.state === "closed" ? "closed" : body.state === "open" ? "open" : null;

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  if (!state) {
    return NextResponse.json({ ok: false, error: "invalid state" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/issues/${number}`, {
      method: "PATCH",
      headers: ghHeaders(token),
      cache: "no-store",
      body: JSON.stringify({ state }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== "object") {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 || res.status === 404 ? res.status : 502 },
      );
    }
    return NextResponse.json({ ok: true, issue: issuePayload(data as Record<string, unknown>) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to update issue" },
      { status: 502 },
    );
  }
}
