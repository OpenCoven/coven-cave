/**
 * /api/github/resolve-thread
 *
 * Resolves or unresolves a pull-request review thread via the GitHub GraphQL
 * mutations `resolveReviewThread` / `unresolveReviewThread`. The thread id is
 * the GraphQL node id surfaced by /api/github/comments.
 *
 * Requires a PAT — GraphQL has no unauthenticated tier. The PAT is read-only
 * from env, never echoed to the client, never logged.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";
import { upstreamFetch } from "@/lib/server/upstream-fetch";
import { ambiguousWrite, isRecord, resourceId } from "@/lib/server/upstream-answer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";

export async function POST(req: Request) {
  let body: { threadId?: unknown; resolved?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  // `resolved` is the DESIRED end state: true → resolve, false → unresolve.
  const resolved = body.resolved !== false;

  if (!threadId) {
    return NextResponse.json({ ok: false, error: "missing threadId" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const mutation = resolved
    ? `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }`
    : `mutation($id:ID!){ unresolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }`;

  try {
    const res = await upstreamFetch("github", `${GH}/graphql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ query: mutation, variables: { id: threadId } }),
    });
    const json = await res.json().catch(() => null);
    // The mutation was sent and GitHub answered 2xx; an unreadable answer
    // leaves the thread's state unconfirmed (#6368).
    if (res.ok && !isRecord(json)) return ambiguousWrite("GitHub", resolved ? "resolve" : "unresolve");
    if (!res.ok || json?.errors) {
      const msg = Array.isArray(json?.errors) && json.errors[0]?.message
        ? String(json.errors[0].message)
        : `github error (${res.status})`;
      return NextResponse.json({ ok: false, error: msg }, { status: res.status === 403 ? 403 : 502 });
    }
    const thread = resolved
      ? json?.data?.resolveReviewThread?.thread
      : json?.data?.unresolveReviewThread?.thread;
    // Success means GitHub reported the thread in the state we asked for.
    // A missing thread or state is unconfirmed; the opposite state is a
    // definite "it didn't take" (#6368).
    const id = isRecord(thread) ? resourceId(thread.id) : null;
    if (!isRecord(thread) || typeof thread.isResolved !== "boolean" || !id) {
      return ambiguousWrite("GitHub", resolved ? "resolve" : "unresolve");
    }
    if (thread.isResolved !== resolved) {
      return NextResponse.json(
        { ok: false, error: `GitHub reports the thread is still ${thread.isResolved ? "resolved" : "unresolved"}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, threadId: id, isResolved: thread.isResolved });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to resolve thread" },
      { status: 502 },
    );
  }
}
