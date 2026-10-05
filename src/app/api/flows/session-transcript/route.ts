import { NextResponse } from "next/server";
import { isSafeConversationSessionId } from "../../../../lib/cave-conversations.ts";
import { flowSessionDisplayTranscript } from "../../../../lib/server/flow-session-transcript.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Flow execution display endpoint. Missing saved assistant messages return an
 * explicit unavailable state without exposing unclassified terminal output.
 * A successful empty read remains HTTP 200 so polling can retry normally.
 */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  const display = await flowSessionDisplayTranscript(sessionId);
  return NextResponse.json({ ok: true, ...display, found: Boolean(display.transcript.trim()) });
}
