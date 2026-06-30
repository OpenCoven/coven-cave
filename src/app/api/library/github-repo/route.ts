/**
 * GET /api/library/github-repo?repo=<owner/name|github url>
 *
 * Returns repository metadata + README markdown for the Library's inline repo
 * reader. Public repos work without a token; GITHUB_TOKEN / GH_TOKEN (when set)
 * lifts the anonymous rate limit. All fetching + parsing lives in
 * src/lib/github-repo.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchRepoOverview } from "@/lib/github-repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo")?.trim();
  if (!repo) {
    return NextResponse.json({ ok: false, error: "Missing ?repo parameter." }, { status: 400 });
  }

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
  const result = await fetchRepoOverview(repo, { token });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, meta: result.meta, readme: result.readme, readmeHtml: result.readmeHtml });
}
