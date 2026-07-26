/**
 * Pure helpers for the Sessions list redesign (chat-list.tsx) and the chats
 * rail (chat-project-sidebar.tsx): the toolbar's group-by select (none /
 * project / date), calendar-day sections for the date mode, the "shown of
 * total" count line, the rail's By project / Recent view mode, and the rail's
 * per-group preview cap ("Show N more"). Dependency-free so the unit suite
 * can exercise them directly.
 */

import type { SessionRow } from "./types";

// ── Group-by (list toolbar) ─────────────────────────────────────────────────

export type ChatSessionGroupBy = "none" | "project" | "date";

/** localStorage key for the persisted group-by choice (raw string value). */
export const CHAT_GROUP_BY_KEY = "cave:chat:list:group-by";

export function normalizeChatGroupBy(value: unknown): ChatSessionGroupBy {
  return value === "project" || value === "date" ? value : "none";
}

// ── Calendar-day sections (group-by: date) ──────────────────────────────────

export type ChatDaySection = {
  /** Local calendar-day key (YYYY-MM-DD), or "undated" for unparsable rows. */
  key: string;
  /** Header label: "Today", "Yesterday", or the caller-formatted day. */
  label: string;
  /** Row count inside this section. */
  count: number;
  /** Index of the section's first row in the flat row list. */
  startIndex: number;
};

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function sessionDayKey(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "undated";
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "Today" / "Yesterday" / caller-formatted day (repo date-format prefs). */
export function sessionDayLabel(
  iso: string,
  now: number,
  formatDay: (iso: string) => string,
): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "Undated";
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(timestamp)) / 86_400_000);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return formatDay(iso);
}

/**
 * Partition an already-ordered flat row list into calendar-day sections by
 * `updated_at` (falling back to `created_at`). Sections appear in row order —
 * the rows themselves are never re-sorted, so manual drag order and
 * pinned-first still decide what leads inside each day.
 */
export function deriveChatDaySections(
  rows: readonly SessionRow[],
  now: number,
  formatDay: (iso: string) => string,
): ChatDaySection[] {
  const sections: ChatDaySection[] = [];
  let current: ChatDaySection | null = null;
  rows.forEach((row, index) => {
    const iso = row.updated_at || row.created_at;
    const key = sessionDayKey(iso);
    if (current && current.key === key) {
      current.count += 1;
      return;
    }
    current = { key, label: sessionDayLabel(iso, now, formatDay), count: 1, startIndex: index };
    sections.push(current);
  });
  return sections;
}

// ── Count line (toolbar, right-aligned) ─────────────────────────────────────

export function sessionCountLine(shown: number, total: number): string {
  return `${shown} of ${total} session${total === 1 ? "" : "s"}`;
}

// ── Chats-rail view mode (By project / Recent) ──────────────────────────────

export type ChatRailMode = "projects" | "recent";

/** localStorage key for the persisted rail view mode (raw string value). */
export const CHAT_RAIL_MODE_KEY = "cave:chat:rail:mode";

export function normalizeChatRailMode(value: unknown): ChatRailMode {
  return value === "recent" ? "recent" : "projects";
}

// ── Rail per-group preview cap ("Show N more") ──────────────────────────────

export const CHAT_RAIL_PREVIEW_LIMIT = 6;

export function railGroupPreview<T>(
  rows: readonly T[],
  showAll: boolean,
  limit: number = CHAT_RAIL_PREVIEW_LIMIT,
): { shown: T[]; hiddenCount: number } {
  if (showAll || rows.length <= limit) return { shown: [...rows], hiddenCount: 0 };
  return { shown: rows.slice(0, limit), hiddenCount: rows.length - limit };
}

export function railMoreLabel(showAll: boolean, hiddenCount: number): string {
  return showAll ? "Show fewer" : `Show ${hiddenCount} more`;
}
