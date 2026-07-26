import { NextResponse } from "next/server";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/weaves — weave rail read model (spec §3 route 1).
export async function GET(req: Request) {
  const familiar = new URL(req.url).searchParams.get("familiar") ?? undefined;
  const envelope = await activeThreadsAdapter().listWeaves(familiar);
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "GET") });
}
