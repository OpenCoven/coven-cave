import { NextResponse } from "next/server";
import { githubApiFailure } from "@/lib/github-activity";
import { resolveGitHubToken } from "@/lib/github-token";
import type { RepoItem } from "@/lib/home-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/github/repos → { ok, items: RepoItem[], source, configured }
 *
 * The home Repos feed leads with the OpenCoven org's repositories (fetched via
 * REST — fast + authoritative), then appends the user's curated GitHub star
 * list "opencoven-openclaw" (fetched via GraphQL, since star lists aren't in
 * REST; cached because the lists query is slow). A GitHub token is required —
 * GraphQL has no anonymous access — so without one we return an empty list with
 * `configured: false` and the UI prompts to add a token. If the slow star-list
 * query fails, the org repos still return. All query inputs are server
 * constants; no request input reaches the fetch.
 */

const ORG = "OpenCoven";
const LIST_OWNER = "BunsDev";
const LIST_SLUG = "opencoven-openclaw";
const PRIORITY_ORG = ORG.toLowerCase();
const MAX_ITEMS = 36;
const SOURCE_PAGE_SIZE = 100;
const ORG_TIMEOUT_MS = 6000;
const LIST_TIMEOUT_MS = 12000;
const TTL_MS = 15 * 60 * 1000;

const LIST_QUERY = `query {
  user(login: "${LIST_OWNER}") {
    lists(first: 20) {
      nodes {
        slug
        items(first: ${SOURCE_PAGE_SIZE}) {
          nodes {
            __typename
            ... on Repository {
              nameWithOwner
              name
              owner { login }
              description
              stargazerCount
              primaryLanguage { name }
              url
              pushedAt
            }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
}`;


type RestRepo = {
  id?: number;
  name?: string;
  full_name?: string;
  owner?: { login?: string };
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  html_url?: string;
  pushed_at?: string | null;
};

type GraphRepo = {
  __typename: string;
  nameWithOwner?: string;
  name?: string;
  owner?: { login?: string };
  description?: string | null;
  stargazerCount?: number;
  primaryLanguage?: { name?: string } | null;
  url?: string;
  pushedAt?: string | null;
};

type RepoSourceResult = {
  items: RepoItem[];
  error: string | null;
  hasMore: boolean;
};

function repoSourceError(res: Response, source: string): string {
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? -1);
  const failure = githubApiFailure({
    status: res.status,
    remaining,
    retryAfter: res.headers.get("retry-after"),
    rateLimitReset: res.headers.get("x-ratelimit-reset"),
  });
  if (failure.rateLimited || res.status === 401) return failure.message;
  return `Couldn't load ${source} (${res.status}).`;
}

function nextGitHubPagePath(link: string | null): string | null {
  const nextUrl = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  if (!nextUrl) return null;
  try {
    const parsed = new URL(nextUrl);
    return parsed.origin === "https://api.github.com" ? `${parsed.pathname}${parsed.search}` : null;
  } catch {
    return null;
  }
}

function restToItem(r: RestRepo): RepoItem | null {
  if (!r.full_name || !r.html_url) return null;
  return {
    id: r.full_name,
    name: r.name ?? r.full_name.split("/")[1] ?? r.full_name,
    owner: r.owner?.login ?? r.full_name.split("/")[0] ?? "",
    fullName: r.full_name,
    description: r.description ?? null,
    stars: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
    language: r.language ?? null,
    url: r.html_url,
    pushedAt: r.pushed_at ?? null,
  };
}

function graphToItem(r: GraphRepo | null): RepoItem | null {
  if (!r || r.__typename !== "Repository" || !r.nameWithOwner || !r.url) return null;
  return {
    id: r.nameWithOwner,
    name: r.name ?? r.nameWithOwner.split("/")[1] ?? r.nameWithOwner,
    owner: r.owner?.login ?? r.nameWithOwner.split("/")[0] ?? "",
    fullName: r.nameWithOwner,
    description: r.description ?? null,
    stars: typeof r.stargazerCount === "number" ? r.stargazerCount : 0,
    language: r.primaryLanguage?.name ?? null,
    url: r.url,
    pushedAt: r.pushedAt ?? null,
  };
}

const pushedTime = (r: RepoItem) => (r.pushedAt ? Date.parse(r.pushedAt) : 0);
const byPushedDesc = (a: RepoItem, b: RepoItem) => pushedTime(b) - pushedTime(a);

