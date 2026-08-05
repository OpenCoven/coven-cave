import {
  isCanonicalIsoInstant,
  NO_CHAT_ATTENTION,
  normalizeChatAttentionOperationId,
  type ChatAttention,
} from "./chat-attention.ts";
import type { SessionRow } from "./types.ts";

type PendingProjection = {
  status: "pending";
  scopeKey: string;
  baseline: ChatAttention | null;
  latestCanonical?: CanonicalAttentionTrackerEntry;
};

type PersistedProjection = {
  status: "persisted";
  canonicalAfterRequestId: number;
  scopeKey: string;
  baseline: ChatAttention | null;
  latestCanonical?: CanonicalAttentionTrackerEntry;
};

type ProjectionOperation = PendingProjection | PersistedProjection;
type SessionProjection = Map<string, ProjectionOperation>;

export type ChatAttentionProjectionState = Map<string, SessionProjection>;
export type ChatAttentionSettlementOutcome = "persisted" | "failed";
export type ChatAttentionClearRecordResult = {
  recorded: boolean;
  reason: "recorded" | "duplicate" | "tombstoned" | "no-baseline";
};
export type ChatAttentionSettlementResult =
  | {
    settled: false;
    reason: "unknown-operation";
  }
  | {
    settled: true;
    sessionId: string;
    operationId: string;
    outcome: "persisted";
  }
  | {
    settled: true;
    sessionId: string;
    operationId: string;
    outcome: "failed";
    scopeKey: string;
    restoreAttention: ChatAttention | null;
    restoreScopeKey: string;
    hasActiveProjection: boolean;
  };

export function createChatAttentionProjectionState(): ChatAttentionProjectionState {
  return new Map();
}

// Keep settled clears idempotent across late replays while bounding the whole
// state, including churn across many different sessions.
const CHAT_ATTENTION_TOMBSTONE_LIMIT = 512;
const chatAttentionTombstones = new WeakMap<ChatAttentionProjectionState, Map<string, true>>();

function tombstoneKey(sessionId: string, operationId: string): string {
  return `${sessionId.length}:${sessionId}${operationId}`;
}

function tombstonesForState(state: ChatAttentionProjectionState): Map<string, true> {
  let tombstones = chatAttentionTombstones.get(state);
  if (!tombstones) {
    tombstones = new Map();
    chatAttentionTombstones.set(state, tombstones);
  }
  return tombstones;
}

function tombstoneChatAttentionOperation(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
): void {
  const tombstones = tombstonesForState(state);
  const key = tombstoneKey(sessionId, operationId);
  tombstones.delete(key);
  tombstones.set(key, true);
  while (tombstones.size > CHAT_ATTENTION_TOMBSTONE_LIMIT) {
    const oldestKey = tombstones.keys().next().value;
    if (oldestKey === undefined) break;
    tombstones.delete(oldestKey);
  }
}

function isChatAttentionOperationTombstoned(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
): boolean {
  return chatAttentionTombstones.get(state)?.has(tombstoneKey(sessionId, operationId)) ?? false;
}

// Overlapping clears can only see projected "none", so keep the last accepted
// canonical attention per session and use it as the fallback baseline.
const CHAT_ATTENTION_CANONICAL_TRACKER_LIMIT = 512;
const CHAT_ATTENTION_SESSION_BUCKET_LIMIT = 512;
type CanonicalAttentionTrackerEntry = {
  attention: ChatAttention;
  scopeKey: string;
};
const lastKnownCanonicalAttention = new WeakMap<
  ChatAttentionProjectionState,
  Map<string, CanonicalAttentionTrackerEntry>
>();

function canonicalAttentionTrackerFor(
  state: ChatAttentionProjectionState,
): Map<string, CanonicalAttentionTrackerEntry> {
  let tracker = lastKnownCanonicalAttention.get(state);
  if (!tracker) {
    tracker = new Map();
    lastKnownCanonicalAttention.set(state, tracker);
  }
  return tracker;
}

function trackCanonicalAttention(
  state: ChatAttentionProjectionState,
  sessionId: string,
  attention: ChatAttention,
  scopeKey: string,
): void {
  const tracker = canonicalAttentionTrackerFor(state);
  tracker.delete(sessionId);
  tracker.set(sessionId, { attention, scopeKey });
  while (tracker.size > CHAT_ATTENTION_CANONICAL_TRACKER_LIMIT) {
    const oldestSessionId = tracker.keys().next().value;
    if (oldestSessionId === undefined) break;
    tracker.delete(oldestSessionId);
  }
}

