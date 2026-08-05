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
const MODERN_CLEAR_DETAIL_KEYS = [
  "operationId",
  "scopeKey",
  "clearWatermark",
  "baselineAttention",
] as const;

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

function isExactlyNull(value: unknown): value is null {
  return value === null;
}

// Enforces the canonical BaselineAttention combos so a malformed or spoofed
// event can never fabricate an impossible attention snapshot:
//   - "none"            -> since AND reason must both be null.
//   - "left-hanging"     -> a canonical UTC ISO `since`, reason must be null.
//   - "awaiting-human" /
//     "overdue-human"    -> a canonical UTC ISO `since` AND a recognized,
//                           non-null reason.
// Evidence fields (`since`, `reason`) are validated against their EXACT
// original value — never trimmed or otherwise coerced, unlike sessionId /
// operationId / scopeKey below. A same-document CustomEvent's `detail` is a
// live object reference, not a serialized payload: a genuine ChatAttention
// always carries a literal `null`, a canonical UTC ISO string, or a
// recognized reason string, so a whitespace-padded string, a number, a
// plain object, or `undefined` is real evidence of a malformed or spoofed
// payload rather than a formatting accident worth normalizing away.
// A non-canonical timestamp or any other since/reason combo is rejected
// outright (returns null) rather than silently coerced.
function normalizeAttentionDetail(value: unknown): ChatAttention | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isChatAttentionState(candidate.state)) return null;
  const state = candidate.state;
  const since = candidate.since;
  const reason = candidate.reason;

  switch (state) {
  case "none":
    return isExactlyNull(since) && isExactlyNull(reason)
      ? { state, since: null, reason: null }
      : null;
  case "left-hanging":
    return isCanonicalIsoInstant(since) && isExactlyNull(reason)
      ? { state, since, reason: null }
      : null;
  case "awaiting-human":
  case "overdue-human":
    return isCanonicalIsoInstant(since) && isChatAttentionReason(reason)
      ? { state, since, reason }
      : null;
  }
}

function normalizeClearWatermark(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized && isCanonicalIsoInstant(normalized) ? normalized : null;
}

function hasOwnDetailField(detail: Record<string, unknown> | null | undefined, key: string): boolean {
  return !!detail && Object.prototype.hasOwnProperty.call(detail, key);
}

function attentionEventDetail(event: Event, type: string): ChatAttentionClearDetail | null {
  if (event.type !== type) return null;
  const detail = (event as CustomEvent<Record<string, unknown> | null>).detail;
  const sessionId = normalizeString(detail?.sessionId);
  const operationId = normalizeString(detail?.operationId);
  const hasClearWatermark = hasOwnDetailField(detail, "clearWatermark");
  const clearWatermark = hasClearWatermark && isCanonicalIsoInstant(detail?.clearWatermark)
    ? detail.clearWatermark
    : null;
  const scopeKey = normalizeString(detail?.scopeKey);
  const hasBaselineAttention = hasOwnDetailField(detail, "baselineAttention");
  const baselineAttention = hasBaselineAttention
    ? normalizeAttentionDetail(detail?.baselineAttention)
    : null;
  if (hasClearWatermark && !clearWatermark) return null;
  if (hasBaselineAttention && !baselineAttention) return null;
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
  const sessionId = normalizeString(detail?.sessionId);
  if (!sessionId || !detail || typeof detail !== "object") return null;
  if (Object.keys(detail).length !== 1 || !hasOwnDetailField(detail, "sessionId")) return null;
  if (MODERN_CLEAR_DETAIL_KEYS.some((key) => hasOwnDetailField(detail, key))) return null;
  return sessionId;
}

export function attentionSettlementFromEvent(event: Event): ChatAttentionSettlementDetail | null {
  const detail = attentionEventDetail(event, CHAT_ATTENTION_SETTLE_EVENT);
  if (!detail) return null;
  const outcome = (event as CustomEvent<Record<string, unknown> | null>).detail?.outcome;
  return outcome === "persisted" || outcome === "failed"
    ? { ...detail, outcome }
    : null;
}
