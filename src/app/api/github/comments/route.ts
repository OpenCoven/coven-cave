/**
 * /api/github/comments
 *
 * Returns the discussion around a single issue or pull request so the GitHub
 * surface (desktop + native iOS) can read the full thread, not just the body:
 *
 *   - issueComments  — the conversation timeline (REST, works on the public API)
 *   - reviewThreads  — inline PR review threads with their resolve state
 *                      (GraphQL — requires a PAT; empty on the public API)
 *
 * Auth mirrors /api/github/item: a local-only PAT when present, otherwise the
 * unauthenticated public API. `canResolve` is true only when a PAT is present,
 * since resolving a review thread is a GraphQL mutation that needs auth.
 *
 * The PAT is read-only from env, never echoed to the client, never logged.
 */

import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";

// owner/name — exactly one slash, each segment a safe GitHub identifier. The
// barrier that keeps the value safe to interpolate into the API path.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

type Person = { login: string; avatarUrl: string | null; url: string | null };

type Reaction = { content: string; count: number };

type Comment = {
  id: string;
  author: Person | null;
  body: string;
  createdAt: string | null;
  url: string | null;
  authorAssociation: string | null;
  reactions?: Reaction[];
};

/** PR review summary (APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED). */
type Review = {
  id: string;
  author: Person | null;
  state: string;
  body: string;
  submittedAt: string | null;
  url: string | null;
  authorAssociation: string | null;
};

type ReviewThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  diffHunk: string | null;
  comments: Comment[];
};

function person(raw: unknown): Person | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const login = typeof u.login === "string" ? u.login : null;
  if (!login) return null;
  return {
    login,
    avatarUrl: typeof u.avatar_url === "string" ? u.avatar_url
      : typeof u.avatarUrl === "string" ? u.avatarUrl : null,
    url: typeof u.html_url === "string" ? u.html_url
      : typeof u.url === "string" ? u.url : null,
  };
}

// The `reactions` rollup that GitHub attaches to every comment payload. Emoji
// glyphs are resolved client-side; here we only pass through non-zero counts.
const REACTION_KEYS = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"] as const;

function reactions(raw: unknown): Reaction[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const out: Reaction[] = [];
  for (const key of REACTION_KEYS) {
    const count = r[key];
    if (typeof count === "number" && count > 0) out.push({ content: key, count });
  }
  return out;
}

