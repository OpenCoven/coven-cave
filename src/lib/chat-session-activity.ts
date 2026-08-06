// Activity buckets for the Sessions list.
//
// The "Chat Session - Prototype" handoff groups the list by how live a session
// is rather than by calendar day: everything still running floats into an
// "Active now" band at the top, and the rest fall into Today / Yesterday /
// This week / Older by last activity. That is what makes the list scannable —
// the running work is always in the same place regardless of when it started.
//
// Distinct from `deriveChatDaySections`, which is the strict calendar-day
// grouping the "Group by date" toolbar mode still uses.

import type { SessionRow } from "./types";

export type ChatActivityBucket = "active" | "today" | "yesterday" | "week" | "older";

export const CHAT_ACTIVITY_BUCKET_ORDER: readonly ChatActivityBucket[] = [
  "active",
  "today",
  "yesterday",
  "week",
  "older",
];

export const CHAT_ACTIVITY_BUCKET_LABEL: Record<ChatActivityBucket, string> = {
  active: "Active now",
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  older: "Older",
};

const MINUTE = 60_000;
const DAY_MINUTES = 1440;
const WEEK_MINUTES = 10_080;

/** Minutes since a row's last activity. Negative clocks (a session stamped in
 *  the future by a skewed daemon) clamp to 0 rather than sorting into "Older". */
export function chatRowIdleMinutes(row: SessionRow, now: number): number {
  const at = Date.parse(row.updated_at || row.created_at);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, (now - at) / MINUTE);
}

export function chatActivityBucket(row: SessionRow, now: number): ChatActivityBucket {
  if (row.status === "running") return "active";
  const idle = chatRowIdleMinutes(row, now);
  if (idle < DAY_MINUTES) return "today";
  if (idle < 2 * DAY_MINUTES) return "yesterday";
  if (idle < WEEK_MINUTES) return "week";
  return "older";
}

export type ChatActivityGroup = {
  bucket: ChatActivityBucket;
  label: string;
  rows: SessionRow[];
};

/** Groups in fixed bucket order, preserving each bucket's incoming row order
 *  (the caller has already sorted). Empty buckets are dropped — a header with
 *  nothing under it is chrome, not information. */
export function groupChatRowsByActivity(
  rows: readonly SessionRow[],
  now: number,
): ChatActivityGroup[] {
  const byBucket = new Map<ChatActivityBucket, SessionRow[]>();
  for (const row of rows) {
    const bucket = chatActivityBucket(row, now);
    const list = byBucket.get(bucket);
    if (list) list.push(row);
    else byBucket.set(bucket, [row]);
  }
  const groups: ChatActivityGroup[] = [];
  for (const bucket of CHAT_ACTIVITY_BUCKET_ORDER) {
    const bucketRows = byBucket.get(bucket);
    if (!bucketRows || bucketRows.length === 0) continue;
    groups.push({ bucket, label: CHAT_ACTIVITY_BUCKET_LABEL[bucket], rows: bucketRows });
  }
  return groups;
}
