import { NextResponse } from "next/server";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/threads/[id]/strands — strand inspection read model (spec §3 route 4).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const envelope = await activeThreadsAdapter().strands(id);
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "GET") });
}
