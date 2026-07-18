import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/proposals/[id]/reject — thin daemon-forwarder (spec §3.7).
// Rejection is a daemon-side decision too: the daemon audits it and removes
// the pending file. Fails closed (503) without a daemon.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectNonLocalRequest(req);
  if (rejected) return rejected;
  const { id } = await params;
  let body: { note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note : undefined;
  const envelope = await activeThreadsAdapter().reject(id, note);
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "POST") });
}
