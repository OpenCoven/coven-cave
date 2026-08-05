import { isCanonicalIsoInstant, type ChatAttention, type ChatAttentionState } from "./chat-attention.ts";
import { CHAT_ATTENTION_REASONS, type ChatAttentionReason } from "./chat-attention-marker.ts";
import type { ChatAttentionSettlementOutcome } from "./chat-attention-projection.ts";

export const CHAT_ATTENTION_CLEAR_EVENT = "cave:chat-attention-clear";
export const CHAT_ATTENTION_SETTLE_EVENT = "cave:chat-attention-settle";

export type ChatAttentionClearDetail = {
  sessionId: string;
  operationId: string;
  clearWatermark?: string;
  scopeKey?: string;
  baselineAttention?: ChatAttention;
};

export type ChatAttentionSettlementDetail = ChatAttentionClearDetail & {
  outcome: ChatAttentionSettlementOutcome;
};

// Set<string> avoids widening `readonly ChatAttentionReason[]` with a cast at
// every call site (`Set<string>.has` accepts any narrowed string directly).
const VALID_CHAT_ATTENTION_REASONS = new Set<string>(CHAT_ATTENTION_REASONS);

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isChatAttentionState(value: unknown): value is ChatAttentionState {
  return value === "none" ||
    value === "left-hanging" ||
    value === "awaiting-human" ||
    value === "overdue-human";
}

function isChatAttentionReason(value: unknown): value is ChatAttentionReason {
  return typeof value === "string" && VALID_CHAT_ATTENTION_REASONS.has(value);
}

// Enforces the canonical BaselineAttention combos so a malformed or spoofed
// event can never fabricate an impossible attention snapshot:
//   - "none"            -> since AND reason must both be null.
//   - "left-hanging"     -> a canonical UTC ISO `since`, reason must be null.
//   - "awaiting-human" /
//     "overdue-human"    -> a canonical UTC ISO `since` AND a recognized,
//                           non-null reason.
// A non-canonical timestamp or any other since/reason combo is rejected
// outright (returns null) rather than silently coerced.
function normalizeAttentionDetail(value: unknown): ChatAttention | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isChatAttentionState(candidate.state)) return null;
  const state = candidate.state;
  const since = normalizeString(candidate.since);
  const reason = normalizeString(candidate.reason);

  switch (state) {
  case "none":
    return since === null && reason === null ? { state, since: null, reason: null } : null;
  case "left-hanging":
    return since !== null && isCanonicalIsoInstant(since) && reason === null
      ? { state, since, reason: null }
      : null;
  case "awaiting-human":
  case "overdue-human":
    return since !== null && isCanonicalIsoInstant(since) && isChatAttentionReason(reason)
      ? { state, since, reason }
      : null;
  }
}

function normalizeClearWatermark(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized && isCanonicalIsoInstant(normalized) ? normalized : null;
}

function attentionEventDetail(event: Event, type: string): ChatAttentionClearDetail | null {
  if (event.type !== type) return null;
  const detail = (event as CustomEvent<Record<string, unknown> | null>).detail;
  const sessionId = normalizeString(detail?.sessionId);
  const operationId = normalizeString(detail?.operationId);
  const clearWatermark = normalizeClearWatermark(detail?.clearWatermark);
  const scopeKey = normalizeString(detail?.scopeKey);
  const baselineAttention = normalizeAttentionDetail(detail?.baselineAttention);
  return sessionId && operationId
    ? {
      sessionId,
      operationId,
      ...(clearWatermark ? { clearWatermark } : {}),
      ...(scopeKey ? { scopeKey } : {}),
      ...(baselineAttention ? { baselineAttention } : {}),
    }
    : null;
}

export function emitChatAttentionClear(
  sessionId: string,
  operationId: string,
  options?: {
    clearWatermark?: string | null;
    scopeKey?: string | null;
    baselineAttention?: ChatAttention | null;
  },
): void {
  if (typeof window === "undefined") return;
  const normalizedSessionId = normalizeString(sessionId);
  const normalizedOperationId = normalizeString(operationId);
  const normalizedClearWatermark = normalizeClearWatermark(options?.clearWatermark);
  const normalizedScopeKey = normalizeString(options?.scopeKey);
  const normalizedBaselineAttention = normalizeAttentionDetail(options?.baselineAttention);
  if (!normalizedSessionId || !normalizedOperationId) return;
  window.dispatchEvent(new CustomEvent<ChatAttentionClearDetail>(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: {
      sessionId: normalizedSessionId,
      operationId: normalizedOperationId,
      ...(normalizedClearWatermark ? { clearWatermark: normalizedClearWatermark } : {}),
      ...(normalizedScopeKey ? { scopeKey: normalizedScopeKey } : {}),
      ...(normalizedBaselineAttention ? { baselineAttention: normalizedBaselineAttention } : {}),
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
