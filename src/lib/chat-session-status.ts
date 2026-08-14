// Session status presentation for the Sessions list — the status vocabulary the
// "Chat Session - Prototype" handoff paints as a pill on every row and as a
// counted filter chip above the list.
//
// The prototype's five states (running / waiting / completed / failed /
// canceled) are its own fiction; Cave's daemon reports `running`, `queued`,
// `completed`, `failed` and `paused`. We keep Cave's truth and adopt the
// prototype's *presentation*: one solid token per state, the pill tinted off it
// through the color-mix recipe, and a glyph so the state is never colour-only.

import type { IconName } from "./icon";
import type { SessionRow } from "./types";

export type ChatSessionStatusKey = "running" | "queued" | "completed" | "failed" | "paused";
export type ChatSessionStatusFilter = "all" | ChatSessionStatusKey;

/** Chip order in the toolbar: live work first, then the ways a run ends. */
export const CHAT_SESSION_STATUS_ORDER: readonly ChatSessionStatusKey[] = [
  "running",
  "queued",
  "completed",
  "failed",
  "paused",
];

export type ChatSessionStatusPresentation = {
  /** Sentence-case label for the pill and the filter chip. */
  label: string;
  /** The ONE solid token every tint for this state derives from. */
  tint: string;
  /** Glyph carried beside the label so colour is never the only channel.
   *  `running` has none — it uses the breathing dot instead. */
  icon: IconName | null;
};

export const CHAT_SESSION_STATUS: Record<ChatSessionStatusKey, ChatSessionStatusPresentation> = {
  // Running borrows the presence accent, which is what the prototype's `--live`
  // resolves to: a running session is the surface's one live thing.
  running: { label: "Running", tint: "var(--accent-presence)", icon: null },
  queued: { label: "Queued", tint: "var(--color-warning)", icon: "ph:clock" },
  completed: { label: "Completed", tint: "var(--color-success)", icon: "ph:check" },
  failed: { label: "Failed", tint: "var(--color-danger)", icon: "ph:warning" },
  paused: { label: "Paused", tint: "var(--text-muted)", icon: "ph:pause" },
};

/** Any status the daemon reports that we don't paint explicitly reads as a
 *  finished run — the same fallback the old STATUS_STYLES map used. */
export function chatSessionStatusKey(status: string | null | undefined): ChatSessionStatusKey {
  const key = (status ?? "").trim().toLowerCase();
  return (CHAT_SESSION_STATUS_ORDER as readonly string[]).includes(key)
    ? (key as ChatSessionStatusKey)
    : "completed";
}

export function chatSessionStatus(row: SessionRow): ChatSessionStatusPresentation {
  return CHAT_SESSION_STATUS[chatSessionStatusKey(row.status)];
}

/** Counts for every chip, including `all`. Counted BEFORE the status filter
 *  applies (but after search), so switching chips never changes the numbers
 *  under the other chips — the prototype's behaviour. */
export function countChatSessionStatuses(
  rows: readonly SessionRow[],
): Record<ChatSessionStatusFilter, number> {
  const counts: Record<ChatSessionStatusFilter, number> = {
    all: rows.length,
    running: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    paused: 0,
  };
  for (const row of rows) counts[chatSessionStatusKey(row.status)] += 1;
  return counts;
}

export function filterChatRowsByStatus(
  rows: readonly SessionRow[],
  filter: ChatSessionStatusFilter,
): SessionRow[] {
  if (filter === "all") return [...rows];
  return rows.filter((row) => chatSessionStatusKey(row.status) === filter);
}

/** A chip with a zero count still renders (so the row of chips doesn't reflow
 *  as runs finish) but reads as unavailable unless it is the active filter. */
export function chatStatusChipDisabled(count: number, active: boolean): boolean {
  return count === 0 && !active;
}
