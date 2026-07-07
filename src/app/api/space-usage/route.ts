import { NextResponse } from "next/server";
import { collectSpaceUsage } from "@/lib/server/space-usage";

export const dynamic = "force-dynamic";

/** Bounded local space-usage snapshot for the dashboard cockpit. Reads only
 *  the fixed `~/.coven` area allow-list — no query-controlled paths. */
export async function GET() {
  try {
    const areas = await collectSpaceUsage();
    return NextResponse.json({ ok: true, areas, scannedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, areas: [] }, { status: 500 });
  }
}
