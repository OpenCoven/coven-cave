import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const endpoint = githubTasksEndpoint();
  if (!endpoint) {
    return NextResponse.json({
      ok: false,
      error: "coven-github task endpoint is not configured",
      tasks: [],
    });
  }

  try {
    const res = await fetch(endpoint, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok || data == null) {
      return NextResponse.json(
        {
          ok: false,
          error: `coven-github returned ${res.status}`,
          tasks: [],
        },
        { status: 502 },
      );
    }

    return NextResponse.json(data);
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
