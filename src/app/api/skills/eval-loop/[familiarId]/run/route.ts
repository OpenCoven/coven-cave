import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

/**
 * POST /api/skills/eval-loop/[familiarId]/run
 *
 * Triggers one eval-loop iteration for a familiar on a specific track.
 * Body: { track: "synthesis" | "prompt" | "memory" }
 *
 * The daemon is responsible for running the iteration and writing results
 * to the familiar's results.tsv. This route just fires the trigger.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ familiarId: string }> },
) {
  const { familiarId } = await params;

  let body: { track?: string } = {};
  try {
    body = (await req.json()) as { track?: string };
  } catch {
    // body optional
  }

  const res = await callDaemon<unknown>({
    path: `/api/v1/skills/eval-loop/${familiarId}/run`,
    method: "POST",
    body: { track: body.track ?? "synthesis" },
  });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}` },
    );
  }

  return NextResponse.json({ ok: true });
}
