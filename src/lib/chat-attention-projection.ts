import { NO_CHAT_ATTENTION, type ChatAttention } from "./chat-attention.ts";
import type { SessionRow } from "./types.ts";

type PendingProjection = {
  status: "pending";
  scopeKey: string;
  baseline: ChatAttention;
};

type PersistedProjection = {
  status: "persisted";
  canonicalAfterRequestId: number;
  scopeKey: string;
  baseline: ChatAttention;
};

type ProjectionOperation = PendingProjection | PersistedProjection;
type SessionProjection = Map<string, ProjectionOperation>;

export type ChatAttentionProjectionState = Map<string, SessionProjection>;
export type ChatAttentionSettlementOutcome = "persisted" | "failed";

export function createChatAttentionProjectionState(): ChatAttentionProjectionState {
  return new Map();
}

export function chatAttentionProjectionScopeKey(familiarId: string | null): string {
  return familiarId ? `familiar:${familiarId}` : "all-familiars";
}

export function isCurrentSessionListRequest(args: {
  requestId: number;
  currentRequestId: number;
  capturedScopeKey: string;
  currentScopeKey: string;
}): boolean {
  return args.requestId === args.currentRequestId &&
    args.capturedScopeKey === args.currentScopeKey;
}

export function recordChatAttentionClear(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
  scopeKey: string,
  canonicalAttention: ChatAttention | null | undefined,
): void {
  const operations = state.get(sessionId);
  const existingOperation = operations?.get(operationId);
  // Idempotency for a repeated (sessionId, operationId): once an operation has
  // settled to "persisted" it is done — a stale/duplicate pending
  // notification for the SAME operationId (e.g. a late registry-subscription
  // replay racing its own settle) must never downgrade it back to "pending"
  // or touch its recorded canonicalAfterRequestId. Recording is a no-op here;
  // the persisted entry already carries everything applyChatAttentionProjections
  // needs to retire it once a fresh canonical response proves it safe.
  if (existingOperation?.status === "persisted") return;
  const inheritedBaseline = existingOperation?.baseline ?? operations?.values().next().value?.baseline;
  const baseline = inheritedBaseline ?? normalizeAttentionSnapshot(canonicalAttention);
  if (!operations && baseline.state === "none") return;

  const nextOperations = operations ?? new Map<string, ProjectionOperation>();
  if (!operations) state.set(sessionId, nextOperations);
  nextOperations.set(operationId, {
    status: "pending",
    scopeKey: existingOperation?.scopeKey ?? scopeKey,
    baseline,
  });
}

export function settleChatAttentionClear(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
  outcome: ChatAttentionSettlementOutcome,
  canonicalAfterRequestId: number,
): void {
  const operations = state.get(sessionId);
  const operation = operations?.get(operationId);
  if (!operations || !operation) return;
  if (outcome === "failed") {
    operations.delete(operationId);
    if (operations.size === 0) state.delete(sessionId);
    return;
  }
  operations.set(operationId, {
    status: "persisted",
    canonicalAfterRequestId,
    scopeKey: operation.scopeKey,
    baseline: operation.baseline,
  });
}

export function forgetChatAttentionProjections(
  state: ChatAttentionProjectionState,
  sessionIds: readonly string[],
): void {
  for (const sessionId of sessionIds) state.delete(sessionId);
}

function clearSessionAttention(row: SessionRow): SessionRow {
  return row.attention.state === "none"
    ? row
    : { ...row, attention: NO_CHAT_ATTENTION };
}

export function clearSessionAttentionRows(rows: readonly SessionRow[], sessionId: string): SessionRow[] {
  let changed = false;
  const projectedRows = rows.map((row) => {
    if (row.id !== sessionId) return row;
    const projected = clearSessionAttention(row);
    changed = changed || projected !== row;
    return projected;
  });
  return changed ? projectedRows : rows as SessionRow[];
}

function scopeProvesAbsence(retainedScopeKey: string, currentScopeKey: string): boolean {
  return currentScopeKey === "all-familiars" || retainedScopeKey === currentScopeKey;
}

function normalizeAttentionSnapshot(attention: ChatAttention | null | undefined): ChatAttention {
  return {
    state: attention?.state ?? "none",
    since: attention?.since ?? null,
    reason: attention?.reason ?? null,
  };
}

function attentionIdentity(attention: ChatAttention): string {
  const normalized = normalizeAttentionSnapshot(attention);
  if (normalized.state === "none") return "none";
  return `${normalized.since ?? ""}\u0000${normalized.reason ?? ""}`;
}

function attentionMatchesBaseline(attention: ChatAttention, baseline: ChatAttention): boolean {
  // Attention state can age from awaiting-human -> overdue-human without any
  // underlying request change. Treat the stable evidence identity (since +
  // reason) as authoritative, while canonical none still counts as a release.
  return attentionIdentity(attention) === attentionIdentity(baseline);
}

export function applyChatAttentionProjections(
  state: ChatAttentionProjectionState,
  rows: readonly SessionRow[],
  responseRequestId: number,
  currentScopeKey?: string,
): SessionRow[] {
  const presentSessionIds = new Set(rows.map((row) => row.id));
  let changed = false;
  const projectedRows = rows.map((row) => {
    const operations = state.get(row.id);
    if (!operations) return row;

    for (const [operationId, operation] of operations) {
      if (
        operation.status === "persisted" &&
        responseRequestId >= operation.canonicalAfterRequestId &&
        !attentionMatchesBaseline(row.attention, operation.baseline)
      ) {
        operations.delete(operationId);
      }
    }
    if (operations.size === 0) {
      state.delete(row.id);
      return row;
    }

    const projected = clearSessionAttention(row);
    changed = changed || projected !== row;
    return projected;
  });

  if (currentScopeKey) {
    for (const [sessionId, operations] of state) {
      if (presentSessionIds.has(sessionId)) continue;
      for (const [operationId, operation] of operations) {
        const canTrustAbsence = operation.status === "persisted" &&
          responseRequestId >= operation.canonicalAfterRequestId;
        if (canTrustAbsence && scopeProvesAbsence(operation.scopeKey, currentScopeKey)) {
          operations.delete(operationId);
        }
      }
      if (operations.size === 0) state.delete(sessionId);
    }
  }

  return changed ? projectedRows : rows as SessionRow[];
}
