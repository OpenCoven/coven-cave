import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import type { SessionRow } from "./types.ts";

type PendingProjection = {
  status: "pending";
  scopeKey: string;
};

type PersistedProjection = {
  status: "persisted";
  canonicalAfterRequestId: number;
  scopeKey: string;
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
): void {
  let operations = state.get(sessionId);
  if (!operations) {
    operations = new Map();
    state.set(sessionId, operations);
  }
  operations.set(operationId, { status: "pending", scopeKey });
}

export function settleChatAttentionClear(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
  outcome: ChatAttentionSettlementOutcome,
  canonicalAfterRequestId: number,
): void {
  const operations = state.get(sessionId);
  if (!operations?.has(operationId)) return;
  if (outcome === "failed") {
    operations.delete(operationId);
    if (operations.size === 0) state.delete(sessionId);
    return;
  }
  operations.set(operationId, {
    status: "persisted",
    canonicalAfterRequestId,
    scopeKey: operations.get(operationId)?.scopeKey ?? "all-familiars",
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
        row.attention.state === "none"
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
