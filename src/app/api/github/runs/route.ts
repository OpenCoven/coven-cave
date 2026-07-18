/**
 * /api/github/runs
 *
 * Recent GitHub Actions workflow runs for a repo (optionally filtered to a
 * branch) so chat run cards and the stage layer can hydrate (design:
 * docs/chat-github-integration.md §2-3). Read-only; workflow_dispatch lands
 * separately with the tier-2 confirm layer (W2b).
 *
 * Auth mirrors /api/github/item: PAT when present, else the public API.
 */

import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
// Branch names interpolate into a query string — allow the safe common charset
// and refuse anything that could smuggle extra query parameters.
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,255}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = (url.searchParams.get("repo") ?? "").trim();
  const branch = (url.searchParams.get("branch") ?? "").trim();

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (branch && !BRANCH_RE.test(branch)) {
    return NextResponse.json({ ok: false, error: "invalid branch" }, { status: 400 });
  }

  const token = resolveSecret("GITHUB_PAT") ?? null;

  try {
    // repo passed REPO_RE; branch passed BRANCH_RE and is URL-encoded.
    const qs = branch ? `?per_page=20&branch=${encodeURIComponent(branch)}` : "?per_page=20";
    const res = await fetch(`${GH}/repos/${repo}/actions/runs${qs}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    });
    if (res.status === 404) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    const data = (await res.json().catch(() => null)) as { workflow_runs?: unknown[] } | null;
    if (!res.ok || !data || typeof data !== "object") {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 ? 403 : 502 },
      );
    }

    const raw = Array.isArray(data.workflow_runs) ? (data.workflow_runs as Array<Record<string, unknown>>) : [];
    return NextResponse.json({
      ok: true,
      authed: Boolean(token),
      runs: raw.map((r) => ({
        id: Number(r.id ?? 0),
        name: typeof r.name === "string" ? r.name : "workflow",
        runNumber: Number(r.run_number ?? 0),
        status: String(r.status ?? "queued"),
        conclusion: typeof r.conclusion === "string" ? r.conclusion : null,
        branch: typeof r.head_branch === "string" ? r.head_branch : null,
        event: typeof r.event === "string" ? r.event : null,
        createdAt: typeof r.created_at === "string" ? r.created_at : null,
        htmlUrl: typeof r.html_url === "string" ? r.html_url : null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load runs" },
      { status: 502 },
    );
  }
}
