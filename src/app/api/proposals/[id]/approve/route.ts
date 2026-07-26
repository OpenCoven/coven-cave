import { NextResponse } from "next/server.js";
import { parseProposalDecisionBody } from "@/lib/proposal-decision-body";
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
  const decision = parseProposalDecisionBody(await req.text());
  if (!decision.ok) return NextResponse.json({ ok: false, error: decision.error }, { status: 400 });
  const envelope = await activeThreadsAdapter().approve(id, decision.expectedRevision, decision.note);
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "POST") });
}
