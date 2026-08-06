// Sort order for the Sessions list — the "SORT Recent activity" menu the
// "Chat Session - Prototype" handoff puts beside the status chips.
//
// "Recent activity" is the default and the only order that groups into activity
// buckets; the other three are flat orders with a single "… first" header, so
// the reading order and the header always agree.

import type { SessionRow } from "./types";

export type ChatSessionSort = "recent" | "newest" | "oldest" | "duration";

export const CHAT_SESSION_SORT_ORDER: readonly ChatSessionSort[] = [
  "recent",
  "newest",
  "oldest",
  "duration",
];

export const CHAT_SESSION_SORT_LABEL: Record<ChatSessionSort, string> = {
  recent: "Recent activity",
  newest: "Newest",
  oldest: "Oldest",
  duration: "Duration",
};

/** Header shown above a flat (non-bucketed) order, so the list never presents
 *  rows in an order it hasn't named. */
export const CHAT_SESSION_SORT_HEADING: Record<ChatSessionSort, string> = {
  recent: "Recent activity",
  newest: "Newest first",
  oldest: "Oldest first",
  duration: "Longest first",
};

export const CHAT_SESSION_SORT_KEY = "cave.chat.sessionSort.v1";

export function normalizeChatSessionSort(value: unknown): ChatSessionSort {
  return (CHAT_SESSION_SORT_ORDER as readonly string[]).includes(String(value))
    ? (value as ChatSessionSort)
    : "recent";
}

const at = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
};

/** How long a session has been alive: last activity minus creation. Used by the
 *  Duration sort and by the row's elapsed readout. Never negative. */
export function chatSessionDurationMs(row: SessionRow): number {
  return Math.max(0, at(row.updated_at || row.created_at) - at(row.created_at));
}

export function sortChatSessionRows(
  rows: readonly SessionRow[],
  sort: ChatSessionSort,
): SessionRow[] {
  const next = [...rows];
  if (sort === "newest") return next.sort((a, b) => at(b.created_at) - at(a.created_at));
  if (sort === "oldest") return next.sort((a, b) => at(a.created_at) - at(b.created_at));
  if (sort === "duration") return next.sort((a, b) => chatSessionDurationMs(b) - chatSessionDurationMs(a));
  return next.sort((a, b) => at(b.updated_at || b.created_at) - at(a.updated_at || a.created_at));
}

/** Compact elapsed readout — "48s", "4m 01s", "2h 04m". Tabular by design:
 *  the seconds/minutes half is zero-padded so a column of these doesn't jitter. */
export function formatChatSessionDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`;
}
