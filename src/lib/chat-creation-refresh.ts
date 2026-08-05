/**
 * Creation-refresh lifecycle helper for new-compose chat sessions.
 *
 * Eligibility is keyed by server-assigned session ID. Two overlapping
 * sessionless generations (A and B) each track their own pending slot and
 * complete independently. Failed A does not block fresh B.
 *
 * Invariants:
 * - Only a sessionless generation (`originSessionId === null`) adds an ID to
 *   `pendingIds` via `onCreationSessionIdentified`.
 * - Retries and follow-ups (non-null `originSessionId`) are no-ops for
 *   `onCreationSessionIdentified`. A retry's session ID was added when its
 *   original send failed and kept pending, so `onDoneCreationRefresh` finds it.
 * - `onDoneCreationRefresh` refreshes iff `completedSessionId` is in
 *   `pendingIds`. On success, removes only that ID (once-only guarantee). On
 *   failure, preserves it for retry.
 * - Existing-session generations whose ID was never added to `pendingIds` are
 *   no-ops throughout.
 */

export interface CreationRefreshState {
  readonly pendingIds: ReadonlySet<string>;
}

export const CREATION_REFRESH_INITIAL: CreationRefreshState = { pendingIds: new Set() };

/**
 * Call when the server assigns a session ID to a new chat (the "session" SSE
 * event, or the done-event fallback when no session event preceded it).
 *
 * Adds `assignedId` to `pendingIds` only when `originSessionId === null`
 * (sessionless creation). Retries and follow-ups are no-ops.
 * Idempotent: an already-pending ID is left unchanged.
 */
export function onCreationSessionIdentified(
  state: CreationRefreshState,
  originSessionId: string | null,
  assignedId: string,
): CreationRefreshState {
  if (originSessionId !== null) return state;
  if (state.pendingIds.has(assignedId)) return state;
  return { pendingIds: new Set([...state.pendingIds, assignedId]) };
}

/**
 * Call when a `done` event is received.
 *
 * Returns `shouldRefresh` and the next state. Rules:
 * - If `completedSessionId` is not in `pendingIds`: no-op (not a pending
 *   creation, or already refreshed).
 * - If `isError`: preserve the ID for retry; no refresh.
 * - On a successful matching completion: refresh and remove only that ID.
 *
 * Callers should call `onCreationSessionIdentified` with `completedSessionId`
 * before calling this function to handle the done-before-session race.
 */
export function onDoneCreationRefresh(
  state: CreationRefreshState,
  completedSessionId: string | null | undefined,
  isError: boolean | undefined,
): { shouldRefresh: boolean; nextState: CreationRefreshState } {
  if (!completedSessionId || !state.pendingIds.has(completedSessionId)) {
    return { shouldRefresh: false, nextState: state };
  }
  if (isError) {
    return { shouldRefresh: false, nextState: state };
  }
  const nextIds = new Set(state.pendingIds);
  nextIds.delete(completedSessionId);
  return { shouldRefresh: true, nextState: { pendingIds: nextIds } };
}
