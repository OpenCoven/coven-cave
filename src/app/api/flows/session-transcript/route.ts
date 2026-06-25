import { NextResponse } from "next/server";
import { isSafeConversationSessionId, loadConversation } from "../../../../lib/cave-conversations.ts";
import { loadState } from "../../../../lib/cave-config.ts";
import { loadConversationFromJsonl } from "../../../../lib/openclaw-conversation.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assistantTranscript(conversation: { turns?: Array<{ role?: string; text?: string }> } | null): string {
  return (conversation?.turns ?? [])
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.text ?? "")
    .join("\n");
}

/**
 * Flow execution polling endpoint. A live flow run can have a daemon session id
 * before Cave has a persisted conversation or OpenClaw JSONL transcript for it.
 * Return an empty 200 in that normal gap so browser polling does not emit 404
 * resource errors while the session is still coming up.
 */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  const conversation = await loadConversation(sessionId);
  if (conversation) {
    return NextResponse.json({ ok: true, transcript: assistantTranscript(conversation), found: true });
  }

  const state = await loadState();
  const familiarId = state.sessionFamiliar[sessionId];
  if (familiarId) {
    const jsonlConversation = await loadConversationFromJsonl(sessionId, familiarId);
    if (jsonlConversation) {
      return NextResponse.json({ ok: true, transcript: assistantTranscript(jsonlConversation), found: true });
    }
  }

  return NextResponse.json({ ok: true, transcript: "", found: false });
}