async function ghFetch(path: string, token: string | null) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${GH}${path}`, { headers, cache: "no-store" });
  const data = await res.json().catch(() => null);
  return { res, data };
}

/**
 * PR review summaries via REST (works unauthenticated). A "COMMENTED" review
 * with no body is just the container for inline thread comments already shown
 * in `reviewThreads`, so it's dropped; APPROVED / CHANGES_REQUESTED / DISMISSED
 * always carry signal and are kept even when the body is empty.
 */
async function fetchReviews(repo: string, number: number, token: string | null): Promise<Review[]> {
  const { res, data } = await ghFetch(`/repos/${repo}/pulls/${number}/reviews?per_page=100`, token);
  if (!res.ok || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>)
    .map((r): Review => ({
      id: String(r.id ?? ""),
      author: person(r.user),
      state: String(r.state ?? "COMMENTED"),
      body: typeof r.body === "string" ? r.body : "",
      submittedAt: typeof r.submitted_at === "string" ? r.submitted_at : null,
      url: typeof r.html_url === "string" ? r.html_url : null,
      authorAssociation: typeof r.author_association === "string" ? r.author_association : null,
    }))
    .filter((r) => r.state !== "PENDING" && (r.state !== "COMMENTED" || r.body.trim().length > 0));
}

/** Fetch PR inline review threads + resolve state via GraphQL (token required). */
async function fetchReviewThreads(owner: string, name: string, number: number, token: string): Promise<ReviewThread[]> {
  const query = `
    query($owner:String!,$name:String!,$number:Int!){
      repository(owner:$owner,name:$name){
        pullRequest(number:$number){
          reviewThreads(first:100){
            nodes{
              id isResolved isOutdated
              comments(first:50){
                nodes{
                  databaseId author{login avatarUrl url}
                  body createdAt path diffHunk url
                  authorAssociation
                }
              }
            }
          }
        }
      }
    }`;
  const res = await fetch(`${GH}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({ query, variables: { owner, name, number } }),
  });
  const json = await res.json().catch(() => null);
  const nodes = json?.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.map((t: Record<string, unknown>): ReviewThread => {
    const comments = Array.isArray((t.comments as Record<string, unknown> | undefined)?.nodes)
      ? ((t.comments as { nodes: unknown[] }).nodes).map((c): Comment => {
          const co = c as Record<string, unknown>;
          return {
            id: String(co.databaseId ?? ""),
            author: person(co.author),
            body: typeof co.body === "string" ? co.body : "",
            createdAt: typeof co.createdAt === "string" ? co.createdAt : null,
            url: typeof co.url === "string" ? co.url : null,
            authorAssociation: typeof co.authorAssociation === "string" ? co.authorAssociation : null,
          };
        })
      : [];
    const first = comments[0];
    return {
      id: String(t.id ?? ""),
      isResolved: Boolean(t.isResolved),
      isOutdated: Boolean(t.isOutdated),
      path: (() => {
        const c0 = (t.comments as { nodes?: Array<{ path?: unknown }> } | undefined)?.nodes?.[0];
        return typeof c0?.path === "string" ? c0.path : null;
      })(),
      line: null,
      diffHunk: (() => {
        const c0 = (t.comments as { nodes?: Array<{ diffHunk?: unknown }> } | undefined)?.nodes?.[0];
        return typeof c0?.diffHunk === "string" ? c0.diffHunk : null;
      })(),
      comments: first ? comments : [],
    };
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = (url.searchParams.get("repo") ?? "").trim();
  const numberRaw = (url.searchParams.get("number") ?? "").trim();
  const number = Number.parseInt(numberRaw, 10);
  const isPull = url.searchParams.get("isPull") === "1";

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }

  const token = resolveSecret("GITHUB_PAT") ?? null;
  const [owner, name] = repo.split("/");

  try {
    // Conversation comments — REST, works unauthenticated. repo passed REPO_RE
    // and number is a positive integer, both safe to interpolate.
    const { res, data } = await ghFetch(`/repos/${repo}/issues/${number}/comments?per_page=100`, token);
    if (!res.ok || !Array.isArray(data)) {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 ? 403 : 502 },
      );
    }
    const issueComments: Comment[] = data.map((c): Comment => {
      const co = c as Record<string, unknown>;
      return {
        id: String(co.id ?? ""),
        author: person(co.user),
        body: typeof co.body === "string" ? co.body : "",
        createdAt: typeof co.created_at === "string" ? co.created_at : null,
        url: typeof co.html_url === "string" ? co.html_url : null,
        authorAssociation: typeof co.author_association === "string" ? co.author_association : null,
        reactions: reactions(co.reactions),
      };
    });

    // Inline review threads — GraphQL, PR-only, needs a token.
    // Review summaries — REST, PR-only, work unauthenticated. Both are
    // best-effort so a failure just omits that slice of the conversation.
    let reviewThreads: ReviewThread[] = [];
    let reviews: Review[] = [];
    if (isPull) {
      [reviewThreads, reviews] = await Promise.all([
        token ? fetchReviewThreads(owner, name, number, token).catch(() => []) : Promise.resolve([]),
        fetchReviews(repo, number, token).catch(() => []),
      ]);
    }

    return NextResponse.json({
      ok: true,
      authed: Boolean(token),
      canResolve: Boolean(token),
      issueComments,
      reviewThreads,
      reviews,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load comments" },
      { status: 502 },
    );
  }
}
