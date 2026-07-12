// Pure grouping/ordering for the Schedules → Inbox tab, which shows the FULL
// inbox feed (every InboxItem kind), not just the schedule-shaped items the
// Reminders tab covers. Framework/fs-free so it's unit-testable without a DOM
// or the node-only cave-inbox store.

import type { InboxItem, ItemKind } from "@/lib/cave-inbox";

export type InboxFeedGroups = {
  /** Demands attention now: fired items + anything awaiting a response. */
  needsYou: InboxItem[];
  /** Live but not (yet) demanding: pending / snoozed. */
  active: InboxItem[];
  /** Closed out: done or dismissed. */
  resolved: InboxItem[];
};

/** The most recent meaningful timestamp for ordering a feed row. */
export function inboxActivityTime(item: InboxItem): number {
  const iso = item.firedAt ?? item.fireAt ?? item.updatedAt ?? item.createdAt;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Partition the inbox into three attention tiers, each sorted by most-recent
 * activity. An item is in exactly one group:
 *   • resolved — status done | dismissed (terminal), regardless of kind.
 *   • needsYou — fired, OR a response-needed item (and not yet resolved).
 *   • active   — everything else still live (pending | snoozed).
 */
export function groupInboxFeed(items: readonly InboxItem[]): InboxFeedGroups {
  const needsYou: InboxItem[] = [];
  const active: InboxItem[] = [];
  const resolved: InboxItem[] = [];

  for (const item of items) {
    if (item.status === "done" || item.status === "dismissed") {
      resolved.push(item);
    } else if (item.status === "fired" || item.kind === "response-needed") {
      needsYou.push(item);
    } else {
      active.push(item);
    }
  }

  const byRecent = (a: InboxItem, b: InboxItem) => inboxActivityTime(b) - inboxActivityTime(a);
  needsYou.sort(byRecent);
  active.sort(byRecent);
  resolved.sort(byRecent);
  return { needsYou, active, resolved };
}

/**
 * Unread = a fired notification the user hasn't acknowledged yet (readAt is
 * stamped by "Mark all read" / opening the item, cleared by the scheduler on
 * refire). Items that predate readAt count as unread — matching the old badge
 * that counted every fired item.
 */
export function isInboxItemUnread(item: InboxItem): boolean {
  return item.status === "fired" && !item.readAt;
}

/**
 * What the bell badge shows: unread fired notifications plus anything still
 * waiting on a reply (response-needed clears by replying, not by reading).
 * ONE definition feeds the badge and the bell list so they can never disagree
 * — the old badge counted polled escalations while the list showed inbox
 * items, and the two routinely diverged.
 */
export function unreadInboxCount(items: readonly InboxItem[]): number {
  let count = 0;
  for (const item of items) {
    if (isInboxItemUnread(item)) count++;
    else if (item.kind === "response-needed" && item.status === "pending") count++;
  }
  return count;
}

/** Human label for an inbox item kind (used by the feed's kind badge). */
export function inboxKindLabel(kind: ItemKind): string {
  switch (kind) {
    case "reminder":
      return "Reminder";
    case "daily-summary":
      return "Summary";
    case "response-needed":
      return "Response";
    case "agent":
      return "Agent";
    default:
      return kind;
  }
}
