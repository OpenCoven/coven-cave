// Pure helpers that shape inbox data into the daily-report and dashboard
// surfaces. Kept free of `node:` imports so both the server pages and the
// (browser-bundled) tests can import it without dragging fs/promises along.
//
// The daily-report page renders a *frozen* snapshot (the stat counts captured
// in `media.stats` when the summary was generated) alongside *live* actionable
// lists derived from the current inbox. These helpers compute the live slices
// and turn each item into a deep link the standalone report/dashboard routes
// can hand back to the app shell.

import type { InboxItem, ItemKind, LinkRef } from "./cave-inbox";

export type DailyReportStats = {
  reminders: number;
  responses: number;
  familiars: number;
  sessions: number;
};

/** Parse a `YYYY-MM-DD` slug into a local Date at midnight. */
export function parseDateSlug(slug: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slug.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** `YYYY-MM-DD` for a Date in local time. */
export function dateSlug(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function isSameLocalDay(iso: string | null | undefined, day: Date): boolean {
  if (!iso) return false;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  const start = startOfLocalDay(day).getTime();
  return value.getTime() >= start && value.getTime() < start + 24 * 60 * 60 * 1000;
}

/** Long human label, e.g. "Thursday, June 18, 2026". */
export function longDateLabel(date: Date): string {
  return new Intl.DateTimeFormat([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** "Today" / "Yesterday" / weekday for dates inside the last week, else short date. */
export function relativeDayLabel(date: Date, now = new Date()): string {
  const days = Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat([], { weekday: "long" }).format(date);
  }
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(date);
}

/** Compact "3h ago" / "2d ago" / clock time relative phrase. */
export function relativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const diffMs = now.getTime() - then.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(then);
}

export const KIND_LABEL: Record<ItemKind, string> = {
  reminder: "Reminder",
  agent: "Familiar update",
  "response-needed": "Response needed",
  "daily-summary": "Daily report",
};

export const KIND_ICON: Record<ItemKind, string> = {
  reminder: "ph:bell",
  agent: "ph:sparkle",
  "response-needed": "ph:chat-circle-dots",
  "daily-summary": "ph:newspaper",
};

/**
 * Turn an inbox item into an href the standalone routes can use. In-app
 * targets resolve to `/#<hash>` so the workspace deep-link listeners
 * (`#card-`, `#chat-`, `#memory:`) re-enter the right surface; bare urls pass
 * through. Items with no actionable target return `/` (the home shell).
 */
export function itemHref(item: InboxItem): string {
  const link: LinkRef | null | undefined = item.link;
  if (link) {
    switch (link.kind) {
      case "card":
        return `/#card-${link.ref}`;
      case "session":
        return `/#chat-${link.ref}`;
      case "memory":
        return `/#memory:${encodeURIComponent(link.ref)}`;
      case "url":
        return link.ref || "/";
    }
  }
  if (item.sessionId) return `/#chat-${item.sessionId}`;
  return "/";
}

/** Whether an item resolves to a real, navigable destination. */
export function itemHasTarget(item: InboxItem): boolean {
  return Boolean(item.link?.ref || item.sessionId);
}

export type DailyReportBreakdown = {
  reminders: InboxItem[];
  responses: InboxItem[];
  familiars: InboxItem[];
  /** Subset still demanding attention right now (live, not frozen). */
  openItems: InboxItem[];
};

function sortByRecent(a: InboxItem, b: InboxItem): number {
  const at = a.firedAt ?? a.updatedAt ?? a.createdAt ?? "";
  const bt = b.firedAt ?? b.updatedAt ?? b.createdAt ?? "";
  return bt.localeCompare(at);
}

/**
 * Slice the live inbox into the categories that make up a day's report. The
 * filters mirror `buildDailySummaryNotification` so the live lists line up with
 * the frozen headline counts.
 */
export function breakdownForDay(items: InboxItem[], day: Date): DailyReportBreakdown {
  const reminders = items
    .filter(
      (item) =>
        item.kind === "reminder" &&
        item.status === "fired" &&
        isSameLocalDay(item.firedAt ?? item.updatedAt, day),
    )
    .sort(sortByRecent);

  const responses = items
    .filter(
      (item) =>
        item.kind === "response-needed" &&
        (item.status === "pending" || item.status === "fired") &&
        isSameLocalDay(item.updatedAt, day),
    )
    .sort(sortByRecent);

  const familiars = items
    .filter(
      (item) =>
        item.kind === "agent" &&
        item.status === "fired" &&
        isSameLocalDay(item.firedAt ?? item.updatedAt, day),
    )
    .sort(sortByRecent);

  // "Open" = still actionable: responses awaiting a reply plus reminders that
  // fired but were never completed/dismissed. Excludes done/dismissed/snoozed.
  const openItems = [...responses, ...reminders]
    .filter((item) => item.status === "pending" || item.status === "fired")
    .sort(sortByRecent);

  return { reminders, responses, familiars, openItems };
}

export type RecentReport = {
  date: string;
  slug: string;
  title: string;
  generatedAt: string | null;
  stats: DailyReportStats | null;
  href: string;
};

/**
 * All generated daily-summary items in the inbox, newest first, mapped to the
 * dashboard's "recent reports" rows.
 */
export function recentReports(items: InboxItem[]): RecentReport[] {
  return items
    .filter((item) => item.kind === "daily-summary" && typeof item.auto === "string")
    .map((item) => {
      const slug = (item.auto ?? "").replace(/^daily-summary:/, "");
      return {
        date: slug,
        slug,
        title: item.title,
        generatedAt: item.firedAt ?? item.updatedAt ?? null,
        stats: item.media?.stats ?? null,
        href: `/daily-report/${slug}`,
      };
    })
    .filter((report) => /^\d{4}-\d{2}-\d{2}$/.test(report.slug))
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

/** Live, at-a-glance counts for "today" used on the dashboard hero. */
export function liveSnapshot(items: InboxItem[], now = new Date()): DailyReportStats {
  const breakdown = breakdownForDay(items, now);
  return {
    reminders: breakdown.reminders.length,
    responses: breakdown.responses.length,
    familiars: breakdown.familiars.length,
    sessions: 0,
  };
}

/**
 * Parse the `Recent: a · b · c` line the summary builder writes into the body.
 * Sessions live behind the daemon, so the report surfaces them as read-only
 * context recovered from the frozen body text.
 */
export function parseRecentSessions(body: string | undefined): string[] {
  if (!body) return [];
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("Recent:"));
  if (!line) return [];
  return line
    .replace(/^Recent:\s*/, "")
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);
}
