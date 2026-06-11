import { NextResponse } from "next/server";
import type { GitHubItem } from "@/lib/github-tasks";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function extractRepo(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  } catch {
    // ignore
  }
  return "";
}

type RawGitHubItem = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  updated_at: string;
  draft?: boolean;
  labels?: Array<{ name: string }>;
  pull_request?: unknown;
  repository?: { full_name: string };
};

type SearchResult = {
  items: RawGitHubItem[];
};

function resolveGitHubToken(): string | undefined {
  return (
    resolveSecret("GITHUB_PAT") ??
    process.env.GITHUB_TOKEN?.trim() ??
    process.env.COVEN_GITHUB_TOKEN?.trim()
  );
}

export async function GET() {
  const token = resolveGitHubToken();

  if (!token) {
    return NextResponse.json({ ok: true, items: [], configured: false });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    const [assignedRes, reviewRes, createdRes] = await Promise.all([
      fetch("https://api.github.com/issues?filter=assigned&state=open&per_page=50", { headers }),
      fetch("https://api.github.com/search/issues?q=is:open+is:pr+review-requested:@me&per_page=30", { headers }),
      fetch("https://api.github.com/search/issues?q=is:open+is:pr+author:@me&per_page=30", { headers }),
    ]);

    if (!assignedRes.ok || !reviewRes.ok || !createdRes.ok) {
      const failedStatus = !assignedRes.ok
        ? assignedRes.status
        : !reviewRes.ok
          ? reviewRes.status
          : createdRes.status;
      return NextResponse.json(
        { ok: false, error: `GitHub API error: HTTP ${failedStatus}`, items: [] },
        { status: 502 },
      );
    }

    const [assignedData, reviewData, createdData] = await Promise.all([
      assignedRes.json() as Promise<RawGitHubItem[]>,
      reviewRes.json() as Promise<SearchResult>,
      createdRes.json() as Promise<SearchResult>,
    ]);

    const assignedItems: GitHubItem[] = (Array.isArray(assignedData) ? assignedData : []).map(
      (item) => ({
        id: String(item.id),
        kind: item.pull_request ? ("pr" as const) : ("issue" as const),
        repo: item.repository?.full_name ?? "",
        number: item.number,
        title: item.title,
        url: item.html_url,
        state: item.state,
        updatedAt: item.updated_at,
        labels: item.labels?.map((l) => l.name) ?? [],
        draft: item.draft ?? false,
      }),
    );

    const reviewItems: GitHubItem[] = (reviewData?.items ?? []).map((item) => ({
      id: String(item.id),
      kind: "review_request" as const,
      repo: extractRepo(item.html_url),
      number: item.number,
      title: item.title,
      url: item.html_url,
      state: item.state,
      updatedAt: item.updated_at,
      labels: item.labels?.map((l) => l.name) ?? [],
    }));

    const createdItems: GitHubItem[] = (createdData?.items ?? []).map((item) => ({
      id: String(item.id),
      kind: "pr" as const,
      repo: extractRepo(item.html_url),
      number: item.number,
      title: item.title,
      url: item.html_url,
      state: item.state,
      updatedAt: item.updated_at,
      labels: item.labels?.map((l) => l.name) ?? [],
    }));

    // De-duplicate by url (keep first occurrence), then sort by updatedAt desc
    const seen = new Set<string>();
    const all: GitHubItem[] = [];
    for (const item of [...assignedItems, ...reviewItems, ...createdItems]) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        all.push(item);
      }
    }
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return NextResponse.json({ ok: true, items: all, configured: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message, items: [] }, { status: 502 });
  }
}
