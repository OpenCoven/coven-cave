/**
 * /api/github/activity
 *
 * Returns the authenticated user's live GitHub activity.
 *
 * Auth tiers (tried in order):
 *   1. GITHUB_PAT — user's own PAT, stored in .env.local only, or a
 *      GITHUB_TOKEN/COVEN_GITHUB_TOKEN supplied by an installed harness.
 *      Tokens are NEVER committed, shared, or logged.
 *   2. Public unauthenticated GitHub API — rate-limited to 60 req/hr.
 *      Only public data accessible. Username must be provided via
 *      GITHUB_USERNAME env var or inferred from the PAT if present.
 *
 * The PAT is read-only from env. It is never returned to the client,
 * never written to any log, and never forwarded anywhere except
 * api.github.com over HTTPS.
 */

import { NextResponse } from "next/server";
import {
  GITHUB_ACTIVITY_PAGE_SIZE,
  activityCollectionFailure,
  activityCollectionFromSearch,
  activityCollectionUnavailable,
  githubApiFailure,
  type ActivityCollection,
  type ActivityCollections,
  type GitHubApiFailure,
} from "@/lib/github-activity";
import { resolveGitHubToken } from "@/lib/github-token";
import { summarizeChecks, type CheckSummary } from "@/lib/github-checks";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
// Cap per-PR check enrichment so a long PR list can't blow the rate budget.
const CHECK_ENRICH_CAP = 15;
const CHECK_ENRICH_CONCURRENCY = 3;

type GitHubItem = {
  kind: "pr" | "issue" | "review_request" | "notification";
  id: string;
  title: string;
  repo: string;
  number?: number;
  url: string;
  state?: string;
  updatedAt: string;
  draft?: boolean;
  labels?: string[];
  checkStatus?: CheckSummary;
};

/**
 * Best-effort CI rollup for one PR: resolve the head SHA, read its check-runs
 * (falling back to the legacy combined status), and summarize. Any failure
 * returns null so the row simply renders without a pip. Uses core REST quota,
 * so callers must gate this behind a token (the public 60/hr budget can't
 * absorb it).
 */
type PrCheckResult = {
  summary: CheckSummary;
  failure: GitHubApiFailure | null;
};

