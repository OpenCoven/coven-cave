export const CHAT_ATTENTION_CLEAR_EVENT = "cave:chat-attention-clear";

type ChatAttentionClearDetail = {
  sessionId?: unknown;
};

export function emitChatAttentionClear(sessionId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatAttentionClearDetail>(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId },
  }));
}

export function attentionClearedSessionId(event: Event): string | null {
  if (event.type !== CHAT_ATTENTION_CLEAR_EVENT) return null;
  const sessionId = (event as CustomEvent<ChatAttentionClearDetail | null>).detail?.sessionId;
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  return trimmed || null;
}
