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

// A late-arriving duplicate `recordChatAttentionClear` for an operation this
// projection has ALREADY settled (either failed and removed, or persisted and
// then released by canonical evidence) must not resurrect it. The in-memory
// operation itself is gone by the time that replay lands — a
// registry-subscription can enqueue a pending snapshot before an earlier
// failed-send settlement and only deliver it after — so idempotency needs a
// tombstone that survives the operation's removal. Tombstones are scoped per
// ChatAttentionProjectionState via a WeakMap so they never outlive the state
// (and thus the ChatView instance) that recorded them, and are bounded via a
// FIFO so a long-lived app session cannot accumulate unbounded memory from
// sessions/operations that come and go over the app's lifetime.
const CHAT_ATTENTION_TOMBSTONE_LIMIT = 256;
const chatAttentionTombstones = new WeakMap<ChatAttentionProjectionState, Map<string, string>>();

function chatAttentionTombstoneKey(sessionId: string, operationId: string): string {
  return `${sessionId}\u0000${operationId}`;
}

function tombstoneChatAttentionOperation(
  state: ChatAttentionProjectionState,
  sessionId: string,
  operationId: string,
): void {
  let tombstones = chatAttentionTombstones.get(state);
  if (!tombstones) {
    tombstones = new Map();
    chatAttentionTombstones.set(state, tombstones);
  }
  const key = chatAttentionTombstoneKey(sessionId, operationId);
  // Re-inserting (delete then set) moves this entry to the freshest end of
  // the Map's iteration order, so the FIFO eviction below always reclaims the
  // truly oldest tombstone rather than one that was merely inserted first.
  tombstones.delete(key);
  tombstones.set(key, sessionId);
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
  return chatAttentionTombstones.get(state)?.has(chatAttentionTombstoneKey(sessionId, operationId)) ?? false;
}

function forgetChatAttentionTombstones(
  state: ChatAttentionProjectionState,
  sessionIds: readonly string[],
): void {
  const tombstones = chatAttentionTombstones.get(state);
  if (!tombstones) return;
  const forgottenSessionIds = new Set(sessionIds);
  for (const [key, sessionId] of tombstones) {
    if (forgottenSessionIds.has(sessionId)) tombstones.delete(key);
  }
}

// Overlapping operations on the SAME session (op1 clears, then op2 clears
// again before op1's canonical evidence lands) must each baseline against
// the latest known canonical attention, never against a sibling operation's
// (possibly much older) baseline and never against the optimistic projected
// "none" a caller reading through applyChatAttentionProjections' masked
// output would see while ANY operation is still active for that session.
// Without this, a new op2 starting while op1 is still pending or
// not-yet-released would silently inherit op1's stale baseline A even after
// a genuine new canonical request B has been observed — so a later poll
// reporting B (which legitimately still matches B, not A) would be judged a
// mismatch against A and falsely retire op2 before it ever got a chance to
// settle. Tracked per ChatAttentionProjectionState via a WeakMap (same
// lifetime discipline as the tombstone set above) and refreshed by
// applyChatAttentionProjections on every row it actually inspects, so it
// always reflects the most recent real canonical evidence for that session —
// distinct from any single operation's own recorded baseline.
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
  // Idempotency across the operation's full lifetime, not just while it is
  // still tracked: once (sessionId, operationId) has settled — failed and
  // been removed, or persisted and later released by canonical evidence —
  // a tombstone survives that removal so a late-arriving duplicate clear
  // (e.g. a registry-subscription's queued pending snapshot delivered after
  // its own failed-send settlement already ran) is ignored rather than
  // re-adding a pending operation nothing will ever settle again.
  if (isChatAttentionOperationTombstoned(state, sessionId, operationId)) return;

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
  const normalizedCanonical = normalizeAttentionSnapshot(canonicalAttention);
  const canonicalTracker = canonicalAttentionTrackerFor(state);
  // A brand-new operation (no existingOperation) must NEVER inherit another
  // operation's baseline — that is the overlap bug this guards against. A
  // genuine, non-"none" reading is trusted directly: the caller observed real
  // canonical attention, so it IS the latest known canonical, full stop. Only
  // when the reading collapses to "none" — which can be a masked read of a
  // session with an active projection rather than genuine canonical absence —
  // do we fall back to the tracked last-known canonical for this session
  // (kept fresh by applyChatAttentionProjections below), and only then to the
  // "none" reading itself if nothing has ever been tracked for it.
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
  // An unknown (sessionId, operationId) is ignored rather than tombstoned:
  // real event ordering never guarantees settle follows clear for a pair
  // this projection never recorded, so tombstoning here on nothing but an
  // unrecognized settlement could permanently block a legitimate future
  // clear for that same id pair.
  if (!operations || !operation) return;
  if (outcome === "failed") {
    operations.delete(operationId);
    if (operations.size === 0) {
      state.delete(sessionId);
      forgetLastKnownCanonicalAttention(state, sessionId);
    }
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
    state.delete(sessionId);
    forgetLastKnownCanonicalAttention(state, sessionId);
  }
  forgetChatAttentionTombstones(state, sessionIds);
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

    // This is the one place a genuine, unmasked canonical reading for a
    // tracked session passes through — refresh the tracker with it so a NEW
    // overlapping operation that only ever sees this function's masked
    // output still baselines against the real latest canonical (row.attention
    // here, before clearSessionAttention below optimistically hides it),
    // rather than a sibling operation's now-stale baseline.
    canonicalTracker.set(row.id, row.attention);

    for (const [operationId, operation] of operations) {
      if (
        operation.status === "persisted" &&
        responseRequestId >= operation.canonicalAfterRequestId &&
        !attentionMatchesBaseline(row.attention, operation.baseline)
      ) {
        operations.delete(operationId);
        // Canonical evidence just proved this operation is done. Tombstone it
        // too — otherwise a queued late clear for this same operationId
        // (delivered after this release, e.g. a stale registry-subscription
        // replay) would re-add a pending projection nothing will ever settle
        // again, hiding attention this release just correctly restored.
        tombstoneChatAttentionOperation(state, row.id, operationId);
      }
    }
    if (operations.size === 0) {
      state.delete(row.id);
      forgetLastKnownCanonicalAttention(state, row.id);
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
          // Same tombstone rationale as the present-row release above: proven
          // absence is canonical evidence this operation is done, so a
          // queued late clear for it must not be allowed to reopen it.
          tombstoneChatAttentionOperation(state, sessionId, operationId);
        }
      }
      if (operations.size === 0) {
        state.delete(sessionId);
        forgetLastKnownCanonicalAttention(state, sessionId);
      }
    }
  }

  return changed ? projectedRows : rows as SessionRow[];
}