function forgetLastKnownCanonicalAttention(state: ChatAttentionProjectionState, sessionId: string): void {
  lastKnownCanonicalAttention.get(state)?.delete(sessionId);
}

// With no live operation, canonical "none" retires stale retry evidence so a
// later, genuinely new attention baseline can occupy the slot.
function trackOrForgetCanonicalAttention(
  state: ChatAttentionProjectionState,
  sessionId: string,
  attention: ChatAttention,
  scopeKey: string,
): void {
  if (attention.state === "none") {
    forgetLastKnownCanonicalAttention(state, sessionId);
    return;
  }
  trackCanonicalAttention(state, sessionId, attention, scopeKey);
}

const sessionBucketAccessOrder = new WeakMap<ChatAttentionProjectionState, Map<string, true>>();

function sessionBucketAccessOrderFor(state: ChatAttentionProjectionState): Map<string, true> {
  let accessOrder = sessionBucketAccessOrder.get(state);
  if (!accessOrder) {
    accessOrder = new Map();
    sessionBucketAccessOrder.set(state, accessOrder);
  }
  return accessOrder;
}

function touchSessionProjectionBucket(state: ChatAttentionProjectionState, sessionId: string): void {
  const accessOrder = sessionBucketAccessOrderFor(state);
  accessOrder.delete(sessionId);
  accessOrder.set(sessionId, true);
}

function dropSessionProjectionBucket(state: ChatAttentionProjectionState, sessionId: string): void {
  state.delete(sessionId);
  sessionBucketAccessOrder.get(state)?.delete(sessionId);
}

function clearSessionProjectionState(state: ChatAttentionProjectionState, sessionId: string): void {
  dropSessionProjectionBucket(state, sessionId);
  forgetLastKnownCanonicalAttention(state, sessionId);
}

function sessionProjectionHasPendingOperation(operations: SessionProjection): boolean {
  for (const operation of operations.values()) {
    if (operation.status === "pending") return true;
  }
  return false;
}

// A single session's own operation map has no independent bound otherwise: a
// flood of off-list/overlapping clears that each mint a unique operation id
// for the SAME session grows this inner map without limit even while the
// outer per-session bucket count (CHAT_ATTENTION_SESSION_BUCKET_LIMIT) stays
// at one entry. Mirror the outer eviction's preference for the oldest
// non-pending (settled or already-retired) operation, only falling back to
// the oldest pending one when every tracked operation for the session is
// still live, and tombstone whatever is evicted so a late replay of its id
// cannot recreate an un-settleable projection.
const CHAT_ATTENTION_SESSION_OPERATION_LIMIT = 64;

function evictOldestSessionOperations(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operations: SessionProjection,
): void {
  while (operations.size > CHAT_ATTENTION_SESSION_OPERATION_LIMIT) {
    let oldestOperationId: string | undefined;
    let oldestPendingOperationId: string | undefined;
    for (const [operationId, operation] of operations) {
      oldestPendingOperationId ??= operationId;
      if (operation.status !== "pending") {
        oldestOperationId = operationId;
        break;
      }
    }
    const evictedOperationId = oldestOperationId ?? oldestPendingOperationId;
    if (!evictedOperationId) break;
    operations.delete(evictedOperationId);
    tombstoneChatAttentionOperation(state, sessionId, evictedOperationId);
  }
  if (operations.size === 0) {
    dropSessionProjectionBucket(state, sessionId);
  }
}

function evictOldestSessionProjectionBuckets(state: ChatAttentionProjectionState): void {
  const accessOrder = sessionBucketAccessOrderFor(state);
  while (state.size > CHAT_ATTENTION_SESSION_BUCKET_LIMIT) {
    let oldestSessionId: string | undefined;
    let oldestPendingSessionId: string | undefined;
    for (const sessionId of accessOrder.keys()) {
      const operations = state.get(sessionId);
      if (!operations) {
        accessOrder.delete(sessionId);
        continue;
      }
      oldestPendingSessionId ??= sessionId;
      if (!sessionProjectionHasPendingOperation(operations)) {
        oldestSessionId = sessionId;
        break;
      }
    }
    const evictedSessionId = oldestSessionId ?? oldestPendingSessionId;
    if (!evictedSessionId) break;
    const operations = state.get(evictedSessionId);
    if (!operations) {
      accessOrder.delete(evictedSessionId);
      continue;
    }
    for (const operationId of operations.keys()) {
      tombstoneChatAttentionOperation(state, evictedSessionId, operationId);
    }
    // Bound long-lived cross-session churn without discarding the last accepted
    // canonical fallback: an immediate retry can still inherit that baseline,
    // while the active clear projection yields to newer sessions under pressure.
    dropSessionProjectionBucket(state, evictedSessionId);
  }
}

