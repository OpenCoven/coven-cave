import { NextResponse } from "next/server";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/proposals — staged DegradeToProposal writes from ~/.coven/pending/
// (spec §3 route 6). Both `ok` and `corrupt` entries are listed (R6).
export async function GET() {
  const envelope = await activeThreadsAdapter().proposals();
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "GET") });
}
