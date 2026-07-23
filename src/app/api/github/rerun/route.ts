/**
 * /api/github/rerun
 *
 * Re-run a workflow run (design docs/chat-github-integration.md §3, tier-2):
 * `POST /repos/{repo}/actions/runs/{id}/rerun-failed-jobs` when failedOnly
 * (the default — re-running green jobs wastes CI), else `/rerun`.
 *
 * Requires a PAT — never echoed, never logged.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export async function POST(req: Request) {
  let body: { repo?: unknown; runId?: unknown; failedOnly?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const runId = Number.parseInt(String(body.runId ?? ""), 10);
  const failedOnly = body.failedOnly !== false;

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid runId" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and runId is a positive integer — safe to interpolate.
    const path = failedOnly ? "rerun-failed-jobs" : "rerun";
    const res = await fetch(`${GH}/repos/${repo}/actions/runs/${runId}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return NextResponse.json({ ok: false, error: message }, { status: res.status === 403 ? 403 : 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to re-run" },
      { status: 502 },
    );
  }
}
