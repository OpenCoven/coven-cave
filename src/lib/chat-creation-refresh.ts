/**
 * Creation-refresh lifecycle helper for new-compose chat sessions.
 *
 * Tracks whether the post-persistence `onSessionsChanged` call ("creation
 * refresh") is still owed for a brand-new chat. The key invariants:
 *
 * - Eligibility is set only when the first send starts with no existing
 *   session ID (i.e. this is a genuinely new conversation).
 * - Once the server assigns a session ID (the "session" SSE event), eligibility
 *   is bound to that specific ID via `onCreationSessionIdentified`. Completions
 *   for other (existing) sessions must not consume the pending refresh.
 * - A failed first send preserves eligibility (and the bound ID) so a retry
 *   can still trigger the refresh.
 * - Eligibility is cleared only after the first successful `done` event for the
 *   bound creation session fires the refresh.
 * - Follow-up sends on an already-established session are never eligible.
 */

export interface CreationRefreshState {
  /** True when a successful `done` event should fire `onSessionsChanged`. */
  readonly pendingCreationRefresh: boolean;
  /**
   * The server-assigned session ID for the in-flight new chat, bound by
   * `onCreationSessionIdentified` when the "session" SSE event arrives.
   * Null when pending but not yet identified (race: done may arrive before
   * session event; in that case, accept the first success as the creation ID).
   */
  readonly creationSessionId: string | null;
}

/**
 * Call at the start of each `sendRaw` invocation.
 *
 * If `initialSessionId` is `null` (brand-new chat) and the state is not yet
 * eligible, marks it eligible with an unbound session ID.  If already eligible
 * (retry after a failed first send whose "session" event promoted the id),
 * preserves eligibility. A non-null `initialSessionId` with a currently
 * ineligible state means this is a follow-up send — state is left unchanged.
 */
export function onSendStart(
  state: CreationRefreshState,
  initialSessionId: string | null,
): CreationRefreshState {
  if (!state.pendingCreationRefresh && initialSessionId === null) {
    return { pendingCreationRefresh: true, creationSessionId: null };
  }
  return state;
}

/**
 * Call when the server assigns a session ID to a new chat (the "session" SSE
 * event, or the done-event fallback). Binds the pending refresh to that ID so
 * completions for unrelated existing sessions don't consume it.
 *
 * Idempotent: once bound, further calls with any ID are no-ops.
 */
export function onCreationSessionIdentified(
  state: CreationRefreshState,
  sessionId: string,
): CreationRefreshState {
  if (state.pendingCreationRefresh && state.creationSessionId === null) {
    return { ...state, creationSessionId: sessionId };
  }
  return state;
}

/**
 * Call when a `done` event is received.
 *
 * Returns `shouldRefresh` (whether to call `onSessionsChanged`) and the next
 * state. The refresh fires exactly once: on the first successful completion of
 * the bound creation session. A failed done leaves the state and bound ID
 * unchanged for retry. A completion for a different existing session (ID
 * mismatch, or state not yet bound) does not refresh or consume the pending
 * state.
 *
 * **Caller contract:** ChatView must call `onCreationSessionIdentified` with
 * the generation's session ID (from the "session" SSE event or the done-event
 * fallback) BEFORE invoking this function. An unbound pending state here is
 * treated as a mismatch — no auto-accept — so missing the binding does not
 * silently consume eligibility.
 */
export function onDoneCreationRefresh(
  state: CreationRefreshState,
  isError: boolean | undefined,
  sessionId: string | null | undefined,
): { shouldRefresh: boolean; nextState: CreationRefreshState } {
  if (!isError && state.pendingCreationRefresh && sessionId) {
    // Must be bound to a specific creation session ID that matches the incoming
    // completion. Unbound (null) is treated identically to a mismatch: the
    // caller is expected to have bound via onCreationSessionIdentified first.
    if (state.creationSessionId === null || sessionId !== state.creationSessionId) {
      return { shouldRefresh: false, nextState: state };
    }
    // Matching bound ID: fire the refresh and clear eligibility.
    return { shouldRefresh: true, nextState: { pendingCreationRefresh: false, creationSessionId: null } };
  }
  return { shouldRefresh: false, nextState: state };
}
