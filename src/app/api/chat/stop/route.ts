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
 * before the server has assigned a conversation id), sessionId the
 * conversation key. Either may match; `stopped: false` means nothing was in
 * flight under those keys (already finished — not an error).
 */
export async function POST(req: Request) {
  let body: { runId?: string; sessionId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Malformed body → nothing to stop; fall through to the not-found reply.
  }

  const keys = [body.runId, body.sessionId].filter(
    (key): key is string => typeof key === "string" && key.length > 0,
  );
  if (keys.length === 0) {
    return NextResponse.json({ ok: false, error: "runId or sessionId required" }, { status: 400 });
  }

  const stopped = keys.some((key) => requestChatStop(key));
  return NextResponse.json({ ok: true, stopped });
}
