/**
 * /api/github/labels
 *
 * The repository's label vocabulary, so the card composer can offer real labels
 * to pick from instead of asking the user to type a name that must match exactly
 * (GitHub silently creates nothing and 422s on an unknown label).
 *
 * Auth mirrors /api/github/item: a local-only PAT when present, otherwise the
 * unauthenticated public API — labels are public on a public repo, and the PAT
 * only raises the rate limit and unlocks private repos. It is never echoed back.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";

// owner/name — exactly one slash, each segment a safe GitHub identifier. This
// is the barrier that keeps the value safe to interpolate into the API path.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

type Label = { name: string; color: string; description: string | null };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = (url.searchParams.get("repo") ?? "").trim();

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }

  const token = resolveGitHubToken();

  try {
    // repo passed REPO_RE — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/labels?per_page=100`, {
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
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) {
      // 401 only when GitHub itself says so — a missing PAT is not an error
      // here, since the public API answers for public repos.
      const status = res.status === 401 || res.status === 403 ? res.status : 502;
      return NextResponse.json({ ok: false, error: `github error (${res.status})` }, { status });
    }

    const labels: Label[] = (data as Array<Record<string, unknown>>)
      .map((raw) => {
        const name = typeof raw.name === "string" ? raw.name : null;
        if (!name) return null;
        return {
          name,
          color: typeof raw.color === "string" ? raw.color : "",
          description: typeof raw.description === "string" ? raw.description : null,
        };
      })
      .filter((label): label is Label => label != null);

    return NextResponse.json({ ok: true, labels });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load labels" },
      { status: 502 },
    );
  }
}
