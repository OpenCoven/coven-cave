// Pure view-model for the unified /dashboard surface. Composes the existing
// daily-report helpers and decides, from the live inbox, how to order the
// single-page layout: triage-first when something needs you, calm-first when
// caught up. Today's daily summary (metrics, narrative, familiar updates) is
// folded in here so the dashboard *is* the day's report — the standalone
// /daily-report/[date] route remains for historical days.
//
// Kept free of `node:` imports — `InboxItem` is a type-only import — so the
// client action-inbox island and the strip-types tests can import it safely.

import type { InboxItem } from "./cave-inbox";
import {
  breakdownForDay,
  dateSlug,
  liveSnapshot,
  parseRecentSessions,
  recentReports,
  type DailyReportStats,
  type RecentReport,
} from "./daily-report";

/** Zones the dashboard can render, in display order. Presence varies by state. */
export type DashboardZone =
  | "caughtUpStrip"
  | "actionInbox"
  | "metrics"
  | "todaySummary"
  | "familiarUpdates"
  | "launcher"
  | "recentReports";

/** Today's generated daily summary, surfaced inline on the dashboard. */
export type TodaySummary = {
  title: string;
  body: string;
  imageUrl: string | null;
  alt: string;
  generatedAt: string | null;
  /** Read-only session names recovered from the frozen summary body. */
  recentSessions: string[];
};

export type DashboardModel = {
  date: Date;
  caughtUp: boolean;
  /** Open, actionable items — same set the old "Needs attention" list showed, capped. */
  needsAttention: InboxItem[];
  /** Day-at-a-glance counts. Frozen (from today's report) when available, else live. */
  metrics: DailyReportStats;
  /** True when `metrics` is the live inbox snapshot rather than a frozen report. */
  metricsLive: boolean;
  /** Familiar updates fired today (live). */
  familiarUpdates: InboxItem[];
  /** Today's generated summary narrative, or null before one exists. */
  todaySummary: TodaySummary | null;
  todaysReport: RecentReport | null;
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
        generatedAt: todayItem.firedAt ?? todayItem.updatedAt ?? null,
        recentSessions: parseRecentSessions(todayItem.body),
      }
    : null;

  // Prefer the frozen counts captured when today's report ran (they include
  // daemon-backed session counts the client can't see); fall back to the live
  // snapshot before any report exists.
  const frozen = todayItem?.media?.stats ?? null;
  const metrics = frozen ?? liveSnapshot(items, now);

  return {
    date: now,
    caughtUp: breakdown.openItems.length === 0,
    needsAttention: breakdown.openItems.slice(0, NEEDS_ATTENTION_CAP),
    metrics,
    metricsLive: frozen === null,
    familiarUpdates: breakdown.familiars,
    todaySummary,
    todaysReport,
    featuredReport,
    recentReports: reports.filter((r) => r.slug !== featuredReport?.slug),
  };
}

/**
 * Ordered zones for the current state on the single unified page.
 *
 * - Busy → lead with the action inbox (triage), then the day at a glance,
 *   today's summary, the launcher, and recent reports.
 * - Caught up → lead with the calm strip, then metrics, today's story,
 *   familiar updates, the launcher, and recent reports.
 *
 * The `metrics` and `todaySummary` zones always render: `metrics` shows live
 * counts before a report exists, and `todaySummary` falls back to a callout
 * linking the latest report when today's hasn't generated yet.
 */
export function dashboardLayout(model: DashboardModel): DashboardZone[] {
  if (model.caughtUp) {
    return ["caughtUpStrip", "metrics", "todaySummary", "familiarUpdates", "launcher", "recentReports"];
  }
  return ["actionInbox", "metrics", "todaySummary", "launcher", "recentReports"];
}

/**
 * Optimistic transition for the action inbox: snooze/done/dismiss all remove
 * the item from the "needs you" list. Pure — returns a new array, never
 * mutates. The caller keeps the previous array to revert on a failed POST.
 */
export function nextItemsAfterAction(items: InboxItem[], id: string): InboxItem[] {
  return items.filter((item) => item.id !== id);
}
