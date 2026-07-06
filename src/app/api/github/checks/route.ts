/**
 * /api/github/checks
 *
 * Returns the CI "action details" for a single pull request: the individual
 * GitHub Actions check-runs (name, status, conclusion, timing, logs URL) plus
 * the legacy combined commit statuses, and a rolled-up summary. The activity
 * list only carries a single failing/passing pip per PR — this route powers the
 * expandable per-check breakdown in the detail panel.
 *
 * Auth mirrors /api/github/item: a local-only PAT when present, otherwise the
 * unauthenticated public API (works for public repos within the 60/hr budget,
 * since this is fetched on-demand for the selected PR, not per list row).
 * The PAT is read-only from env, never echoed back.
 */

import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";
import { summarizeChecks, type CheckRun } from "@/lib/github-checks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";

// owner/name — exactly one slash, each segment a safe GitHub identifier. The
// barrier that keeps the value safe to interpolate into the API path.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

type CheckRunDetail = {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  appName: string | null;
  appAvatarUrl: string | null;
};

type StatusDetail = {
  context: string;
  state: string;
  description: string | null;
  targetUrl: string | null;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
    // Resolve the PR's head SHA — repo passed REPO_RE, number is a positive
    // integer, both safe to interpolate.
    const pr = await ghFetch(`/repos/${repo}/pulls/${number}`, token);
    if (pr.res.status === 404) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    const sha = (pr.data as { head?: { sha?: string } } | null)?.head?.sha ?? null;
    if (!pr.res.ok || !sha) {
      return NextResponse.json(
        { ok: false, error: `github error (${pr.res.status})` },
        { status: pr.res.status === 403 ? 403 : 502 },
      );
    }

    const [runsResp, statusResp] = await Promise.all([
      ghFetch(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`, token),
      ghFetch(`/repos/${repo}/commits/${sha}/status`, token),
    ]);

    const rawRuns = ((runsResp.data as { check_runs?: unknown[] } | null)?.check_runs ?? []) as Array<
      Record<string, unknown>
    >;
    const runs: CheckRunDetail[] = rawRuns.map((r) => {
      const app = r.app as Record<string, unknown> | undefined;
      return {
        id: String(r.id ?? ""),
        name: str(r.name) ?? "check",
        status: String(r.status ?? "queued"),
        conclusion: str(r.conclusion),
        startedAt: str(r.started_at),
        completedAt: str(r.completed_at),
        detailsUrl: str(r.details_url) ?? str(r.html_url),
        appName: app ? str(app.name) : null,
        appAvatarUrl: app ? str(app.owner && (app.owner as Record<string, unknown>).avatar_url) : null,
      };
    });

    const rawStatuses = ((statusResp.data as { statuses?: unknown[] } | null)?.statuses ?? []) as Array<
      Record<string, unknown>
    >;
    const combinedState = (statusResp.data as { state?: string } | null)?.state ?? null;
    const statuses: StatusDetail[] = rawStatuses.map((s) => ({
      context: str(s.context) ?? "status",
      state: String(s.state ?? "pending"),
      description: str(s.description),
      targetUrl: str(s.target_url),
    }));

    const rollup = summarizeChecks(runs as CheckRun[], combinedState);

    return NextResponse.json({
      ok: true,
      authed: Boolean(token),
      sha,
      rollup,
      runs,
      statuses,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to load checks" },
      { status: 502 },
    );
  }
}
