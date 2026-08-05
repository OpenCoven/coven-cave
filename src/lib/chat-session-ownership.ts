/**
 * Pure ownership predicate for sessionless-generation display ownership.
 *
 * Determines whether a generation run may adopt the displayed compose view —
 * updating currentSessionRef and liveSessionIdRef — and notify ChatRouter via
 * onSessionStarted.
 *
 * Problem solved: two overlapping sessionless sends (A then B) both have
 * `originSessionId === null`. Without the `displayedCreationRunId` slot check,
 * A's late "session" event finds `currentSessionId === null === originSessionId`
 * and adopts B's compose view, splicing A's stream into the wrong thread and
 * causing ChatRouter's null-view promotion to register A's session for B's view.
 *
 * Rules:
 * - Non-null origin (existing-session generation): original equality semantics
 *   unchanged — the generation owns the view if the view is still on the thread
 *   the generation started from.
 * - Null origin (sessionless new-chat generation): additionally requires this
 *   specific run to be registered as the one owning the displayed compose slot.
 *   Only the most recent sessionless send sets that slot; older background runs
 *   fall through to the sidebar-only creation-refresh path.
 */
export function ownsDisplayedView(params: {
  currentSessionId: string | null;
  originSessionId: string | null;
  runId: string;
  displayedCreationRunId: string | null;
}): boolean {
  if (params.originSessionId !== null) {
    // Existing-session generation: original semantics unchanged.
    return params.currentSessionId === params.originSessionId;
  }
  // Sessionless generation: view must still be on compose (null session) AND
  // this specific run must own the displayed compose slot.
  return params.currentSessionId === null && params.runId === params.displayedCreationRunId;
}
