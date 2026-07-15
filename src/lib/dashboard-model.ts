// Pure view-model for the unified /dashboard surface. Composes the existing
// daily-report helpers over the live inbox. Today's daily summary (narrative,
// day-in-review facts) is folded in here so the dashboard *is* the day's
// report — the standalone /daily-report/[date] route remains for historical
// days. (The cockpit's panel order lives in its own Layout system; the old
// zones-based dashboardLayout()/DashboardZone were removed as dead code —
// cave-pbk4.)
//
// Kept free of `node:` imports — `InboxItem` is a type-only import — so the
// client action-inbox island and the strip-types tests can import it safely.

import type { InboxItem } from "./cave-inbox";
import type { DailyReportPayload } from "./daily-report-facts";
import {
  breakdownForDay,
  dateSlug,
  parseRecentSessions,
  recentReports,
  type RecentReport,
} from "./daily-report";

/** Today's generated daily summary, surfaced inline on the dashboard. */
export type TodaySummary = {
  title: string;
  body: string;
  imageUrl: string | null;
  alt: string;
  generatedAt: string | null;
  /** Read-only session names recovered from the frozen summary body. */
  recentSessions: string[];
  /** Structured day-in-review facts — null on items generated before Phase B. */
  report: DailyReportPayload | null;
  /** Familiar-written narrative for today, or null before one generates. */
  narrative: { text: string; familiarName?: string; generatedAt: string } | null;
};

export type DashboardModel = {
  date: Date;
  caughtUp: boolean;
  /** Open, actionable items — same set the old "Needs attention" list showed, capped. */
  needsAttention: InboxItem[];
  /** True number of open items — `needsAttention` is capped for display, this isn't. */
  openCount: number;
  /** Today's generated summary narrative, or null before one exists. */
  todaySummary: TodaySummary | null;
  featuredReport: RecentReport | null;
  /** Reports other than the featured one (newest first). */
  recentReports: RecentReport[];
};

const NEEDS_ATTENTION_CAP = 8;

export function buildDashboardModel(items: InboxItem[], now: Date): DashboardModel {
  const breakdown = breakdownForDay(items, now);
  const reports = recentReports(items);
  const todaySlug = dateSlug(now);
  const todaysReport = reports.find((r) => r.slug === todaySlug) ?? null;
  const featuredReport = todaysReport ?? reports[0] ?? null;

  const todayItem = items.find(
    (item) => item.kind === "daily-summary" && item.auto === `daily-summary:${todaySlug}`,
  );
  const todaySummary: TodaySummary | null = todayItem
    ? {
        title: todayItem.title,
        body: todayItem.body ?? "",
        imageUrl: todayItem.media?.imageUrl ?? null,
        alt: todayItem.media?.alt ?? "",
        generatedAt: todayItem.media?.generatedAt ?? todayItem.firedAt ?? todayItem.updatedAt ?? null,
        recentSessions: parseRecentSessions(todayItem.body),
        report: todayItem.media?.report ?? null,
        narrative: todayItem.media?.narrative ?? null,
      }
    : null;

  return {
    date: now,
    caughtUp: breakdown.openItems.length === 0,
    needsAttention: breakdown.openItems.slice(0, NEEDS_ATTENTION_CAP),
    openCount: breakdown.openItems.length,
    todaySummary,
    featuredReport,
    recentReports: reports.filter((r) => r.slug !== featuredReport?.slug),
  };
}

/**
 * Optimistic transition for the action inbox: snooze/done/dismiss all remove
 * the item from the "needs you" list. Pure — returns a new array, never
 * mutates. The caller keeps the previous array to revert on a failed POST.
 */
export function nextItemsAfterAction(items: InboxItem[], id: string): InboxItem[] {
  return items.filter((item) => item.id !== id);
}