export function chatAttentionProjectionScopeKey(familiarId: string | null): string {
  return familiarId ? `familiar:${familiarId}` : "all-familiars";
}

// Off-list baseline evidence has no accepted list-request provenance.
export const CHAT_ATTENTION_UNPROVEN_SCOPE = "scope:unproven";

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
  clearWatermark?: string | null,
): ChatAttentionClearRecordResult {
  if (isChatAttentionOperationTombstoned(state, sessionId, operationId)) {
    return { recorded: false, reason: "tombstoned" };
  }

  const operations = state.get(sessionId);
  const existingOperation = operations?.get(operationId);
  if (existingOperation) {
    // A duplicate/replayed clear for an operation that is still live (pending
    // or not yet forgotten) proves this session is actively in use. Refresh
    // its LRU recency here too, or a session hit only by replayed duplicates
    // (no fresh record ever reaching the touch below) would silently age out
    // and get evicted/tombstoned ahead of genuinely idle sessions.
    touchSessionProjectionBucket(state, sessionId);
    return { recorded: false, reason: "duplicate" };
  }
  const hasCanonicalAttention = canonicalAttention != null;
  const normalizedCanonical = hasCanonicalAttention ? normalizeAttentionSnapshot(canonicalAttention) : null;
  const canonicalTracker = canonicalAttentionTrackerFor(state);
  // The caller may already be looking at a projected "none", so overlap cases
  // must prefer the last accepted canonical row over event-carried fallback
  // evidence. The event baseline is only for cases where no accepted evidence
  // exists yet (off-list / adopted clears, etc).
  const trackedCanonical = canonicalTracker.get(sessionId)?.attention;
  const trackedNonNoneCanonical = trackedCanonical?.state !== "none" ? trackedCanonical : null;
  const baseline = trackedNonNoneCanonical ??
    (normalizedCanonical?.state !== "none" ? normalizedCanonical : null);
  const normalizedClearWatermark = normalizeIsoInstant(clearWatermark);
  // A valid watermark proves this is a modern real-send clear even when every
  // available cached/event baseline is already "none". It is admission
  // evidence only: clocks differ across devices, so reconciliation below must
  // never order this client timestamp against server-authored attention.
  if (!operations && !baseline && hasCanonicalAttention && !normalizedClearWatermark) {
    tombstoneChatAttentionOperation(state, sessionId, operationId);
    return { recorded: false, reason: "no-baseline" };
  }

  const nextOperations = operations ?? new Map<string, ProjectionOperation>();
  if (!operations) state.set(sessionId, nextOperations);
  if (baseline && !canonicalTracker.has(sessionId)) {
    trackCanonicalAttention(state, sessionId, baseline, scopeKey);
  }
  nextOperations.set(operationId, {
    status: "pending",
    scopeKey,
    baseline,
  });
  touchSessionProjectionBucket(state, sessionId);
  evictOldestSessionOperations(state, sessionId, nextOperations);
  evictOldestSessionProjectionBuckets(state);
  return { recorded: true, reason: "recorded" };
}

export function settleChatAttentionClear(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
  outcome: ChatAttentionSettlementOutcome,
  canonicalAfterRequestId: number,
): ChatAttentionSettlementResult {
  const operations = state.get(sessionId);
  const operation = operations?.get(operationId);
  if (!operations || !operation) {
    return { settled: false, reason: "unknown-operation" };
  }
  touchSessionProjectionBucket(state, sessionId);
  if (outcome === "failed") {
    operations.delete(operationId);
    const restoreAttention = operation.latestCanonical?.attention ?? operation.baseline;
    const restoreScopeKey = operation.latestCanonical?.scopeKey ?? operation.scopeKey;
    // Keep the canonical tracker until either an immediate retry inherits it or
    // an accepted list response refreshes the caller's canonical session rows.
    if (operations.size === 0) dropSessionProjectionBucket(state, sessionId);
    tombstoneChatAttentionOperation(state, sessionId, operationId);
    return {
      settled: true,
      sessionId,
      operationId,
      outcome,
      scopeKey: operation.scopeKey,
      restoreAttention,
      restoreScopeKey,
      hasActiveProjection: operations.size > 0,
    };
  }
  operations.set(operationId, {
    status: "persisted",
    canonicalAfterRequestId,
    scopeKey: operation.scopeKey,
    baseline: operation.baseline,
    latestCanonical: operation.latestCanonical,
  });
  return { settled: true, sessionId, operationId, outcome };
}

