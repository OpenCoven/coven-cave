import {
  ConversationLoadError,
  loadConversation,
  offlineConversationWriteNeeded,
  readConversationForPaint,
  recordOfflineConversationWrite,
} from "../conversation-cache.ts";
import { readOfflineCache, writeOfflineCache } from "../offline-cache.ts";
import type { ConversationHistoryPayload } from "../chat-turn-state.ts";
import type { ChatHistorySources } from "./history-load.ts";

async function loadFlowSessionTranscript(sessionId: string): Promise<string | null> {
  const params = new URLSearchParams({ sessionId });
  try {
    const res = await fetch(`/api/flows/session-transcript?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json() as { ok?: boolean; transcript?: string };
    const transcript = typeof json.transcript === "string" ? json.transcript.trim() : "";
    if (!json.ok || !transcript) return null;
    return transcript;
  } catch {
    return null;
  }
}

/** Reuse existing authorization, shared request and encrypted storage contracts. */
export const chatHistorySources: ChatHistorySources = {
  readMemory: (sessionId) => readConversationForPaint(sessionId) as ConversationHistoryPayload | null,
  loadNetwork: (sessionId) => loadConversation(sessionId) as Promise<ConversationHistoryPayload | null>,
  loadDurable: async (sessionId) => {
    const cached = await readOfflineCache<ConversationHistoryPayload>("conversation", sessionId);
    return cached?.data.ok && cached.data.conversation ? cached.data : null;
  },
  persist: (sessionId, payload) => {
    if (offlineConversationWriteNeeded(sessionId, payload)) {
      void writeOfflineCache(
        "conversation",
        sessionId,
        payload,
        payload.conversation?.activeLeafId ?? "conversation",
      ).then((written) => {
        if (written) recordOfflineConversationWrite(sessionId, payload);
      });
    }
  },
  loadFlowTranscript: loadFlowSessionTranscript,
  isMissingError: (error) => error instanceof ConversationLoadError && error.status === 404,
};
