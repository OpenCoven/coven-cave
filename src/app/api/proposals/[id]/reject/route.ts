import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { activeThreadsAdapter, httpStatusForEnvelope } from "@/lib/threads-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DecisionBody = { expectedRevision?: unknown; note?: unknown };

// POST /api/proposals/[id]/reject — thin daemon-forwarder (spec §3.7).
// Rejection is a daemon-side decision too: the daemon audits it and removes
// the pending file. Fails closed (503) without a daemon.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectNonLocalRequest(req);
  if (rejected) return rejected;
  const { id } = await params;
  let body: DecisionBody = {};
  const rawBody = await req.text();
  if (rawBody.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as DecisionBody;
    }
  }
  const expectedRevision = body.expectedRevision;
  if (
    expectedRevision !== undefined &&
    (typeof expectedRevision !== "string" || !/^[0-9a-f]{64}$/.test(expectedRevision))
  ) {
    return NextResponse.json({ ok: false, error: "invalid expectedRevision" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note : undefined;
  const envelope = await activeThreadsAdapter().reject(id, expectedRevision, note);
  return NextResponse.json(envelope, { status: httpStatusForEnvelope(envelope, "POST") });
}
