import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

/**
 * GET /api/skills/eval-loop/[familiarId]
 *
 * Proxies the daemon's eval-loop state for a given familiar.
 * Returns the iteration history, track stats, and running status.
 *
 * When the daemon is offline or the skill is not active for this familiar,
 * returns { ok: false, error: "..." } so the UI can show an empty state.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ familiarId: string }> },
) {
  const { familiarId } = await params;
  const res = await callDaemon<unknown>({
    path: `/api/v1/skills/eval-loop/${familiarId}`,
  });

  if (!res.ok || !res.data) {
    return NextResponse.json(
      {
        ok: false,
        error: res.error ?? `daemon http ${res.status}`,
        state: null,
      },
    );
  }

  return NextResponse.json({ ok: true, state: res.data });
}
