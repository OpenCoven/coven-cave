/**
 * Pure predicate for ChatRouter's onSessionStarted promotion guard.
 *
 * Returns true when ChatRouter's setView should update the displayed sessionId
 * to the replacement. The guard matches prevSessionId === originSessionId so:
 * - null→new: sessionless creation (origin null), prev must also be null
 * - A→B: replacement generation on A (origin "A"), prev must still be on A
 * - stale C→B: refused when prev moved to C while origin is A (C ≠ A)
 * - duplicate: after first A→B promotes view, second call sees prev=B ≠ origin=A
 */
export function shouldRouterPromoteSession(
  prevSessionId: string | null,
  originSessionId: string | null,
): boolean {
  return prevSessionId === originSessionId;
}
