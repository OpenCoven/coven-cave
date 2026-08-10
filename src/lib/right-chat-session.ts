import type { SessionRow } from "./types.ts";
import { filterVisibleChatSessions } from "./chat-projects.ts";

export function eligibleRightChatSessions(
  sessions: SessionRow[],
  familiarId: string | null,
): SessionRow[] {
  if (familiarId === null) return [];
  return filterVisibleChatSessions(sessions, familiarId);
}

export function resolveLatestRightChatSessionId(
  sessions: SessionRow[],
  familiarId: string | null,
): string | null {
  return eligibleRightChatSessions(sessions, familiarId)[0]?.id ?? null;
}

/**
 * Applied-session-scope contract for RightChatPanel (cave-rl980 Task 4
 * review). Workspace's own session list is fetched scoped to a single
 * active familiar (`loadSessions` in workspace.tsx re-fires on every
 * `activeId` change and requests `?familiarId=<id>`) but its `sessions`
 * state only catches up once that fetch actually resolves — `activeFamiliar`
 * itself flips synchronously on a switch, `sessionsLoaded` never resets to
 * `false` in between (it is a one-time latch), and `sessions` keeps holding
 * the OUTGOING familiar's scoped rows in the meantime. Without an explicit
 * scope signal, a panel resolving eagerly against `sessions` the instant
 * `activeFamiliar` changes can mistake "this familiar has no chats" for
 * "the roster hasn't caught up yet" and wrongly open a blank compose, or
 * mistake a leftover row for one of the new familiar's own sessions.
 *
 * `appliedSessionsFamiliarId` names whichever familiar the CALLER currently
 * guarantees `sessions` reflects. `undefined` means the caller does not
 * track this yet — Workspace's own wiring lands in cave-rl980 Task 7 — so
 * `sessions` is trusted as already current, preserving the pre-scope-aware
 * contract exactly for every caller that has not adopted it. A concrete
 * value (a familiar id, or `null` for an explicit "no familiar"/
 * all-familiars scope) is compared directly against the familiar being
 * resolved, mirroring `isCurrentProjectScope` in project-scope.ts, which
 * solves the identical staleness problem for the projects list.
 */
export type RightChatSessionsScope = string | null | undefined;

export function isCurrentRightChatSessionsScope(
  appliedSessionsFamiliarId: RightChatSessionsScope,
  familiarId: string | null,
): boolean {
  return appliedSessionsFamiliarId === undefined || appliedSessionsFamiliarId === familiarId;
}
