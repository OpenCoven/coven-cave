/**
 * Creation-refresh lifecycle helper for new-compose chat sessions.
 *
 * Tracks whether the post-persistence `onSessionsChanged` call ("creation
 * refresh") is still owed for each brand-new chat generation. Eligibility is
 * keyed per `runId` so that two overlapping sessionless generations (A and B)
 * each track their own pending slot and complete independently.
 *
 * Invariants:
 * - Only a sessionless send (`initialSessionId === null`) creates a pending
 *   entry in `pendingRuns` for its `runId`.
 * - A retry with a non-null `initialSessionId` participates only when that
 *   session ID already has a pending entry (from the original failed creation);
 *   the retry's `runId` is added as an alias for the same creation session.
 * - Eligibility is bound to a specific server-assigned session ID via
 *   `onCreationSessionIdentified`. An unbound entry (`sessionId: null`) never
 *   refreshes — the caller must bind before calling `onDoneCreationRefresh`.
 * - A failed done with a bound session ID preserves the entry for retry.
 * - A failed done with no bound session removes the entry — it cannot be
 *   retried by session ID so there is nothing to preserve.
 * - A terminal non-done path (stream `error` event, abort, send exception)
 *   calls `onCreationRunTerminated` which removes unbound entries and preserves
 *   bound ones.
 * - A successful done removes all entries sharing the same `sessionId` (the
 *   original run and any retry aliases), preventing duplicate refreshes.
 * - A `runId` not present in `pendingRuns` (ordinary follow-up or unrelated
 *   generation) is a no-op for all helpers.
 */

export interface CreationRefreshState {
  readonly pendingRuns: Readonly<Record<string, { readonly sessionId: string | null; readonly isAlias?: true }>>;
}

/**
 * Call at the start of each `sendRaw` invocation.
 *
 * - Sessionless send (`initialSessionId === null`): adds a pending entry for
 *   `runId` with an unbound session ID.
 * - Retry (`initialSessionId !== null` and that session has a pending entry):
 *   prunes any prior retry aliases for that session, then adds `runId` as the
 *   sole alias so the retry participates in the same creation refresh. Repeated
 *   failed retries therefore leave exactly one alias entry rather than
 *   accumulating stale ones. The original creation entry (no `isAlias` flag) is
 *   always preserved.
 * - Ordinary follow-up (non-null `initialSessionId` with no matching pending
 *   entry): no-op.
 */
export function onSendStart(
  state: CreationRefreshState,
  runId: string,
  initialSessionId: string | null,
): CreationRefreshState {
  if (initialSessionId === null) {
    return { pendingRuns: { ...state.pendingRuns, [runId]: { sessionId: null } } };
  }
  // Retry: link this run to the pending creation session if the session ID is
  // already tracked (from a prior failed creation send).
  const hasPendingSession = Object.values(state.pendingRuns).some(
    (run) => run.sessionId === initialSessionId,
  );
  if (hasPendingSession) {
    // Prune prior retry aliases for this session before adding the new one so
    // repeated failed retries do not accumulate stale alias entries. The
    // original creation entry (where isAlias is absent) is preserved; only
    // entries explicitly marked isAlias are removed.
    const prunedRuns: Record<string, { readonly sessionId: string | null; readonly isAlias?: true }> = {};
    for (const [id, run] of Object.entries(state.pendingRuns)) {
      if (!(run.sessionId === initialSessionId && run.isAlias)) {
        prunedRuns[id] = run;
      }
    }
    return { pendingRuns: { ...prunedRuns, [runId]: { sessionId: initialSessionId, isAlias: true } } };
  }
  return state;
}

/**
 * Call when the server assigns a session ID to a new chat (the "session" SSE
 * event, or the done-event fallback). Binds the pending entry for `runId` to
 * the assigned session ID.
 *
 * Only a sessionless generation (`originSessionId === null`) may bind an
 * unbound (`sessionId: null`) entry. Retries (non-null origin, already bound)
 * and unrelated generations (not in `pendingRuns`) are no-ops.
 *
 * Idempotent: an already-bound entry is left unchanged.
 */
export function onCreationSessionIdentified(
  state: CreationRefreshState,
  runId: string,
  originSessionId: string | null,
  assignedId: string,
): CreationRefreshState {
  const run = state.pendingRuns[runId];
  if (run && run.sessionId === null && originSessionId === null) {
    return { pendingRuns: { ...state.pendingRuns, [runId]: { sessionId: assignedId } } };
  }
  return state;
}

/**
 * Call when a `done` event is received.
 *
 * Returns `shouldRefresh` (whether to call `onSessionsChanged`) and the next
 * state. Rules:
 * - If `runId` is not in `pendingRuns`: no-op (not a tracked creation run).
 * - If `isError` and the entry is bound: preserve the entry for same-ID retry;
 *   no refresh.
 * - If `isError` and the entry is unbound: remove the entry — an unbound run
 *   cannot be retried by session ID; no refresh.
 * - If the entry is unbound (`sessionId: null`) or the completed ID mismatches:
 *   no-op — the caller must bind via `onCreationSessionIdentified` first.
 * - On a successful matching completion: fire the refresh and remove all
 *   entries sharing `sessionId` (original run + retry aliases) so a duplicate
 *   or stale completion cannot double-refresh.
 */
export function onDoneCreationRefresh(
  state: CreationRefreshState,
  runId: string,
  completedSessionId: string | null | undefined,
  isError: boolean | undefined,
): { shouldRefresh: boolean; nextState: CreationRefreshState } {
  const run = state.pendingRuns[runId];
  if (!run) {
    return { shouldRefresh: false, nextState: state };
  }
  if (isError) {
    if (run.sessionId !== null) {
      // Bound: preserve for same-ID retry.
      return { shouldRefresh: false, nextState: state };
    }
    // Unbound: cannot retry by session ID — remove the entry.
    const nextPendingRuns = { ...state.pendingRuns };
    delete nextPendingRuns[runId];
    return { shouldRefresh: false, nextState: { pendingRuns: nextPendingRuns } };
  }
  if (!completedSessionId) {
    return { shouldRefresh: false, nextState: state };
  }
  if (run.sessionId === null || completedSessionId !== run.sessionId) {
    return { shouldRefresh: false, nextState: state };
  }
  // Matching bound ID: fire refresh and remove all entries for this creation
  // session (original run and any retry aliases).
  const targetSessionId = run.sessionId;
  const nextPendingRuns: Record<string, { readonly sessionId: string | null }> = {};
  for (const [id, r] of Object.entries(state.pendingRuns)) {
    if (r.sessionId !== targetSessionId) {
      nextPendingRuns[id] = r;
    }
  }
  return {
    shouldRefresh: true,
    nextState: { pendingRuns: nextPendingRuns },
  };
}

/**
 * Call at all terminal non-done paths (stream `error` event, user abort, send
 * exception) for a live generation to bound-check the pending entry.
 *
 * - If `runId` is not in `pendingRuns`: no-op.
 * - If the entry is unbound (`sessionId: null`): remove it — the generation
 *   ended without ever receiving a session ID, so it cannot be retried by
 *   session ID and must not linger in `pendingRuns` indefinitely.
 * - If the entry is bound: preserve it for same-ID retry.
 */
export function onCreationRunTerminated(
  state: CreationRefreshState,
  runId: string,
): CreationRefreshState {
  const run = state.pendingRuns[runId];
  if (!run || run.sessionId !== null) return state;
  const nextPendingRuns = { ...state.pendingRuns };
  delete nextPendingRuns[runId];
  return { pendingRuns: nextPendingRuns };
}
