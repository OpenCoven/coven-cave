import { NextResponse } from "next/server";
import { isSafeConversationSessionId } from "../../../../lib/cave-conversations.ts";
import { flowSessionTranscript } from "../../../../lib/server/flow-session-transcript.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Flow execution polling endpoint. A live flow run can have a daemon session id
 * before Cave has a persisted conversation or OpenClaw JSONL transcript for it,
 * so the shared resolver falls back to the daemon's PTY event stream (the same
 * chain the research-mission reconcile reads server-side — cave-ibb7).
 * Return an empty 200 in that normal gap so browser polling does not emit 404
 * resource errors while the session is still coming up.
 */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  const transcript = await flowSessionTranscript(sessionId);
  return NextResponse.json({ ok: true, transcript, found: Boolean(transcript.trim()) });
}