async function fetchPrChecks(
  repo: string,
  number: number,
  token: string | null,
  signal: AbortSignal,
): Promise<PrCheckResult> {
  try {
    const pull = await ghFetch(`/repos/${repo}/pulls/${number}`, token, signal);
    const pullFailure = responseRateLimitFailure(pull);
    if (pullFailure) return { summary: null, failure: pullFailure };
    const sha = (pull.data as { head?: { sha?: string } } | null)?.head?.sha;
    if (!pull.res.ok || !sha) return { summary: null, failure: null };

    const checks = await ghFetch(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`, token, signal);
    const checksFailure = responseRateLimitFailure(checks);
    if (checksFailure) return { summary: null, failure: checksFailure };
    const runs = ((checks.data as { check_runs?: unknown[] } | null)?.check_runs ?? []) as Array<{
      status?: string;
      conclusion?: string;
    }>;
    if (checks.res.ok && runs.length > 0) {
      return { summary: summarizeChecks(runs), failure: null };
    }

    const status = await ghFetch(`/repos/${repo}/commits/${sha}/status`, token, signal);
    const statusFailure = responseRateLimitFailure(status);
    if (statusFailure) return { summary: null, failure: statusFailure };
    if (!status.res.ok) return { summary: null, failure: null };
    return {
      summary: summarizeChecks([], (status.data as { state?: string } | null)?.state),
      failure: null,
    };
  } catch {
    return { summary: null, failure: null };
  }
}

type ActivityResult = {
  ok: true;
  authed: boolean;       // true = a WORKING PAT was used; false = public API
  /** The stored PAT was rejected by GitHub (revoked/expired). The client must
   *  surface this — silently falling back rendered an authed-looking empty
   *  state over a dead token (cave-cjgg). */
  patInvalid?: boolean;
  login: string | null;
  /** Organizations visible to the authenticated token. Unlike activity items,
   * these remain useful even when no open work exists in an organization. */
  organizations: string[];
  collections: ActivityCollections;
  items: GitHubItem[];
  rateLimit: { remaining: number; limit: number } | null;
  warning?: string;
  retryAfterSeconds?: number;
};

type SearchPayload = {
  items?: unknown[];
  total_count?: number;
  incomplete_results?: boolean;
};

function githubResponseMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("message" in data)) return null;
  return typeof data.message === "string" ? data.message : null;
}

async function ghFetch(path: string, token: string | null, signal?: AbortSignal) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${GH}${path}`, { headers, cache: "no-store", signal });
  const rateRemaining = Number(res.headers.get("x-ratelimit-remaining") ?? -1);
  const rateLimit = Number(res.headers.get("x-ratelimit-limit") ?? -1);
  const retryAfter = res.headers.get("retry-after");
  const rateLimitReset = res.headers.get("x-ratelimit-reset");
  const data = await res.json().catch(() => null);
  return { res, data, rateRemaining, rateLimit, retryAfter, rateLimitReset };
}

type GitHubFetchResult = Awaited<ReturnType<typeof ghFetch>>;

function responseRateLimitFailure(result: GitHubFetchResult): GitHubApiFailure | null {
  if (result.res.ok) return null;
  const failure = githubApiFailure({
    status: result.res.status,
    remaining: result.rateRemaining,
    retryAfter: result.retryAfter,
    rateLimitReset: result.rateLimitReset,
    responseMessage: githubResponseMessage(result.data),
  });
  return failure.rateLimited ? failure : null;
}

type ActivitySearchResult = {
  items: Array<Record<string, unknown>>;
  collection: ActivityCollection;
  rateRemaining: number;
  rateLimit: number;
  failure: GitHubApiFailure | null;
};

async function fetchActivitySearch(query: string, token: string | null): Promise<ActivitySearchResult> {
  try {
    const { res, data, rateRemaining, rateLimit, retryAfter, rateLimitReset } = await ghFetch(
      `/search/issues?q=${query}&per_page=${GITHUB_ACTIVITY_PAGE_SIZE}&sort=updated`,
      token,
    );
    if (!res.ok) {
      const failure = githubApiFailure({
        status: res.status,
        remaining: rateRemaining,
        retryAfter,
        rateLimitReset,
        responseMessage: githubResponseMessage(data),
      });
      return {
        items: [],
        collection: activityCollectionFailure(failure.message, failure.retryAfterSeconds),
        rateRemaining,
        rateLimit,
        failure,
      };
    }

    const payload = data as SearchPayload | null;
    if (!payload || !Array.isArray(payload.items) || typeof payload.total_count !== "number") {
      return {
        items: [],
        collection: activityCollectionFailure("GitHub search returned an invalid response."),
        rateRemaining,
        rateLimit,
        failure: null,
      };
    }

    const items = payload.items.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
    );
    return {
      items,
      collection: activityCollectionFromSearch({
        shown: items.length,
        total: payload.total_count,
        githubIncomplete: payload.incomplete_results === true,
      }),
      rateRemaining,
      rateLimit,
      failure: null,
    };
  } catch {
    return {
      items: [],
      collection: activityCollectionFailure("Couldn't reach GitHub search."),
      rateRemaining: -1,
      rateLimit: -1,
      failure: null,
    };
  }
}


function nextGitHubPagePath(link: string | null): string | null {
  const nextUrl = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  if (!nextUrl) return null;
  try {
    const parsed = new URL(nextUrl);
    return parsed.origin === GH ? `${parsed.pathname}${parsed.search}` : null;
  } catch {
    return null;
  }
}

/**
 * The activity searches below only describe current work. Fetch memberships
 * separately so an organization selector represents the account's scope, not
 * whichever organizations happen to have an open item today.
 */
type OrganizationResult = {
  organizations: string[];
  failure: GitHubApiFailure | null;
};

async function fetchOrganizations(token: string): Promise<OrganizationResult> {
  const organizations = new Set<string>();
  try {
    let path: string | null = "/user/orgs?per_page=100";
    while (path) {
      const { res, data, rateRemaining, retryAfter, rateLimitReset } = await ghFetch(path, token);
      if (!res.ok) {
        return {
          organizations: Array.from(organizations).sort((a, b) => a.localeCompare(b)),
          failure: githubApiFailure({
            status: res.status,
            remaining: rateRemaining,
            retryAfter,
            rateLimitReset,
            responseMessage: githubResponseMessage(data),
          }),
        };
      }
      if (!Array.isArray(data)) {
        return {
          organizations: Array.from(organizations).sort((a, b) => a.localeCompare(b)),
          failure: {
            message: "GitHub returned an invalid organization response.",
            rateLimited: false,
            retryAfterSeconds: null,
          },
        };
      }
      data
        .map((org) => typeof org?.login === "string" ? org.login : "")
        .filter(Boolean)
        .forEach((org) => organizations.add(org));
      path = nextGitHubPagePath(res.headers.get("link"));
    }
    return {
      organizations: Array.from(organizations).sort((a, b) => a.localeCompare(b)),
      failure: null,
    };
  } catch {
    // Memberships improve the selector but must not make activity unavailable.
    return {
      organizations: Array.from(organizations).sort((a, b) => a.localeCompare(b)),
      failure: {
        message: "Couldn't reach GitHub for organization memberships.",
        rateLimited: false,
        retryAfterSeconds: null,
      },
    };
  }
}

