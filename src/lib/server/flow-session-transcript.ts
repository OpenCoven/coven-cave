// Shared flow-session transcript resolution (cave-ibb7). A flow session's
// output can live in three places, in order of preference: the persisted Cave
// conversation, the OpenClaw JSONL transcript, or (before either exists) the
// daemon's PTY event stream. The flows/session-transcript route has always
// walked this chain for the Executions view; the research-mission reconcile
// now needs the same chain server-side to read control markers from sessions
// whose flow-run record never flipped out of "running".

import { loadConversation } from "../cave-conversations.ts";
import { loadState } from "../cave-config.ts";
import { callDaemon, callDaemonTarget, type DaemonTarget } from "../coven-daemon.ts";
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

async function daemonEventTranscript(
  sessionId: string,
  daemonTarget?: DaemonTarget,
  requireAvailable = false,
): Promise<string> {
  type EventPage = {
    events: CovenEvent[];
    hasMore?: boolean;
    nextCursor?: { afterSeq?: number } | null;
  };
  const parts: string[] = [];
  let afterSeq = 0;
  // Completion reads must reach an explicit end, but a corrupt/endless stream
  // must not monopolize the poll. Larger transcripts stay pending until a full
  // persisted transcript is available; display reads retain their single page.
  const pageBudget = requireAvailable ? 8 : 1;
  for (let page = 0; page < pageBudget; page += 1) {
    const request = {
      path: `/api/v1/events?sessionId=${encodeURIComponent(sessionId)}&afterSeq=${afterSeq}&limit=500`,
      timeoutMs: 4000,
    } as const;
    const res = daemonTarget
      ? await callDaemonTarget<EventPage>(daemonTarget, request)
      : await callDaemon<EventPage>(request);
    if (!res.ok || !Array.isArray(res.data?.events)) {
      if (requireAvailable) throw new Error(`Flow transcript unavailable: ${sessionId}`);
      return "";
    }
    parts.push(eventOutputTranscript(res.data.events));
    if (!requireAvailable || res.data.hasMore === false) return parts.join("");
    const next = res.data.nextCursor?.afterSeq;
    if (res.data.hasMore !== true || typeof next !== "number" || !Number.isSafeInteger(next) || next <= afterSeq || res.data.events.length === 0) {
      throw new Error(`Flow transcript pagination invalid: ${sessionId}`);
    }
    afterSeq = next;
  }
  throw new Error(`Flow transcript exceeds completion page budget: ${sessionId}`);
}

/**
 * Best transcript available for a flow session right now; "" when nothing has
 * surfaced yet. Daemon events are only consulted for sessions Cave owns, the
 * same ownership gate the transcript route applies. Reconciliation passes
 * requireAvailable so a transport failure cannot be mistaken for verified
 * empty output and permanently consume the completion acknowledgement.
 */
export async function flowSessionTranscript(
  sessionId: string,
  daemonTarget?: DaemonTarget,
  requireAvailable = false,
): Promise<string> {
  const conversation = await loadConversation(sessionId);
  const conversationText = assistantTranscript(conversation);
  if (conversationText.trim() || conversation?.flowOutcome) return conversationText;

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
    const eventTranscript = await daemonEventTranscript(sessionId, daemonTarget, requireAvailable);
    return eventTranscript.trim() ? eventTranscript : "";
  }

  if (requireAvailable) throw new Error(`Flow transcript unavailable: ${sessionId}`);
  return "";
}
