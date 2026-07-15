// Shared flow-session transcript resolution (cave-ibb7). A flow session's
// output can live in three places, in order of preference: the persisted Cave
// conversation, the OpenClaw JSONL transcript, or (before either exists) the
// daemon's PTY event stream. The flows/session-transcript route has always
// walked this chain for the Executions view; the research-mission reconcile
// now needs the same chain server-side to read control markers from sessions
// whose flow-run record never flipped out of "running".

import { loadConversation } from "../cave-conversations.ts";
import { loadState } from "../cave-config.ts";
import { callDaemon } from "../coven-daemon.ts";
import { loadConversationFromJsonl } from "../openclaw-conversation.ts";
import { stripAnsi } from "../ansi.ts";

type CovenEvent = {
  kind: string;
  payload_json: string;
};

export function assistantTranscript(
  conversation: { turns?: Array<{ role?: string; text?: string }> } | null,
): string {
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
 * Best transcript available for a flow session right now; "" when nothing has
 * surfaced yet. Daemon events are only consulted for sessions Cave owns, the
 * same ownership gate the transcript route applies.
 */
export async function flowSessionTranscript(sessionId: string): Promise<string> {
  const conversation = await loadConversation(sessionId);
  const conversationText = assistantTranscript(conversation);
  if (conversationText.trim()) return conversationText;

  const state = await loadState();
  const familiarId = state.sessionFamiliar[sessionId];
  if (familiarId) {
    const jsonlConversation = await loadConversationFromJsonl(sessionId, familiarId);
    const jsonlTranscript = assistantTranscript(jsonlConversation);
    if (jsonlTranscript.trim()) return jsonlTranscript;
  }

  const owned =
    Boolean(state.sessionOwned?.[sessionId]) ||
    Boolean(state.sessionFamiliar?.[sessionId]) ||
    Boolean(state.sessionTitles?.[sessionId]);
  if (owned) {
    const eventTranscript = await daemonEventTranscript(sessionId);
    if (eventTranscript.trim()) return eventTranscript;
  }

  return "";
}
