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

// ── Repeating-schedule series + past-due (notification helpers) ──────────────

/**
 * Stable identity for "occurrences of the same repeating schedule". The
 * scheduler refires a recurring item by spawning a fresh sibling per
 * occurrence (new id, same shape — see inbox-scheduler's tick), so the
 * notifications of one schedule share everything BUT their id. The key is
 * kind + normalized title + recurrence spec + familiar; non-recurring items
 * have no series and return null. Siblings are spread-copies of one object,
 * so JSON.stringify over the recurrence is order-stable within a series.
 */
export function inboxSeriesKey(item: InboxItem): string | null {
  const rec = item.recurrence;
  if (!rec || rec.type === "none") return null;
  const title = (item.title ?? "").trim().toLowerCase();
  return `${item.kind}|${title}|${JSON.stringify(rec)}|${item.familiarId ?? ""}`;
}

export type InboxSeriesGroup = {
  /** Series key, or null when the row is a non-recurring singleton. */
  key: string | null;
  /** The most recent member — the face of the row. */
  latest: InboxItem;
  /** Every member, input order preserved (newest first in a recent-first feed). */
  items: InboxItem[];
};

/**
 * Collapse a feed so every notification from one repeating schedule forms a
 * single group — a daily stand-up that fired five times is one row, not five.
 * Order-preserving: a series occupies the position of its first member in the
 * input; non-recurring items pass through as singleton groups. `latest` is
 * the member with the newest activity regardless of input order.
 */
export function collapseInboxSeries(items: readonly InboxItem[]): InboxSeriesGroup[] {
  const groups: InboxSeriesGroup[] = [];
  const byKey = new Map<string, InboxSeriesGroup>();
  for (const item of items) {
    const key = inboxSeriesKey(item);
    if (!key) {
      groups.push({ key: null, latest: item, items: [item] });
      continue;
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.items.push(item);
      if (inboxActivityTime(item) > inboxActivityTime(existing.latest)) {
        existing.latest = item;
      }
    } else {
      const group: InboxSeriesGroup = { key, latest: item, items: [item] };
      byKey.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

/**
 * Past due = a schedule whose moment has passed and is still waiting on the
 * user: a fired reminder that hasn't been resolved, or a pending reminder
 * whose fireAt slipped by (missed while Cave was quit). Snoozing moves fireAt
 * forward, so a snoozed reminder isn't past due until it comes back around.
 * Announcement kinds (agent, daily-summary, response-needed) have no due
 * moment and are never past due.
 */
export function isInboxItemPastDue(item: InboxItem, nowMs: number = Date.now()): boolean {
  if (item.kind !== "reminder") return false;
  if (item.status !== "fired" && item.status !== "pending") return false;
  const dueIso = item.fireAt ?? item.firedAt;
  const due = dueIso ? Date.parse(dueIso) : NaN;
  return Number.isFinite(due) && due <= nowMs;
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

// ── Generalized feed grouping (group-by control + bulk selection) ────────────

export type InboxGroupBy = "attention" | "kind" | "familiar";

export type InboxFeedGroup = {
  /** Stable key for React lists and select-group targeting. */
  id: string;
  title: string;
  /** Warning-tinted count badge (the "Needs you" tier). */
  accent?: boolean;
  items: InboxItem[];
};

export const INBOX_GROUP_BY_OPTIONS: { value: InboxGroupBy; label: string }[] = [
  { value: "attention", label: "Attention" },
  { value: "kind", label: "Kind" },
  { value: "familiar", label: "Familiar" },
];

/** Kind-group order: what demands a reply first, ambient noise last. */
const KIND_ORDER: ItemKind[] = ["response-needed", "reminder", "agent", "daily-summary"];

/**
 * Group the (already search-filtered) feed for rendering, per the active
 * group-by dimension. Every mode returns the same shape so the section list,
 * per-group selection, and bulk actions are dimension-agnostic:
 *   • attention — the classic three tiers (groupInboxFeed), empty tiers kept out.
 *   • kind      — one group per item kind present, most-demanding kind first.
 *   • familiar  — one group per familiar present (label via `familiarLabel`),
 *                 items without a familiar land in a trailing "No familiar".
 * Non-attention groups sort by most-recent activity, matching the tiers.
 */
export function buildInboxGroups(
  items: readonly InboxItem[],
  groupBy: InboxGroupBy,
  familiarLabel?: (familiarId?: string | null) => string | null,
): InboxFeedGroup[] {
  if (groupBy === "attention") {
    const tiers = groupInboxFeed(items);
    return [
      { id: "attention:needs-you", title: "Needs you", accent: true, items: tiers.needsYou },
      { id: "attention:active", title: "Active", items: tiers.active },
      { id: "attention:resolved", title: "Resolved", items: tiers.resolved },
    ].filter((group) => group.items.length > 0);
  }

  const byRecent = (a: InboxItem, b: InboxItem) => inboxActivityTime(b) - inboxActivityTime(a);

  if (groupBy === "kind") {
    const byKind = new Map<ItemKind, InboxItem[]>();
    for (const item of items) {
      const bucket = byKind.get(item.kind);
      if (bucket) bucket.push(item);
      else byKind.set(item.kind, [item]);
    }
    return KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
      id: `kind:${kind}`,
      title: inboxKindLabel(kind),
      items: byKind.get(kind)!.sort(byRecent),
    }));
  }

  const byFamiliar = new Map<string, InboxItem[]>();
  const unassigned: InboxItem[] = [];
  for (const item of items) {
    if (item.familiarId) {
      const bucket = byFamiliar.get(item.familiarId);
      if (bucket) bucket.push(item);
      else byFamiliar.set(item.familiarId, [item]);
    } else {
      unassigned.push(item);
    }
  }
  const groups: InboxFeedGroup[] = [...byFamiliar.entries()]
    .map(([familiarId, bucket]) => ({
      id: `familiar:${familiarId}`,
      title: familiarLabel?.(familiarId) ?? familiarId,
      items: bucket.sort(byRecent),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  if (unassigned.length > 0) {
    groups.push({ id: "familiar:none", title: "No familiar", items: unassigned.sort(byRecent) });
  }
  return groups;
}
