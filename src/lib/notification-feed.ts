// How the bell's Notifications popover arranges the inbox (#6483). Pure and
// DOM-free so the arrangement is unit-tested apart from the component.
//
// Three decisions live here:
//   • Needs you first. A reply someone is waiting for, or a reminder whose
//     time has passed, is never listed under a stack of reports.
//   • Daily reports fold into ONE row. Each day's report is its own item with
//     no repeat schedule, so the series collapse never groups them, and a few
//     days of history filled the popover with near-identical cards.
//   • Everything else reads as a timeline: Today, Yesterday, Earlier.

import type { InboxItem } from "@/lib/cave-inbox";
import { inboxActivityTime, isInboxItemPastDue, type InboxSeriesGroup } from "./inbox-feed.ts";

export type NotificationRow =
  /** A single notification, or every occurrence of one repeating schedule. */
  | { kind: "group"; id: string; group: InboxSeriesGroup }
  /** Every daily report, newest first, shown as one row. */
  | { kind: "reports"; id: string; latest: InboxItem; items: InboxItem[] };

export type NotificationDay = "today" | "yesterday" | "earlier";

export type NotificationDayGroup = { day: NotificationDay; label: string; rows: NotificationRow[] };

export type NotificationSections = {
  /** Waiting replies and past-due reminders, in feed order. */
  needsYou: NotificationRow[];
  /** Everything else, by day, newest first. Empty days are omitted. */
  updates: NotificationDayGroup[];
  /** How many rows there are in all, shown or not. */
  total: number;
  /** Older updates left out by the row limit. */
  hidden: number;
};

const DAY_LABELS: Record<NotificationDay, string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

/** The occurrence a row shows. */
export function notificationRowLatest(row: NotificationRow): InboxItem {
  return row.kind === "group" ? row.group.latest : row.latest;
}

/** Every item a row stands for: what Read and Dismiss act on. */
export function notificationRowItems(row: NotificationRow): InboxItem[] {
  return row.kind === "group" ? row.group.items : row.items;
}

/** Whether a row belongs under Needs you. A report never does: it is read,
 *  not answered (the same rule as groupInboxFeed). */
export function notificationRowNeedsYou(row: NotificationRow, nowMs: number = Date.now()): boolean {
  if (row.kind === "reports") return false;
  if (row.group.latest.kind === "response-needed") return true;
  return row.group.items.some((item) => isInboxItemPastDue(item, nowMs));
}

/**
 * Replace every daily-report group with one reports row, at the position of
 * the newest report. Order-preserving otherwise. Input is recent-first, as
 * the bell builds it.
 */
export function foldDailyReports(groups: readonly InboxSeriesGroup[]): NotificationRow[] {
  const rows: NotificationRow[] = [];
  let reports: Extract<NotificationRow, { kind: "reports" }> | null = null;
  for (const group of groups) {
    if (group.latest.kind !== "daily-summary") {
      rows.push({ kind: "group", id: group.latest.id, group });
      continue;
    }
    if (!reports) {
      reports = { kind: "reports", id: "daily-reports", latest: group.latest, items: [] };
      rows.push(reports);
    }
    for (const item of group.items) {
      reports.items.push(item);
      if (inboxActivityTime(item) > inboxActivityTime(reports.latest)) reports.latest = item;
    }
  }
  if (reports) reports.items.sort((a, b) => inboxActivityTime(b) - inboxActivityTime(a));
  return rows;
}

/** Which day heading a moment falls under, in local time. */
export function notificationDay(timeMs: number, nowMs: number = Date.now()): NotificationDay {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timeMs >= startOfToday) return "today";
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  return timeMs >= startOfYesterday ? "yesterday" : "earlier";
}

/**
 * Arrange grouped notifications into Needs you and a day-by-day timeline.
 * `limit` caps the rows shown: Needs you is never cut, and updates fill what
 * room is left, newest first.
 */
export function buildNotificationSections(
  groups: readonly InboxSeriesGroup[],
  nowMs: number = Date.now(),
  limit: number = Number.POSITIVE_INFINITY,
): NotificationSections {
  const rows = foldDailyReports(groups);
  const needsYou: NotificationRow[] = [];
  const rest: NotificationRow[] = [];
  for (const row of rows) (notificationRowNeedsYou(row, nowMs) ? needsYou : rest).push(row);
  rest.sort((a, b) => inboxActivityTime(notificationRowLatest(b)) - inboxActivityTime(notificationRowLatest(a)));
  const shown = rest.slice(0, Math.max(0, limit - needsYou.length));

  const byDay = new Map<NotificationDay, NotificationRow[]>();
  for (const row of shown) {
    const day = notificationDay(inboxActivityTime(notificationRowLatest(row)), nowMs);
    const list = byDay.get(day) ?? [];
    list.push(row);
    byDay.set(day, list);
  }
  const updates: NotificationDayGroup[] = [];
  for (const day of ["today", "yesterday", "earlier"] as const) {
    const list = byDay.get(day);
    if (list?.length) updates.push({ day, label: DAY_LABELS[day], rows: list });
  }
  return { needsYou, updates, total: rows.length, hidden: rest.length - shown.length };
}
