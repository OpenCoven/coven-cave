import { NextResponse } from "next/server.js";
import { isSafeConversationSessionId } from "../../../../lib/cave-conversations.ts";
import { appendVoiceOriginTurn } from "../../../../lib/voice/append-voice-turn.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    sessionId?: string;
    callId?: string;
    role?: string;
    text?: string;
    endedAt?: string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { sessionId, callId, role, text, endedAt } = body;
  if (!sessionId) return NextResponse.json({ ok: false, error: "missing_sessionId" }, { status: 400 });
  if (!isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
  }
  if (!callId) return NextResponse.json({ ok: false, error: "missing_callId" }, { status: 400 });
  if (role !== "user" && role !== "assistant") {
    return NextResponse.json({ ok: false, error: "invalid_role" }, { status: 400 });
  }
  if (typeof text !== "string" || text.length === 0) {
    return NextResponse.json({ ok: false, error: "missing_text" }, { status: 400 });
  }

  await appendVoiceOriginTurn(sessionId, {
    callId,
    role,
    text,
    createdAt: endedAt ?? new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
