import { NextResponse } from "next/server";
import { forceGitHubTasksRefresh, getGitHubTasks } from "@/lib/github-tasks-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return respondWithTasks(false);
}

/** Explicit/user-initiated refreshes bypass a fresh TTL entry, while still
 * joining any upstream request already in flight. */
export async function POST() {
  return respondWithTasks(true);
}

async function respondWithTasks(force: boolean) {
  const endpoint = githubTasksEndpoint();
  if (!endpoint) {
    return NextResponse.json({
      ok: false,
      error: "coven-github task endpoint is not configured",
      tasks: [],
    });
  }

  try {
    const result = force
      ? await forceGitHubTasksRefresh(endpoint)
      : await getGitHubTasks(endpoint);
    return NextResponse.json(result.data, {
      headers: {
        "x-coven-cache": result.source,
        "x-coven-cache-freshness": result.freshness,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "failed to reach coven-github",
        tasks: [],
      },
      { status: 503 },
    );
  }
}

function githubTasksEndpoint(): string | null {
  const direct = process.env.COVEN_GITHUB_TASKS_URL?.trim();
  if (direct) return direct;

  const base = process.env.COVEN_GITHUB_URL?.trim();
  if (!base) return null;

  return `${base.replace(/\/+$/, "")}/api/github/tasks`;
}
