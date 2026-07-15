/**
 * /api/github/merge
 *
 * Merge a pull request (design docs/chat-github-integration.md §3, tier-2)
 * via REST `PUT /repos/{repo}/pulls/{number}/merge`. Branch-protection
 * semantics stay on GitHub's side — its guard errors ("required status
 * checks", "review required", "not mergeable") pass through VERBATIM so the
 * confirm card can show the real reason.
 *
 * Requires a PAT — never echoed, never logged.
 */

import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const METHODS = new Set(["squash", "merge", "rebase"]);

export async function POST(req: Request) {
  let body: { repo?: unknown; number?: unknown; method?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = Number.parseInt(String(body.number ?? ""), 10);
  const method = typeof body.method === "string" ? body.method : "squash";

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  if (!METHODS.has(method)) {
    return NextResponse.json({ ok: false, error: "invalid method" }, { status: 400 });
  }

  const token = resolveSecret("GITHUB_PAT") ?? null;
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/pulls/${number}/merge`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ merge_method: method }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data || data.merged !== true) {
      // 405/409 carry GitHub's protection/mergeability reason — pass verbatim.
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return NextResponse.json({ ok: false, error: message }, { status: res.status === 403 ? 403 : 502 });
    }
    return NextResponse.json({ ok: true, merged: true, sha: typeof data.sha === "string" ? data.sha : null });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to merge" },
      { status: 502 },
    );
  }
}
