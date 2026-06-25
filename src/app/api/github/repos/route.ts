import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";
import type { RepoItem } from "@/lib/home-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/github/repos → { ok, items: RepoItem[], source, configured }
 *
 * With a GitHub token: your most recently pushed repositories. Without one:
 * falls back to a small set of trending (most-starred) public repos via the
 * unauthenticated search API, so the home Repos feed is never empty. All
 * requested URLs are constant — no request-driven input reaches the fetch.
 */

const FETCH_TIMEOUT_MS = 6000;
const PER_PAGE = 12;

function resolveGitHubToken(): string | undefined {
  return (
    resolveSecret("GITHUB_PAT") ??
    process.env.GITHUB_TOKEN?.trim() ??
    process.env.COVEN_GITHUB_TOKEN?.trim()
  );
}

type RawRepo = {
  id: number;
  name: string;
  full_name: string;
  owner?: { login?: string };
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  html_url: string;
  pushed_at?: string | null;
};

function toItem(r: RawRepo): RepoItem {
  return {
    id: r.full_name || String(r.id),
    name: r.name,
    owner: r.owner?.login ?? r.full_name.split("/")[0] ?? "",
    fullName: r.full_name,
    description: r.description ?? null,
    stars: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
    language: r.language ?? null,
    url: r.html_url,
    pushedAt: r.pushed_at ?? null,
  };
}

export async function GET() {
  const token = resolveGitHubToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "coven-cave/repos",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    if (token) {
      const res = await fetch(
        "https://api.github.com/user/repos?sort=pushed&per_page=12&affiliation=owner,collaborator,organization_member",
        { headers, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (res.ok) {
        const raw = (await res.json()) as RawRepo[];
        const items = Array.isArray(raw) ? raw.slice(0, PER_PAGE).map(toItem) : [];
        return NextResponse.json({ ok: true, items, source: "yours", configured: true });
      }
      // Token present but request failed (bad/expired) — fall through to trending.
    }

    const res = await fetch(
      "https://api.github.com/search/repositories?q=stars:%3E50000&sort=stars&order=desc&per_page=12",
      { headers, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) {
      return NextResponse.json({ ok: true, items: [], source: "trending", configured: !!token });
    }
    const json = (await res.json()) as { items?: RawRepo[] };
    const items = Array.isArray(json.items) ? json.items.slice(0, PER_PAGE).map(toItem) : [];
    return NextResponse.json({ ok: true, items, source: "trending", configured: !!token });
  } catch {
    return NextResponse.json({ ok: true, items: [], source: "trending", configured: !!token });
  }
}
