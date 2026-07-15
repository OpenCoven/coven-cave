import { NextResponse } from "next/server";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/weaves/[id] — weave detail (spec §3 route 2).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const envelope = await activeThreadsAdapter().weave(id);
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "GET") });
}
