import type { ChatAttentionSettlementOutcome } from "./chat-attention-projection.ts";

export const CHAT_ATTENTION_CLEAR_EVENT = "cave:chat-attention-clear";
export const CHAT_ATTENTION_SETTLE_EVENT = "cave:chat-attention-settle";

export type ChatAttentionClearDetail = {
  sessionId: string;
  operationId: string;
};

export type ChatAttentionSettlementDetail = ChatAttentionClearDetail & {
  outcome: ChatAttentionSettlementOutcome;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function attentionEventDetail(event: Event, type: string): ChatAttentionClearDetail | null {
  if (event.type !== type) return null;
  const detail = (event as CustomEvent<Record<string, unknown> | null>).detail;
  const sessionId = normalizeString(detail?.sessionId);
  const operationId = normalizeString(detail?.operationId);
  return sessionId && operationId ? { sessionId, operationId } : null;
}

export function emitChatAttentionClear(sessionId: string, operationId: string): void {
  if (typeof window === "undefined") return;
  const normalizedSessionId = normalizeString(sessionId);
  const normalizedOperationId = normalizeString(operationId);
  if (!normalizedSessionId || !normalizedOperationId) return;
  window.dispatchEvent(new CustomEvent<ChatAttentionClearDetail>(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: {
      sessionId: normalizedSessionId,
      operationId: normalizedOperationId,
    },
  }));
}

export function emitChatAttentionSettlement(
  sessionId: string,
  operationId: string,
  outcome: ChatAttentionSettlementOutcome,
): void {
  if (typeof window === "undefined" || (outcome !== "persisted" && outcome !== "failed")) return;
  const normalizedSessionId = normalizeString(sessionId);
  const normalizedOperationId = normalizeString(operationId);
  if (!normalizedSessionId || !normalizedOperationId) return;
  window.dispatchEvent(new CustomEvent<ChatAttentionSettlementDetail>(CHAT_ATTENTION_SETTLE_EVENT, {
    detail: {
      sessionId: normalizedSessionId,
      operationId: normalizedOperationId,
      outcome,
    },
  }));
}

export function attentionClearFromEvent(event: Event): ChatAttentionClearDetail | null {
  return attentionEventDetail(event, CHAT_ATTENTION_CLEAR_EVENT);
}

export function attentionClearedSessionId(event: Event): string | null {
  if (event.type !== CHAT_ATTENTION_CLEAR_EVENT) return null;
  const detail = (event as CustomEvent<Record<string, unknown> | null>).detail;
  return normalizeString(detail?.sessionId);
}

export function attentionSettlementFromEvent(event: Event): ChatAttentionSettlementDetail | null {
  const detail = attentionEventDetail(event, CHAT_ATTENTION_SETTLE_EVENT);
  if (!detail) return null;
  const outcome = (event as CustomEvent<Record<string, unknown> | null>).detail?.outcome;
  return outcome === "persisted" || outcome === "failed"
    ? { ...detail, outcome }
    : null;
}
