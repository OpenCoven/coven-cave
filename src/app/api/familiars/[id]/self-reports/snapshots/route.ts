import { NextResponse } from "next/server";
import { listMetricSnapshots } from "@/lib/server/familiar-self-reports";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Compact per-thread metric snapshots, oldest → newest — the signal-trends
 * series behind "is the familiar improving?". Legacy reports that predate
 * snapshot persistence are backfilled server-side, so old data always loads.
 * Snapshots carry no free-text fields (scores + context pressure only), and
 * this static segment intentionally shadows the [sessionId] sibling — daemon
 * session ids are UUID-like and can never be the literal "snapshots".
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const result = await listMetricSnapshots(id);
  return NextResponse.json({ ok: true, snapshots: result.snapshots, total: result.total });
}
