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

// Keep settled clears idempotent across late replays without letting unrelated
// session churn evict another session's replay protection.
const CHAT_ATTENTION_TOMBSTONE_LIMIT = 256;
type SessionTombstones = Set<string>;
const chatAttentionTombstones = new WeakMap<ChatAttentionProjectionState, Map<string, SessionTombstones>>();

function tombstonesForState(state: ChatAttentionProjectionState): Map<string, SessionTombstones> {
  let tombstones = chatAttentionTombstones.get(state);
  if (!tombstones) {
    tombstones = new Map();
    chatAttentionTombstones.set(state, tombstones);
  }
  return tombstones;
}

function tombstonesForSession(state: ChatAttentionProjectionState, sessionId: string): SessionTombstones {
  const tombstones = tombstonesForState(state);
  let sessionTombstones = tombstones.get(sessionId);
  if (!sessionTombstones) {
    sessionTombstones = new Set();
    tombstones.set(sessionId, sessionTombstones);
  }
  return sessionTombstones;
}

function tombstoneChatAttentionOperation(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
): void {
  const sessionTombstones = tombstonesForSession(state, sessionId);
  sessionTombstones.delete(operationId);
  sessionTombstones.add(operationId);
  while (sessionTombstones.size > CHAT_ATTENTION_TOMBSTONE_LIMIT) {
    const oldestOperationId = sessionTombstones.values().next().value;
    if (oldestOperationId === undefined) break;
    sessionTombstones.delete(oldestOperationId);
  }
}

function isChatAttentionOperationTombstoned(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
): boolean {
  return chatAttentionTombstones.get(state)?.get(sessionId)?.has(operationId) ?? false;
}

// Overlapping clears can only see projected "none", so keep the last accepted
// canonical attention per session and use it as the fallback baseline.
const lastKnownCanonicalAttention = new WeakMap<ChatAttentionProjectionState, Map<string, ChatAttention>>();

function canonicalAttentionTrackerFor(state: ChatAttentionProjectionState): Map<string, ChatAttention> {
  let tracker = lastKnownCanonicalAttention.get(state);
  if (!tracker) {
    tracker = new Map();
    lastKnownCanonicalAttention.set(state, tracker);
  }
  return tracker;
}

function forgetLastKnownCanonicalAttention(state: ChatAttentionProjectionState, sessionId: string): void {
  lastKnownCanonicalAttention.get(state)?.delete(sessionId);
}

function clearSessionProjectionState(state: ChatAttentionProjectionState, sessionId: string): void {
  state.delete(sessionId);
  forgetLastKnownCanonicalAttention(state, sessionId);
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
  if (isChatAttentionOperationTombstoned(state, sessionId, operationId)) return;

  const operations = state.get(sessionId);
  const existingOperation = operations?.get(operationId);
  if (existingOperation?.status === "persisted") return;
  const normalizedCanonical = normalizeAttentionSnapshot(canonicalAttention);
  const canonicalTracker = canonicalAttentionTrackerFor(state);
  // The caller may already be looking at a projected "none", so overlap cases
  // fall back to the last accepted canonical attention for this session.
  const baseline = existingOperation?.baseline ??
    (normalizedCanonical.state !== "none"
      ? normalizedCanonical
      : canonicalTracker.get(sessionId) ?? normalizedCanonical);
  if (!operations && baseline.state === "none") return;

  const nextOperations = operations ?? new Map<string, ProjectionOperation>();
  if (!operations) state.set(sessionId, nextOperations);
  if (!canonicalTracker.has(sessionId)) canonicalTracker.set(sessionId, baseline);
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
    if (operations.size === 0) clearSessionProjectionState(state, sessionId);
    tombstoneChatAttentionOperation(state, sessionId, operationId);
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
  for (const sessionId of sessionIds) {
    clearSessionProjectionState(state, sessionId);
  }
  // Settled tombstones stay until this state is GC'd so queued late clears
  // cannot recreate projections after the row itself has been forgotten.
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
  const canonicalTracker = canonicalAttentionTrackerFor(state);
  let changed = false;
  const projectedRows = rows.map((row) => {
    const operations = state.get(row.id);
    if (!operations) return row;

    // Refresh from the accepted row before masking it again for active clears.
    canonicalTracker.set(row.id, row.attention);

    for (const [operationId, operation] of operations) {
      if (
        operation.status === "persisted" &&
        responseRequestId >= operation.canonicalAfterRequestId &&
        !attentionMatchesBaseline(row.attention, operation.baseline)
      ) {
        operations.delete(operationId);
        tombstoneChatAttentionOperation(state, row.id, operationId);
      }
    }
    if (operations.size === 0) {
      clearSessionProjectionState(state, row.id);
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
          tombstoneChatAttentionOperation(state, sessionId, operationId);
        }
      }
      if (operations.size === 0) {
        clearSessionProjectionState(state, sessionId);
      }
    }
  }

  return changed ? projectedRows : rows as SessionRow[];
}
