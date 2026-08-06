import { NextResponse } from "next/server";
import { requestChatStop } from "@/lib/server/chat-stop-registry";

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
 * Body: `{ runId?, sessionId? }` — runId is the per-send client token (works
 * before the server has assigned a conversation id) and, when present, MUST
 * resolve the exact run only. sessionId remains a legacy fallback for callers
 * that have no runId. `stopped: false` means nothing was in flight under the
 * chosen lookup key (already finished — not an error).
 */
export async function POST(req: Request) {
  let body: { runId?: string; sessionId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Malformed body → nothing to stop; fall through to the not-found reply.
  }

  const runId = typeof body.runId === "string" && body.runId.length > 0 ? body.runId : null;
  const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0 ? body.sessionId : null;
  if (!runId && !sessionId) {
    return NextResponse.json({ ok: false, error: "runId or sessionId required" }, { status: 400 });
  }

  const stopped = runId ? requestChatStop(runId) : requestChatStop(sessionId!);
  return NextResponse.json({ ok: true, stopped });
}
