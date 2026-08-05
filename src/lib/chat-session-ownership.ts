/**
 * Pure ownership predicate for generation display ownership.
 *
 * Determines whether a generation run may adopt the displayed compose view —
 * updating currentSessionRef and liveSessionIdRef — and notify ChatRouter via
 * onSessionStarted.
 *
 * Problem solved: a late generation must not adopt a view now owned by another
 * run or by a remounted ChatView. `displayedCreationRunId` is cleared on thread
 * switch/unmount and set to the current run at send start.
 *
 * Rules:
 * - Every generation must still own the displayed run slot. This blocks an old
 *   ChatView's resumed replacement from promoting into a fresh compose after
 *   unmount clears the slot.
 * - Non-null origin additionally requires the view to remain on the thread the
 *   generation started from.
 * - Null origin additionally requires the view to remain sessionless.
 */
export type DisplayedViewOwnership = {
  currentSessionId: string | null;
  originSessionId: string | null;
  runId: string;
  displayedCreationRunId: string | null;
};

export function ownsDisplayedView(params: DisplayedViewOwnership): boolean {
  if (params.runId !== params.displayedCreationRunId) return false;
  if (params.originSessionId !== null) {
    return params.currentSessionId === params.originSessionId;
  }
  return params.currentSessionId === null;
}

/** Only a fresh, sessionless creation run may promote ChatRouter. */
export function canPromoteDisplayedSession(params: DisplayedViewOwnership): boolean {
  return params.originSessionId === null && ownsDisplayedView(params);
}
