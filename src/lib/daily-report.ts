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
  /** Day-in-review counts — absent (not zero) on reports generated before
   *  Phase B or when the source (GitHub PAT, board file) was unavailable. */
  prsMerged?: number;
  cardsCompleted?: number;
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

/** Time-of-day greeting for the dashboard hero. */
export function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

// Intl.DateTimeFormat construction is the expensive part of these labels
// (fresh locale-data resolution per call), and day rails call them per row
// per render — share one instance per shape instead.
const longDateFormat = new Intl.DateTimeFormat([], {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const weekdayFormat = new Intl.DateTimeFormat([], { weekday: "long" });
const monthDayFormat = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });

/** Long human label, e.g. "Thursday, June 18, 2026". */
export function longDateLabel(date: Date): string {
  return longDateFormat.format(date);
}

/** "Today" / "Yesterday" / weekday for dates inside the last week, else short date. */
export function relativeDayLabel(date: Date, now = new Date()): string {
  const days = Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) {
    return weekdayFormat.format(date);
  }
  return monthDayFormat.format(date);
}

// The compact "3h ago" / "2d ago" / short-date phrase now lives in the shared
// relative-time module; re-export it so existing dashboard/daily-report
// importers (and the daily-report test) keep working unchanged.
export { relativeTime } from "./relative-time.ts";

export const KIND_LABEL: Record<ItemKind, string> = {
  reminder: "Reminder",
  agent: "Familiar update",
  "response-needed": "Response needed",
  "daily-summary": "Daily report",
  milestone: "Milestone",
};

export const KIND_ICON: Record<ItemKind, string> = {
  reminder: "ph:bell",
  agent: "ph:sparkle",
  "response-needed": "ph:chat-circle-dots",
  "daily-summary": "ph:newspaper",
  milestone: "ph:trophy-fill",
};

/**
 * Turn an inbox item into an href the standalone routes can use. In-app
 * targets resolve to `/#<hash>` so the workspace boot deep-link handlers
 * (`#card-`, `#chat-`, `#grimoire:`) re-enter the right surface; bare urls
 * pass through. Items with no actionable target return `/` (the home shell).
 * (`#memory:` never had a consumer — memory links ride the Grimoire hash,
 * whose reader is the app's memory viewer; cave-aka2.)
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
        return `/#grimoire:memory:${encodeURIComponent(link.ref)}`;
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
        stats: item.media?.stats ?? parseStatsFromBody(item.body),
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

/**
 * Recover the headline counts from the summary body text — the lines the
 * summary builder writes ("N reminders fired", "N responses waiting", "N
 * familiar updates", "N sessions updated"). Older reports were generated before
 * the counts were frozen into `media.stats`; this lets the dashboard rows and
 * the report page still show their stats. Returns null when the body carries
 * none of the four count lines (so a non-summary body yields no zeros).
 */
export function parseStatsFromBody(body: string | undefined): DailyReportStats | null {
  if (!body) return null;
  const count = (re: RegExp): number | null => {
    const m = body.match(re);
    return m ? Number.parseInt(m[1], 10) : null;
  };
  const reminders = count(/(\d+)\s+reminders?\s+fired/i);
  const responses = count(/(\d+)\s+responses?\s+waiting/i);
  const familiars = count(/(\d+)\s+familiar\s+updates?/i);
  const sessions = count(/(\d+)\s+sessions?\s+updated/i);
  if (reminders === null && responses === null && familiars === null && sessions === null) {
    return null;
  }
  // Day-in-review lines are optional — absent stays absent (never zero), so
  // pre-Phase-B bodies keep their original shape.
  const prsMerged = count(/(\d+)\s+PRs?\s+merged/i);
  const cardsCompleted = count(/(\d+)\s+cards?\s+completed/i);
  return {
    reminders: reminders ?? 0,
    responses: responses ?? 0,
    familiars: familiars ?? 0,
    sessions: sessions ?? 0,
    ...(prsMerged !== null ? { prsMerged } : {}),
    ...(cardsCompleted !== null ? { cardsCompleted } : {}),
  };
}
