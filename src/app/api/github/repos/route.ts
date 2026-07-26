import { NextResponse } from "next/server";
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
const ORG_TIMEOUT_MS = 6000;
const LIST_TIMEOUT_MS = 12000;
const TTL_MS = 15 * 60 * 1000;

const LIST_QUERY = `query {
  user(login: "${LIST_OWNER}") {
    lists(first: 20) {
      nodes {
        slug
        items(first: 30) {
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

function graphToItem(r: GraphRepo): RepoItem | null {
  if (r.__typename !== "Repository" || !r.nameWithOwner || !r.url) return null;
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

async function fetchOrgRepos(token: string): Promise<RepoItem[]> {
  try {
    const res = await fetch(
      `https://api.github.com/orgs/${ORG}/repos?sort=pushed&per_page=30&type=public`,
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
    if (!res.ok) return [];
    const raw = (await res.json()) as RestRepo[];
    return Array.isArray(raw) ? raw.map(restToItem).filter((r): r is RepoItem => r !== null) : [];
  } catch {
    return [];
  }
}

async function fetchListRepos(token: string): Promise<RepoItem[]> {
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
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { user?: { lists?: { nodes?: Array<{ slug?: string; items?: { nodes?: GraphRepo[] } }> } } };
    };
    const lists = json.data?.user?.lists?.nodes ?? [];
    const list = lists.find((l) => l?.slug === LIST_SLUG);
    return (list?.items?.nodes ?? []).map(graphToItem).filter((r): r is RepoItem => r !== null);
  } catch {
    return [];
  }
}

let cache: { at: number; items: RepoItem[] } | null = null;

export async function GET() {
  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: true, items: [], source: "unconfigured", configured: false });
  }

  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ ok: true, items: cache.items, source: "list", configured: true });
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
  orgRepos.sort(byPushedDesc).forEach(push);
  listRepos
    .sort((a, b) => {
      const ao = a.owner.toLowerCase() === PRIORITY_ORG ? 0 : 1;
      const bo = b.owner.toLowerCase() === PRIORITY_ORG ? 0 : 1;
      return ao !== bo ? ao - bo : byPushedDesc(a, b);
    })
    .forEach(push);

  const items = out.slice(0, MAX_ITEMS);
  // Only cache a non-empty result so a transient upstream blip isn't pinned.
  if (items.length > 0) cache = { at: now, items };
  return NextResponse.json({ ok: true, items, source: "list", configured: true });
}
