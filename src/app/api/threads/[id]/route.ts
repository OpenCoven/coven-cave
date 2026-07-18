import { NextResponse } from "next/server";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/threads/[id] — thread pane read model (spec §3 route 3).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const envelope = await activeThreadsAdapter().thread(id);
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "GET") });
}
