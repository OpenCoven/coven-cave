import { NextResponse } from "next/server";
import {
  requestChatStop,
  requestOrQueueChatStop,
} from "@/lib/server/chat-stop-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/chat/stop — deliberate cancel for an in-flight /api/chat/send run.
 *
 * Clients used to signal Stop by aborting the SSE request, but a transport
 * drop (phone loses signal, laptop lid closes) produces the exact same abort,
 * and the harness was SIGTERMed either way. Stop is now an explicit call:
 * the send route only treats a run as user-cancelled when this endpoint
 * flagged it; a bare abort lets the turn finish server-side and persist, so
 * the client recovers the full reply on resync.
 *
 * Body: `{ runId?, sessionId? }` — runId is the authoritative per-send client
 * token. An unknown runId is queued for up to fifteen minutes while async send
 * setup registers; its response is `{ stopped: false, queued: true }`, and
 * sessionId is not consulted. If that 256-entry queue is full, the route
 * returns a retryable 503 without dropping any unexpired acknowledged intent.
 * A sessionId-only request retains the legacy live-key behavior.
 * `{ stopped: false, queued: false }` means the keyed run was already settled
 * or no live session-keyed run exists (not an error).
 */
export async function POST(req: Request) {
  let body: { runId?: string; sessionId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Malformed body → nothing to stop; fall through to the not-found reply.
  }

  const runId = typeof body.runId === "string" && body.runId.length > 0
    ? body.runId
    : null;
  const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0
    ? body.sessionId
    : null;
  if (!runId && !sessionId) {
    return NextResponse.json({ ok: false, error: "runId or sessionId required" }, { status: 400 });
  }

  if (runId) {
    const outcome = requestOrQueueChatStop(runId);
    if (outcome === "full") {
      return NextResponse.json({
        ok: false,
        stopped: false,
        queued: false,
        retryable: true,
        error: "The pending Stop queue is full. Retry shortly.",
      }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      stopped: outcome === "stopped",
      queued: outcome === "queued",
    });
  }

  return NextResponse.json({
    ok: true,
    stopped: requestChatStop(sessionId!),
    queued: false,
  });
}
