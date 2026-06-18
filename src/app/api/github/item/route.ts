/**
 * /api/github/item
 *
 * Returns the full detail of a single GitHub issue or pull request so the
 * GitHub surface can render a faithful issue view (body, author, timeline,
 * assignees, colored labels) instead of just the activity-list summary.
 *
 * Auth mirrors /api/github/activity: a local-only PAT when present, otherwise
 * the unauthenticated public API. The PAT is read from env, never echoed back.
 *
 * Both issues and PRs are fetched through the `/issues/{number}` endpoint —
 * on GitHub a PR *is* an issue, and that endpoint returns body/user/labels/
 * assignees/created_at for both, in one call.
 */

import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";

// owner/name — exactly one slash, each segment a safe GitHub identifier. This
// is the barrier that keeps the value safe to interpolate into the API path.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

type Person = { login: string; avatarUrl: string | null; url: string | null };

type ItemDetail = {
  ok: true;
  title: string;
  number: number;
  state: string;
  isPull: boolean;
  merged: boolean;
  draft: boolean;
  body: string;
  author: Person | null;
  assignees: Person[];
  labels: { name: string; color: string }[];
  createdAt: string | null;
  updatedAt: string | null;
  htmlUrl: string | null;
  comments: number;
};

function person(raw: unknown): Person | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const login = typeof u.login === "string" ? u.login : null;
  if (!login) return null;
  return {
    login,
    avatarUrl: typeof u.avatar_url === "string" ? u.avatar_url : null,
    url: typeof u.html_url === "string" ? u.html_url : null,
  };
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = (url.searchParams.get("repo") ?? "").trim();
  const numberRaw = (url.searchParams.get("number") ?? "").trim();
  const number = Number.parseInt(numberRaw, 10);

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }

  const token = resolveSecret("GITHUB_PAT") ?? null;

  try {
    // repo passed REPO_RE and number is a positive integer — both safe to interpolate.
    const { res, data } = await ghFetch(`/repos/${repo}/issues/${number}`, token);
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
    const pull = d.pull_request as Record<string, unknown> | undefined;
    const detail: ItemDetail = {
      ok: true,
      title: String(d.title ?? ""),
      number: Number(d.number ?? number),
      state: String(d.state ?? "open"),
      isPull: Boolean(pull),
      merged: Boolean(pull?.merged_at),
      draft: Boolean(d.draft),
      body: typeof d.body === "string" ? d.body : "",
      author: person(d.user),
      assignees: Array.isArray(d.assignees)
        ? d.assignees.map(person).filter((p): p is Person => p != null)
        : [],
      labels: Array.isArray(d.labels)
        ? d.labels
            .map((l) => {
              const lo = l as Record<string, unknown>;
              const name = typeof lo.name === "string" ? lo.name : null;
              if (!name) return null;
              return { name, color: typeof lo.color === "string" ? lo.color : "" };
            })
            .filter((l): l is { name: string; color: string } => l != null)
        : [],
      createdAt: typeof d.created_at === "string" ? d.created_at : null,
      updatedAt: typeof d.updated_at === "string" ? d.updated_at : null,
      htmlUrl: typeof d.html_url === "string" ? d.html_url : null,
      comments: Number(d.comments ?? 0),
    };

    return NextResponse.json(detail);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load item" },
      { status: 502 },
    );
  }
}
