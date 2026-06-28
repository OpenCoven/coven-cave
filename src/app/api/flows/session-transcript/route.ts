import { NextResponse } from "next/server";
import { isSafeConversationSessionId, loadConversation } from "../../../../lib/cave-conversations.ts";
import { loadState } from "../../../../lib/cave-config.ts";
import { callDaemon } from "../../../../lib/coven-daemon.ts";
import { loadConversationFromJsonl } from "../../../../lib/openclaw-conversation.ts";
import { stripAnsi } from "../../../../lib/ansi.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CovenEvent = {
  kind: string;
  payload_json: string;
};

function assistantTranscript(conversation: { turns?: Array<{ role?: string; text?: string }> } | null): string {
  return (conversation?.turns ?? [])
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.text ?? "")
    .join("\n");
}

function eventOutputTranscript(events: CovenEvent[]): string {
  const parts: string[] = [];
  for (const event of events) {
    if (event.kind !== "output") continue;
    try {
      const payload = JSON.parse(event.payload_json) as { data?: unknown };
      if (typeof payload.data === "string") parts.push(stripAnsi(payload.data));
    } catch {
      // Ignore malformed daemon payloads; the next poll can still catch up.
    }
  }
  return parts.join("");
}

async function daemonEventTranscript(sessionId: string): Promise<string> {
  const res = await callDaemon<{ events: CovenEvent[] }>({
    path: `/api/v1/events?sessionId=${encodeURIComponent(sessionId)}&afterSeq=0&limit=500`,
    timeoutMs: 4000,
  });
  if (!res.ok || !res.data?.events) return "";
  return eventOutputTranscript(res.data.events);
}

/**
 * Flow execution polling endpoint. A live flow run can have a daemon session id
 * before Cave has a persisted conversation or OpenClaw JSONL transcript for it,
 * so the final fallback reads the daemon's PTY event stream directly.
 * Return an empty 200 in that normal gap so browser polling does not emit 404
 * resource errors while the session is still coming up.
 */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  const conversation = await loadConversation(sessionId);
  const conversationTranscript = assistantTranscript(conversation);
  if (conversationTranscript.trim()) {
    return NextResponse.json({ ok: true, transcript: conversationTranscript, found: true });
  }

  const state = await loadState();
  const familiarId = state.sessionFamiliar[sessionId];
  if (familiarId) {
    const jsonlConversation = await loadConversationFromJsonl(sessionId, familiarId);
    const jsonlTranscript = assistantTranscript(jsonlConversation);
    if (jsonlTranscript.trim()) {
      return NextResponse.json({ ok: true, transcript: jsonlTranscript, found: true });
    }
  }

  const owned =
    Boolean(state.sessionOwned?.[sessionId]) ||
    Boolean(state.sessionFamiliar?.[sessionId]) ||
    Boolean(state.sessionTitles?.[sessionId]);
  if (owned) {
    const eventTranscript = await daemonEventTranscript(sessionId);
    if (eventTranscript.trim()) {
      return NextResponse.json({ ok: true, transcript: eventTranscript, found: true });
    }
  }

  return NextResponse.json({ ok: true, transcript: "", found: false });
}
