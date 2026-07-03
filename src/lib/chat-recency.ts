// Time-bucketed "Recent chats" model for the chat sidebar's recency view
// (docs/specs/2026-07-03-chat-sidebar-recency-grouping-design.md). Pure and
// clock-injected (same convention as home-digest.ts) so tests pin exact
// calendar-day boundaries. Boundaries are LOCAL calendar days: Today = same
// local date, Yesterday = previous, week = 2–7 days old, month = 8–30, else
// Older. Sessions with unparseable timestamps land in Older.

import type { SessionRow } from "./types.ts";

export type ChatRecencyBucketKey = "today" | "yesterday" | "week" | "month" | "older";

export type ChatRecencyBucket = {
  key: ChatRecencyBucketKey;
  label: string;
  /** Recency-sorted, newest first. */
  sessions: SessionRow[];
};

const BUCKET_LABELS: Record<ChatRecencyBucketKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Previous 7 days",
  month: "Previous 30 days",
  older: "Older",
};

const BUCKET_ORDER: ChatRecencyBucketKey[] = ["today", "yesterday", "week", "month", "older"];

function sessionTimestamp(session: SessionRow): string {
  return session.updated_at || session.created_at;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketKeyFor(iso: string, nowMs: number): ChatRecencyBucketKey {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "older";
  // Whole local-day difference; Math.round absorbs DST-shortened/lengthened days.
  const days = Math.round((startOfLocalDay(nowMs) - startOfLocalDay(then)) / 86_400_000);
  if (days <= 0) return "today"; // includes future timestamps from clock skew
  if (days === 1) return "yesterday";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  return "older";
}

export function deriveChatRecencyBuckets(
  sessions: SessionRow[],
  nowMs: number,
): ChatRecencyBucket[] {
  const sorted = [...sessions].sort((a, b) =>
    sessionTimestamp(a) < sessionTimestamp(b) ? 1 : -1,
  );
  const byKey = new Map<ChatRecencyBucketKey, SessionRow[]>();
  for (const session of sorted) {
    const key = bucketKeyFor(sessionTimestamp(session), nowMs);
    const rows = byKey.get(key) ?? [];
    rows.push(session);
    byKey.set(key, rows);
  }
  return BUCKET_ORDER.filter((key) => (byKey.get(key)?.length ?? 0) > 0).map((key) => ({
    key,
    label: BUCKET_LABELS[key],
    sessions: byKey.get(key)!,
  }));
}
