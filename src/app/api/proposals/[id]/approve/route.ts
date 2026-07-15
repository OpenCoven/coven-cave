import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/proposals/[id]/approve — thin daemon-forwarder (spec §3.7). The
// daemon re-validates, applies or refuses, audits, and removes the pending
// file; this route never mutates anything itself. Fails closed (503) when
// there is no daemon to forward to — no optimistic UI, no queued decisions.
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
  const envelope = await activeThreadsAdapter().approve(id, note);
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "POST") });
}
