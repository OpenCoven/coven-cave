/**
 * One definition, and one label, per familiar count (issue 6357).
 *
 * Before this module the profile, runtime performance, share card and roster
 * each counted "sessions" from a different list: archived rows in or out,
 * familiar-workspace runs in or out, all-time or an adaptive heatmap window.
 * The same word showed 2410, 2087, 138 and 137 for one familiar. Every surface
 * now takes its number and its label from here, so a label always means the
 * same rule.
 *
 * Pure and client-safe.
 */

import type { SessionRow } from "@/lib/types";

export const RECENT_SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const COUNT_LABELS = {
  /** Execution attempts recorded by the runtime in the selected window. */
  runtimeAttempts: "Runtime attempts",
  /** Unarchived conversations updated in the last 90 days. */
  recentSessions: `Coven sessions · ${RECENT_SESSION_DAYS}d`,
  /** Every conversation ever attributed to the familiar, archived included. */
  allTimeSessions: "All-time sessions",
  /** Files in the familiar's workspace memory (`/api/memory`). */
  memories: "Memories",
} as const;

export const COUNT_DEFINITIONS: Record<keyof typeof COUNT_LABELS, string> = {
  runtimeAttempts: "Each harness run the runtime recorded in the selected window, retries included.",
  recentSessions: `Unarchived conversations with this familiar updated in the last ${RECENT_SESSION_DAYS} days. Automatic journal and reflection runs in the familiar's own workspace are not counted.`,
  allTimeSessions: "Every conversation ever attributed to this familiar, archived ones included. Automatic workspace runs are not counted.",
  memories: "Files in this familiar's workspace memory.",
};

/**
 * Conversations a person had with the familiar: not an automatic journal or
 * reflection run in the familiar's own workspace. Every session-count tile
 * uses this, so a 30-day tile can never exceed the 90-day one.
 */
export function isFamiliarConversation(session: SessionRow): boolean {
  return session.familiarWorkspace !== true;
}

function isConversation(session: SessionRow, familiarId: string): boolean {
  return session.familiarId === familiarId && isFamiliarConversation(session);
}

/** `COUNT_LABELS.recentSessions` for one familiar. */
export function recentSessionCount(
  sessions: readonly SessionRow[],
  familiarId: string,
  now: number = Date.now(),
): number {
  const cutoff = now - RECENT_SESSION_DAYS * DAY_MS;
  let count = 0;
  for (const session of sessions) {
    if (!isConversation(session, familiarId) || session.archived_at) continue;
    const ms = Date.parse(session.updated_at);
    if (Number.isFinite(ms) && ms > cutoff) count += 1;
  }
  return count;
}

/** `COUNT_LABELS.allTimeSessions` for one familiar. Needs a list fetched with archived rows. */
export function allTimeSessionCount(sessions: readonly SessionRow[], familiarId: string): number {
  let count = 0;
  for (const session of sessions) if (isConversation(session, familiarId)) count += 1;
  return count;
}

/** Display for a memory count that may be unknown: never a bare dash. */
export function memoryCountDisplay(
  count: number | null,
  formatCount: (value: number) => string = String,
): { value: string; unavailable: boolean } {
  return count == null ? { value: "unavailable", unavailable: true } : { value: formatCount(count), unavailable: false };
}
