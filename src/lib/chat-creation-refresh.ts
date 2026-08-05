/**
 * Creation-refresh lifecycle helper for new-compose chat sessions.
 *
 * Tracks whether the post-persistence `onSessionsChanged` call ("creation
 * refresh") is still owed for a brand-new chat. The key invariants:
 *
 * - Eligibility is set only when the first send starts with no existing
 *   session ID (i.e. this is a genuinely new conversation).
 * - A failed first send preserves eligibility so a retry can still trigger
 *   the refresh. (The "session" event may promote a server-assigned ID before
 *   the error arrives; re-using that ID as `initialSessionId` on the retry
 *   must not cancel the refresh.)
 * - Eligibility is cleared only after the first successful `done` event fires
 *   the refresh.
 * - Follow-up sends on an already-established session are never eligible.
 */

export interface CreationRefreshState {
  /** True when a successful `done` event should fire `onSessionsChanged`. */
  readonly pendingCreationRefresh: boolean;
}

/**
 * Call at the start of each `sendRaw` invocation.
 *
 * If `initialSessionId` is `null` (brand-new chat) and the state is not yet
 * eligible, marks it eligible.  If already eligible (retry after a failed
 * first send whose "session" event promoted the id), preserves eligibility.
 * A non-null `initialSessionId` with a currently ineligible state means this
 * is a follow-up send — state is left unchanged.
 */
export function onSendStart(
  state: CreationRefreshState,
  initialSessionId: string | null,
): CreationRefreshState {
  if (!state.pendingCreationRefresh && initialSessionId === null) {
    return { pendingCreationRefresh: true };
  }
  return state;
}

/**
 * Call when a `done` event is received.
 *
 * Returns `shouldRefresh` (whether to call `onSessionsChanged`) and the next
 * state. The refresh fires exactly once: on the first successful completion of
 * a new chat. A failed done leaves the state eligible for the next retry.
 */
export function onDoneCreationRefresh(
  state: CreationRefreshState,
  isError: boolean | undefined,
  sessionId: string | null | undefined,
): { shouldRefresh: boolean; nextState: CreationRefreshState } {
  if (!isError && state.pendingCreationRefresh && sessionId) {
    return { shouldRefresh: true, nextState: { pendingCreationRefresh: false } };
  }
  return { shouldRefresh: false, nextState: state };
}