export function forgetChatAttentionProjections(
  state: ChatAttentionProjectionState,
  sessionIds: readonly string[],
): void {
  for (const sessionId of sessionIds) {
    clearSessionProjectionState(state, sessionId);
  }
  // Settled tombstones stay in the bounded state-wide replay cache so queued
  // late clears cannot recreate projections after the row itself is forgotten.
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

export function applyChatAttentionSettlementToRows(
  rows: readonly SessionRow[],
  settlement: ChatAttentionSettlementResult,
  currentRowScopeKey: string,
): SessionRow[] {
  if (!settlement.settled || settlement.outcome !== "failed") return rows as SessionRow[];
  if (!settlement.hasActiveProjection && settlement.restoreScopeKey !== currentRowScopeKey) {
    return rows as SessionRow[];
  }

  let changed = false;
  const projectedRows = rows.map((row) => {
    if (row.id !== settlement.sessionId) return row;
    if (settlement.hasActiveProjection) {
      const projected = clearSessionAttention(row);
      changed = changed || projected !== row;
      return projected;
    }
    if (!settlement.restoreAttention || row.attention.state !== "none") return row;
    changed = true;
    return { ...row, attention: settlement.restoreAttention };
  });
  return changed ? projectedRows : rows as SessionRow[];
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

function attentionMatchesBaseline(attention: ChatAttention, baseline: ChatAttention | null | undefined): boolean {
  if (!baseline) return false;
  // Attention state can age from awaiting-human -> overdue-human without any
  // underlying request change. Treat the stable evidence identity (since +
  // reason) as authoritative, while canonical none still counts as a release.
  return attentionIdentity(attention) === attentionIdentity(baseline);
}

function normalizeIsoInstant(value: string | null | undefined): string | null {
  return isCanonicalIsoInstant(value) ? value : null;
}

export function applyChatAttentionProjections(
  state: ChatAttentionProjectionState,
  rows: readonly SessionRow[],
  responseRequestId: number,
  currentScopeKey?: string,
): SessionRow[] {
  const canonicalTracker = canonicalAttentionTrackerFor(state);
  let changed = false;
  const projectedRows = rows.map((row) => {
    const operations = state.get(row.id);
    if (!operations) {
      const retainedCanonical = canonicalTracker.get(row.id);
      if (retainedCanonical) {
        trackOrForgetCanonicalAttention(
          state,
          row.id,
          row.attention,
          currentScopeKey ?? retainedCanonical.scopeKey,
        );
      }
      return row;
    }

    touchSessionProjectionBucket(state, row.id);
    // Refresh real canonical attention before masking it again. Canonical none
    // can settle a persisted operation below, but while any operation is live
    // it must not erase the non-none baseline a failed clear will retry from.
    if (row.attention.state !== "none") {
      trackCanonicalAttention(
        state,
        row.id,
        row.attention,
        currentScopeKey ?? operations.values().next().value?.scopeKey ?? "all-familiars",
      );
    }

    for (const [operationId, operation] of operations) {
      operation.latestCanonical = {
        attention: normalizeAttentionSnapshot(row.attention),
        scopeKey: currentScopeKey ?? operation.scopeKey,
      };
      if (operation.status !== "persisted" || responseRequestId < operation.canonicalAfterRequestId) continue;
      if (operation.baseline) {
        if (!attentionMatchesBaseline(row.attention, operation.baseline)) {
          operations.delete(operationId);
          tombstoneChatAttentionOperation(state, row.id, operationId);
        }
        continue;
      }
      if (row.attention.state === "none") {
        operations.delete(operationId);
        tombstoneChatAttentionOperation(state, row.id, operationId);
        continue;
      }
      if (
        normalizeChatAttentionOperationId(row.attentionAfterOperationId) ===
        operationId
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

  // Session lists are filtered by familiar/project and the all-familiars view
  // collapses rows, so absence is never release evidence. Explicit rows above
  // or forgetChatAttentionProjections retire state; existing bounds cap churn.
  return changed ? projectedRows : rows as SessionRow[];
}
