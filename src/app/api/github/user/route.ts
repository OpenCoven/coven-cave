/**
 * /api/github/user
 *
 * Returns a GitHub user's (or org's) public profile so the GitHub surface can
 * render a rich profile card when a person chip is clicked — avatar, name, bio,
 * company/location/blog, and the follower/repo counts — instead of a bare login.
 *
 * Auth mirrors /api/github/item: a local-only PAT when present, otherwise the
 * unauthenticated public API. Profiles are public either way; the PAT only
 * raises the rate limit and is never echoed back to the client.
 */

import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";

// A GitHub login: 1–39 chars, alphanumerics with single internal hyphens. This
// is the barrier that keeps the value safe to interpolate into the API path.
// Bot logins ("dependabot[bot]") are intentionally rejected — they have no
// user profile, so the caller gets a clean 400 rather than a wasted 404 round-trip.
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

type Profile = {
  ok: true;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitter: string | null;
  type: string;
  followers: number;
  following: number;
  publicRepos: number;
  createdAt: string | null;
};

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

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const login = (url.searchParams.get("login") ?? "").trim();

  if (!LOGIN_RE.test(login)) {
    return NextResponse.json({ ok: false, error: "invalid login" }, { status: 400 });
  }

  const token = resolveSecret("GITHUB_PAT") ?? null;

  try {
    // login passed LOGIN_RE — safe to interpolate into the API path.
    const { res, data } = await ghFetch(`/users/${login}`, token);
    if (res.status === 404) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (!res.ok || !data || typeof data !== "object") {
      return NextResponse.json(
        { ok: false, error: `github error (${res.status})` },
        { status: res.status === 403 ? 403 : 502 },
      );
    }

    const d = data as Record<string, unknown>;
    const blog = str(d.blog);
    const twitter = str(d.twitter_username);
    const profile: Profile = {
      ok: true,
      login: String(d.login ?? login),
      name: str(d.name),
      avatarUrl: str(d.avatar_url),
      htmlUrl: str(d.html_url),
      bio: str(d.bio),
      company: str(d.company),
      location: str(d.location),
      // GitHub stores bare domains without a scheme; normalize so the UI can
      // link it directly without producing a relative in-app URL.
      blog: blog ? (/^https?:\/\//i.test(blog) ? blog : `https://${blog}`) : null,
      twitter,
      type: String(d.type ?? "User"),
      followers: num(d.followers),
      following: num(d.following),
      publicRepos: num(d.public_repos),
      createdAt: str(d.created_at),
    };

    return NextResponse.json(profile);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load profile" },
      { status: 502 },
    );
  }
}