async function fetchOrgRepos(token: string): Promise<RepoSourceResult> {
  try {
    const res = await fetch(
      `https://api.github.com/orgs/${ORG}/repos?sort=pushed&per_page=${SOURCE_PAGE_SIZE}&type=public`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "coven-cave",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(ORG_TIMEOUT_MS),
      },
    );
    if (!res.ok) return { items: [], error: repoSourceError(res, "OpenCoven repositories"), hasMore: false };
    const raw = (await res.json()) as RestRepo[];
    if (!Array.isArray(raw)) {
      return {
        items: [],
        error: "GitHub returned an invalid OpenCoven repository response.",
        hasMore: false,
      };
    }
    return {
      items: raw.map(restToItem).filter((r): r is RepoItem => r !== null),
      error: null,
      hasMore: nextGitHubPagePath(res.headers.get("link")) !== null,
    };
  } catch {
    return { items: [], error: "Couldn't reach GitHub for OpenCoven repositories.", hasMore: false };
  }
}

async function fetchListRepos(token: string): Promise<RepoSourceResult> {
  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "coven-cave",
      },
      body: JSON.stringify({ query: LIST_QUERY }),
      cache: "no-store",
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { items: [], error: repoSourceError(res, "the curated repository list"), hasMore: false };
    }
    const json = (await res.json()) as {
      data?: {
        user?: {
          lists?: {
            nodes?: Array<{
              slug?: string;
              items?: {
                nodes?: Array<GraphRepo | null>;
                pageInfo?: { hasNextPage?: boolean };
              };
            }>;
          };
        };
      };
      errors?: unknown[];
    };
    const graphError = Array.isArray(json.errors) && json.errors.length > 0
      ? "GitHub couldn't fully load the curated repository list."
      : null;
    const lists = json.data?.user?.lists?.nodes ?? [];
    const list = lists.find((l) => l?.slug === LIST_SLUG);
    if (!list) {
      return {
        items: [],
        error: graphError ?? "GitHub didn't return the curated repository list.",
        hasMore: false,
      };
    }
    const nodes = list.items?.nodes ?? [];
    return {
      items: nodes.map(graphToItem).filter((r): r is RepoItem => r !== null),
      error: graphError,
      hasMore: list.items?.pageInfo?.hasNextPage === true,
    };
  } catch {
    return {
      items: [],
      error: "Couldn't reach GitHub for the curated repository list.",
      hasMore: false,
    };
  }
}

let cache: { at: number; items: RepoItem[]; hasMore: boolean } | null = null;

export async function GET(request: Request) {
  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({
      ok: true,
      items: [],
      source: "unconfigured",
      configured: false,
      incomplete: false,
      errors: [],
      scope: { mode: "curated", limit: MAX_ITEMS, hasMore: false },
    });
  }

  const now = Date.now();
  const refresh = new URL(request.url).searchParams.has("refresh");
  if (!refresh && cache && now - cache.at < TTL_MS) {
    return NextResponse.json({
      ok: true,
      items: cache.items,
      source: "curated",
      configured: true,
      incomplete: false,
      errors: [],
      scope: { mode: "curated", limit: MAX_ITEMS, hasMore: cache.hasMore },
    });
  }

  const [orgRepos, listRepos] = await Promise.all([fetchOrgRepos(token), fetchListRepos(token)]);

  // OpenCoven org repos lead (most-recently pushed first); then the rest of the
  // star list, OpenCoven-owned entries floated up, deduped against the org set.
  const seen = new Set<string>();
  const out: RepoItem[] = [];
  const push = (r: RepoItem) => {
    const key = r.fullName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  orgRepos.items.sort(byPushedDesc).forEach(push);
  listRepos.items
    .sort((a, b) => {
      const ao = a.owner.toLowerCase() === PRIORITY_ORG ? 0 : 1;
      const bo = b.owner.toLowerCase() === PRIORITY_ORG ? 0 : 1;
      return ao !== bo ? ao - bo : byPushedDesc(a, b);
    })
    .forEach(push);

  const items = out.slice(0, MAX_ITEMS);
  const hasMore = orgRepos.hasMore || listRepos.hasMore || out.length > items.length;
  const errors = [orgRepos.error, listRepos.error].filter((error): error is string => error !== null);
  // Only cache a non-empty result so a transient upstream blip isn't pinned.
  if (items.length > 0 && errors.length === 0) cache = { at: now, items, hasMore };
  return NextResponse.json({
    ok: true,
    items,
    source: "curated",
    configured: true,
    incomplete: errors.length > 0,
    errors,
    scope: { mode: "curated", limit: MAX_ITEMS, hasMore },
  });
}
