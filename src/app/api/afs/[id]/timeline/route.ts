import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import type { AfsTimeline } from "@/lib/afs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The daemon rejects anything outside 1..=1000; clamp rather than 400. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  const search = new URL(req.url).searchParams;
  const since = Number.parseInt(search.get("since") ?? "0", 10);
  const requested = Number.parseInt(search.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const query = `since=${Number.isFinite(since) && since > 0 ? since : 0}&limit=${limit}`;
  const res = await callDaemon<AfsTimeline>({
    path: `/api/v1/afs/sessions/${encodeURIComponent(id)}/timeline?${query}`,
  });
  if (!res.ok) {
    return NextResponse.json(res.data ?? { error: res.error }, { status: res.status || 502 });
  }
  return NextResponse.json(res.data);
}
