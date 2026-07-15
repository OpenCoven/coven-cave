import { NextResponse } from "next/server";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/threads/[id]/audit — ward_audit lineage for one thread, newest
// first; `?before=<rowid>` pagination (spec §3 route 5).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const beforeRaw = new URL(req.url).searchParams.get("before");
  const before = beforeRaw === null ? undefined : Number(beforeRaw);
  const envelope = await activeThreadsAdapter().audit(
    id,
    before !== undefined && Number.isFinite(before) ? before : undefined,
  );
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "GET") });
}
