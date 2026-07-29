/**
 * /api/github/reactions
 *
 * Reactions on an issue or pull request, so a card can show resting reaction
 * chips and let you toggle your own:
 *   - GET    — the tally per content, plus `mine` (your reaction's id) so the
 *              client has the handle DELETE needs. GET works unauthenticated;
 *              without a PAT every `mine` is null, i.e. nothing looks toggled.
 *   - POST   — add a reaction {repo, number, content}
 *   - DELETE — remove one {repo, number, reactionId}
 *
 * The `content` enum is GitHub's exact eight values — anything else is a 400
 * here rather than a 422 round-trip. Writes require a PAT; it is read from the
 * vault/env, never echoed to the client, never logged.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";

// owner/name — exactly one slash, each segment a safe GitHub identifier. This
// is the barrier that keeps the value safe to interpolate into the API path.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

// GitHub's complete reaction set. Not a superset: an unlisted value is a 422.
const CONTENTS = new Set(["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"]);

type ReactionTally = { content: string; count: number; mine: number | null };

function ghHeaders(token: string | null): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** The authenticated login, or null — best-effort, so a failure only costs `mine`. */
async function viewerLogin(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${GH}/user`, { headers: ghHeaders(token), cache: "no-store" });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || typeof data?.login !== "string") return null;
    return data.login;
  } catch {
    return null;
  }
}

/** Shared repo/number parsing for all three verbs. */
function target(repo: string, numberRaw: unknown): { repo: string; number: number } | Response {
  const number = Number.parseInt(String(numberRaw ?? ""), 10);
  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  return { repo, number };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = target((url.searchParams.get("repo") ?? "").trim(), url.searchParams.get("number"));
  if (parsed instanceof Response) return parsed;
  const { repo, number } = parsed;

  const token = resolveGitHubToken();

  try {
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    const [res, login] = await Promise.all([
      fetch(`${GH}/repos/${repo}/issues/${number}/reactions?per_page=100`, {
        headers: ghHeaders(token),
        cache: "no-store",
      }),
      token ? viewerLogin(token) : Promise.resolve(null),
    ]);
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 401 || res.status === 403 ? res.status : 502 },
      );
    }

    // Aggregate by content, remembering the id of the viewer's own row: the
    // DELETE endpoint addresses a reaction by id, not by content.
    const byContent = new Map<string, ReactionTally>();
    for (const entry of data as Array<Record<string, unknown>>) {
      const content = typeof entry.content === "string" ? entry.content : null;
      if (!content) continue;
      const tally = byContent.get(content) ?? { content, count: 0, mine: null };
      tally.count += 1;
      const author = (entry.user as Record<string, unknown> | null)?.login;
      if (login && author === login && typeof entry.id === "number") tally.mine = entry.id;
      byContent.set(content, tally);
    }

    return NextResponse.json({ ok: true, reactions: [...byContent.values()] });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load reactions" },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  let body: { repo?: unknown; number?: unknown; content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const parsed = target(typeof body.repo === "string" ? body.repo.trim() : "", body.number);
  if (parsed instanceof Response) return parsed;
  const { repo, number } = parsed;
  const content = typeof body.content === "string" ? body.content : "";

  if (!CONTENTS.has(content)) {
    return NextResponse.json({ ok: false, error: "invalid content" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/issues/${number}/reactions`, {
      method: "POST",
      headers: ghHeaders(token),
      cache: "no-store",
      body: JSON.stringify({ content }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    // 200 (already reacted) and 201 (created) are both the desired end state.
    if (!res.ok || !data) {
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return NextResponse.json({ ok: false, error: message }, { status: res.status === 403 ? 403 : 502 });
    }
    return NextResponse.json({
      ok: true,
      reaction: {
        id: typeof data.id === "number" ? data.id : null,
        content: typeof data.content === "string" ? data.content : content,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to add reaction" },
      { status: 502 },
    );
  }
}

export async function DELETE(req: Request) {
  let body: { repo?: unknown; number?: unknown; reactionId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const parsed = target(typeof body.repo === "string" ? body.repo.trim() : "", body.number);
  if (parsed instanceof Response) return parsed;
  const { repo, number } = parsed;
  const reactionId = Number.parseInt(String(body.reactionId ?? ""), 10);

  if (!Number.isInteger(reactionId) || reactionId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid reactionId" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE; number and reactionId are positive integers — all
    // safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/issues/${number}/reactions/${reactionId}`, {
      method: "DELETE",
      headers: ghHeaders(token),
      cache: "no-store",
    });
    // 204 on success, and 404 means it is already gone — the end state either way.
    if (!res.ok && res.status !== 404) {
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return NextResponse.json({ ok: false, error: message }, { status: res.status === 403 ? 403 : 502 });
    }
    return NextResponse.json({ ok: true, deleted: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to remove reaction" },
      { status: 502 },
    );
  }
}