export async function GET() {
  // PAT is strictly local — read from env, never echoed back
  const storedToken = resolveGitHubToken();
  const envLogin = resolveSecret("GITHUB_USERNAME") ?? null;

  // ── Resolve login ────────────────────────────────────────────────────────
  let login: string | null = envLogin;
  let rateInfo: { remaining: number; limit: number } | null = null;
  let patInvalid = false;
  let identityFailure: GitHubApiFailure | null = null;

  if (storedToken) {
    try {
      const { res, data, rateRemaining, rateLimit, retryAfter, rateLimitReset } = await ghFetch("/user", storedToken);
      if (res.status === 401) {
        // GitHub rejected the stored PAT (revoked/expired). Flag it and stop
        // sending it — every downstream search would just 401 into empty
        // arrays, rendering a convincing "nothing open" (cave-cjgg).
        patInvalid = true;
      } else if (!res.ok) {
        identityFailure = githubApiFailure({
          status: res.status,
          remaining: rateRemaining,
          retryAfter,
          rateLimitReset,
          responseMessage: githubResponseMessage(data),
        });
      }
      login = data?.login ?? login;
      if (rateRemaining >= 0) rateInfo = { remaining: rateRemaining, limit: rateLimit };
    } catch {
      identityFailure = {
        message: "Couldn't reach GitHub to identify the configured account.",
        rateLimited: false,
        retryAfterSeconds: null,
      };
    }
  }
  const token = patInvalid ? null : storedToken;

  if (identityFailure?.rateLimited) {
    return NextResponse.json(
      {
        ok: false,
        error: identityFailure.message,
        retryAfterSeconds: identityFailure.retryAfterSeconds,
      },
      {
        status: 429,
        headers: identityFailure.retryAfterSeconds === null
          ? undefined
          : { "Retry-After": String(identityFailure.retryAfterSeconds) },
      },
    );
  }

  if (!login && patInvalid) {
    const unavailable = activityCollectionUnavailable();
    return NextResponse.json({
      ok: true,
      authed: false,
      patInvalid: true,
      login: null,
      organizations: [],
      collections: {
        authored: unavailable,
        reviewRequests: unavailable,
        assignedIssues: unavailable,
      },
      items: [],
      rateLimit: rateInfo,
    } satisfies ActivityResult);
  }

  if (!login && identityFailure) {
    return NextResponse.json(
      {
        ok: false,
        error: identityFailure.message,
        retryAfterSeconds: identityFailure.retryAfterSeconds,
      },
      {
        status: identityFailure.rateLimited ? 429 : 502,
        headers: identityFailure.retryAfterSeconds === null
          ? undefined
          : { "Retry-After": String(identityFailure.retryAfterSeconds) },
      },
    );
  }

  if (!login) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_user",
        hint: "Set GITHUB_USERNAME in .env.local to use the public API, or GITHUB_PAT for full access.",
      },
      { status: 401 },
    );
  }

  const items: GitHubItem[] = [];
  const organizationResult = token
    ? await fetchOrganizations(token)
    : { organizations: [], failure: null };
  if (organizationResult.failure?.rateLimited) {
    return NextResponse.json(
      {
        ok: false,
        error: organizationResult.failure.message,
        retryAfterSeconds: organizationResult.failure.retryAfterSeconds,
      },
      {
        status: 429,
        headers: organizationResult.failure.retryAfterSeconds === null
          ? undefined
          : { "Retry-After": String(organizationResult.failure.retryAfterSeconds) },
      },
    );
  }
  const organizations = organizationResult.organizations;
  const recordRateInfo = (search: ActivitySearchResult) => {
    if (search.rateRemaining >= 0) {
      rateInfo = { remaining: search.rateRemaining, limit: search.rateLimit };
    }
  };

  // ── Open PRs authored by user ─────────────────────────────────────────────
  const authored = await fetchActivitySearch(`is:pr+is:open+author:${login}`, token);
  recordRateInfo(authored);
  let cooldownFailure = authored.failure?.rateLimited ? authored.failure : null;
  for (const p of authored.items) {
    const repoUrl = (p.repository_url as string | undefined) ?? "";
    const repo = repoUrl.replace("https://api.github.com/repos/", "");
    items.push({
      kind: "pr",
      id: `pr-${p.id}`,
      title: String(p.title ?? ""),
      repo,
      number: Number(p.number),
      url: String(p.html_url ?? ""),
      state: String(p.state ?? "open"),
      updatedAt: String(p.updated_at ?? new Date().toISOString()),
      draft: Boolean(p.draft),
      labels: ((p.labels as { name: string }[] | undefined) ?? []).map((l) => l.name),
    });
  }

  // ── PRs requesting review from user (needs token for private repos) ───────
  let reviewRequests: ActivitySearchResult | null = null;
  if (!cooldownFailure && token) {
    reviewRequests = await fetchActivitySearch(`is:pr+is:open+review-requested:${login}`, token);
    recordRateInfo(reviewRequests);
    if (reviewRequests.failure?.rateLimited) cooldownFailure = reviewRequests.failure;
    for (const p of reviewRequests.items) {
      const repoUrl = (p.repository_url as string | undefined) ?? "";
      const repo = repoUrl.replace("https://api.github.com/repos/", "");
      // avoid duplicates (already in authored list)
      if (items.some((i) => i.id === `pr-${p.id}`)) continue;
      items.push({
        kind: "review_request",
        id: `rv-${p.id}`,
        title: String(p.title ?? ""),
        repo,
        number: Number(p.number),
        url: String(p.html_url ?? ""),
        state: "review_requested",
        updatedAt: String(p.updated_at ?? new Date().toISOString()),
        draft: Boolean(p.draft),
        labels: ((p.labels as { name: string }[] | undefined) ?? []).map((l) => l.name),
      });
    }
  }

  // ── Open issues assigned to user ──────────────────────────────────────────
  let assignedIssues: ActivitySearchResult | null = null;
  if (!cooldownFailure) {
    assignedIssues = await fetchActivitySearch(`is:issue+is:open+assignee:${login}`, token);
    recordRateInfo(assignedIssues);
    if (assignedIssues.failure?.rateLimited) cooldownFailure = assignedIssues.failure;
    for (const i of assignedIssues.items) {
      const repoUrl = (i.repository_url as string | undefined) ?? "";
      const repo = repoUrl.replace("https://api.github.com/repos/", "");
      items.push({
        kind: "issue",
        id: `issue-${i.id}`,
        title: String(i.title ?? ""),
        repo,
        number: Number(i.number),
        url: String(i.html_url ?? ""),
        state: "open",
        updatedAt: String(i.updated_at ?? new Date().toISOString()),
        labels: ((i.labels as { name: string }[] | undefined) ?? []).map((l) => l.name),
      });
    }
  }

  const cooldownCollection = cooldownFailure
    ? activityCollectionFailure(cooldownFailure.message, cooldownFailure.retryAfterSeconds)
    : null;
  const collections: ActivityCollections = {
    authored: authored.collection,
    reviewRequests: reviewRequests?.collection
      ?? (token ? cooldownCollection ?? activityCollectionFailure("GitHub search wasn't attempted.") : activityCollectionUnavailable()),
    assignedIssues: assignedIssues?.collection
      ?? cooldownCollection
      ?? activityCollectionFailure("GitHub search wasn't attempted."),
  };

  // Enrich PR rows with their CI rollup. Token-gated: this spends core REST
  // quota (a few calls per PR), which the public 60/hr budget can't absorb.
  // A bounded worker pool lets the first rate limit abort the remaining queue.
  let checkCooldownFailure: GitHubApiFailure | null = null;
  if (token && !cooldownFailure) {
    const prRows = items
      .filter((it) => (it.kind === "pr" || it.kind === "review_request") && typeof it.number === "number")
      .slice(0, CHECK_ENRICH_CAP);
    const controller = new AbortController();
    let nextRow = 0;
    const enrichNext = async (): Promise<GitHubApiFailure | null> => {
      while (!controller.signal.aborted) {
        const rowIndex = nextRow;
        nextRow += 1;
        if (rowIndex >= prRows.length) return null;
        const item = prRows[rowIndex];
        const result = await fetchPrChecks(
          item.repo,
          item.number as number,
          token,
          controller.signal,
        );
        if (result.failure?.rateLimited) {
          controller.abort();
          return result.failure;
        }
        item.checkStatus = result.summary;
      }
      return null;
    };
    const failures = await Promise.all(
      Array.from(
        { length: Math.min(CHECK_ENRICH_CONCURRENCY, prRows.length) },
        () => enrichNext(),
      ),
    );
    checkCooldownFailure = failures.find(
      (failure): failure is GitHubApiFailure => failure !== null,
    ) ?? null;
  }

  // sort all by updatedAt desc
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const result: ActivityResult = {
    ok: true,
    authed: !!token,
    patInvalid: patInvalid || undefined,
    login,
    organizations,
    collections,
    items,
    rateLimit: rateInfo,
    warning: checkCooldownFailure?.message,
    retryAfterSeconds: checkCooldownFailure?.retryAfterSeconds ?? undefined,
  };

  return NextResponse.json(result);
}
