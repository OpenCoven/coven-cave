/**
 * /api/github/issue
 *
 * GitHub issue writes for the chat card layer (design:
 * docs/chat-github-integration.md §3, tier-1 actions):
 *   - POST  — create an issue {repo, title, body?, labels?}
 *   - PATCH — set issue state and/or triage fields
 *             {repo, number, state?: "open" | "closed", assignees?, labels?}
 *
 * `assignees`/`labels` are SET semantics, not deltas: GitHub's issue PATCH
 * replaces the whole list, and the composer always sends the full desired
 * selection — so an empty array is a deliberate "clear", and a missing key
 * means "leave untouched".
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

// Bounds on the assignee/label lists a single PATCH may carry. Deliberately
// looser than GitHub's own product limits (10 assignees, 50-char label names):
// the job here is to refuse obviously malformed input before spending a
// round-trip, not to mirror rules that live on GitHub's side and change.
const MAX_LIST_ENTRIES = 20;
const MAX_ENTRY_CHARS = 100;

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

/**
 * A validated set-semantics string list, or null when the caller sent something
 * that is not one. All-or-nothing on purpose: silently dropping a bad entry from
 * a replace-the-whole-list write would delete an assignee the caller never
 * asked to remove.
 */
function stringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_LIST_ENTRIES) return null;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    const value = entry.trim();
    if (!value || value.length > MAX_ENTRY_CHARS) return null;
    out.push(value);
  }
  return out;
}

/** Assignee logins as GitHub echoed them back after the write. */
function loginList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (entry as Record<string, unknown> | null)?.login)
    .filter((login): login is string => typeof login === "string");
}

/** Label names as GitHub echoed them back after the write. */
function labelNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (entry as Record<string, unknown> | null)?.name)
    .filter((name): name is string => typeof name === "string");
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
  let body: { repo?: unknown; number?: unknown; state?: unknown; assignees?: unknown; labels?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = Number.parseInt(String(body.number ?? ""), 10);
  const state = body.state === "closed" ? "closed" : body.state === "open" ? "open" : null;
  const assignees = body.assignees === undefined ? null : stringList(body.assignees);
  const labels = body.labels === undefined ? null : stringList(body.labels);

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  // An empty PATCH would be a wasted write that reports success — the composer
  // should not be able to mistake "I changed nothing" for "I saved".
  if (body.state === undefined && body.assignees === undefined && body.labels === undefined) {
    return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }
  if (body.state !== undefined && !state) {
    return NextResponse.json({ ok: false, error: "invalid state" }, { status: 400 });
  }
  if (body.assignees !== undefined && !assignees) {
    return NextResponse.json({ ok: false, error: "invalid assignees" }, { status: 400 });
  }
  if (body.labels !== undefined && !labels) {
    return NextResponse.json({ ok: false, error: "invalid labels" }, { status: 400 });
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
      body: JSON.stringify({
        ...(state ? { state } : {}),
        ...(assignees ? { assignees } : {}),
        ...(labels ? { labels } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== "object") {
      // Pass GitHub's own reason through verbatim, like the merge and review
      // routes: on a 422 it names the offending assignee login or label, and
      // "github error (422)" gives the composer nothing actionable to show.
      const message =
        typeof (data as Record<string, unknown> | null)?.message === "string"
          ? String((data as Record<string, unknown>).message)
          : `github error (${res.status})`;
      return NextResponse.json(
        { ok: false, error: message },
        { status: res.status === 403 || res.status === 404 ? res.status : 502 },
      );
    }
    const d = data as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      issue: issuePayload(d),
      // Echo back only what was asked for, read off GitHub's response rather
      // than the request, so the card renders what actually landed.
      ...(assignees ? { assignees: loginList(d.assignees) } : {}),
      ...(labels ? { labels: labelNames(d.labels) } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to update issue" },
      { status: 502 },
    );
  }
}
