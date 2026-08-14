import { NextResponse } from "next/server";
import type { GitHubItem } from "@/lib/github-tasks";
import { resolveGitHubToken } from "@/lib/github-token";
import {
  failedSource,
  isPartial,
  isTruncated,
  restSource,
  searchSource,
  type AssignedSourceMeta,
  type AssignedSourcesMeta,
} from "@/lib/github-assigned-meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ASSIGNED_PER_PAGE = 50;
const SEARCH_PER_PAGE = 30;

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
  total_count?: number;
  items: RawGitHubItem[];
};

/**
 * One capped source, fetched fault-isolated (cave-amx2m): a non-auth failure
 * removes ONE source from the list instead of failing the whole response, and
 * the returned meta says so — the picker must never dress a half-loaded list
 * as a definitive empty. A 401 anywhere still aborts the aggregate via
 * `unauthorized` (the stored PAT is dead for every source alike).
 */
async function fetchSource<T>(
  url: string,
  headers: Record<string, string>,
  parse: (body: T, linkHeader: string | null) => { items: GitHubItem[]; meta: AssignedSourceMeta },
): Promise<{ items: GitHubItem[]; meta: AssignedSourceMeta; unauthorized?: boolean }> {
  try {
    const res = await fetch(url, { headers });
    if (res.status === 401) return { items: [], meta: failedSource("HTTP 401"), unauthorized: true };
    if (!res.ok) return { items: [], meta: failedSource(`GitHub API error: HTTP ${res.status}`) };
    const body = (await res.json()) as T;
    return parse(body, res.headers.get("link"));
  } catch (err) {
    return { items: [], meta: failedSource(err instanceof Error ? err.message : "fetch failed") };
  }
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

  const [assigned, review, created] = await Promise.all([
    fetchSource<RawGitHubItem[]>(
      `https://api.github.com/issues?filter=assigned&state=open&per_page=${ASSIGNED_PER_PAGE}`,
      headers,
      (body, linkHeader) => {
        const rows = Array.isArray(body) ? body : [];
        const items: GitHubItem[] = rows.map((item) => ({
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
        }));
        return { items, meta: restSource(items.length, ASSIGNED_PER_PAGE, linkHeader) };
      },
    ),
    fetchSource<SearchResult>(
      `https://api.github.com/search/issues?q=is:open+is:pr+review-requested:@me&per_page=${SEARCH_PER_PAGE}`,
      headers,
      (body) => {
        const items: GitHubItem[] = (body?.items ?? []).map((item) => ({
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
        return { items, meta: searchSource(items.length, body?.total_count) };
      },
    ),
    fetchSource<SearchResult>(
      `https://api.github.com/search/issues?q=is:open+is:pr+author:@me&per_page=${SEARCH_PER_PAGE}`,
      headers,
      (body) => {
        const items: GitHubItem[] = (body?.items ?? []).map((item) => ({
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
        return { items, meta: searchSource(items.length, body?.total_count) };
      },
    ),
  ]);

  if (assigned.unauthorized || review.unauthorized || created.unauthorized) {
    // The stored PAT was rejected (revoked/expired) — flag it so the
    // client reopens the connect form instead of pinning a raw 401
    // against a form gated on configured===false (cave-cjgg/cave-d6zq).
    return NextResponse.json(
      { ok: false, error: "GitHub rejected the stored token (revoked or expired).", items: [], configured: true, patInvalid: true },
      { status: 200 },
    );
  }

  const sources: AssignedSourcesMeta = {
    assigned: assigned.meta,
    reviewRequested: review.meta,
    authored: created.meta,
  };

  // Every source down = the old total-failure path: the caller gets an error,
  // never a plausible-looking empty list.
  if (!assigned.meta.ok && !review.meta.ok && !created.meta.ok) {
    return NextResponse.json(
      { ok: false, error: assigned.meta.error ?? "GitHub API error", items: [], sources },
      { status: 502 },
    );
  }

  // De-duplicate by url (keep first occurrence), then sort by updatedAt desc
  const seen = new Set<string>();
  const all: GitHubItem[] = [];
  for (const item of [...assigned.items, ...review.items, ...created.items]) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      all.push(item);
    }
  }
  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return NextResponse.json({
    ok: true,
    items: all,
    configured: true,
    sources,
    partial: isPartial(sources),
    truncated: isTruncated(sources),
  });
}
