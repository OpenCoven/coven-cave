// Pure view-model for the /dashboard surface. Composes the existing
// daily-report helpers and decides, from the live inbox, whether the page
// leads with triage (something needs you) or the launcher (caught up).
//
// Kept free of `node:` imports — `InboxItem` is a type-only import — so the
// client action-inbox island and the strip-types tests can import it safely.

import type { InboxItem } from "./cave-inbox";
import { breakdownForDay, dateSlug, recentReports, type RecentReport } from "./daily-report";

/** Zones the dashboard can render, in display order. Presence varies by state. */
export type DashboardZone =
  | "caughtUpStrip"
  | "actionInbox"
  | "reportCallout"
  | "launcher"
  | "recentReports";

export type DashboardModel = {
  date: Date;
  caughtUp: boolean;
  /** Open, actionable items — same set the old "Needs attention" list showed, capped. */
  needsAttention: InboxItem[];
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
  return {
    date: now,
    caughtUp: breakdown.openItems.length === 0,
    needsAttention: breakdown.openItems.slice(0, NEEDS_ATTENTION_CAP),
    todaysReport,
    featuredReport,
    recentReports: reports.filter((r) => r.slug !== featuredReport?.slug),
  };
}

/** Ordered zones for the current state. Launcher/report variants are decided in the view. */
export function dashboardLayout(model: DashboardModel): DashboardZone[] {
  if (model.caughtUp) {
    return ["caughtUpStrip", "reportCallout", "launcher", "recentReports"];
  }
  return ["actionInbox", "reportCallout", "launcher"];
}

/**
 * Optimistic transition for the action inbox: snooze/done/dismiss all remove
 * the item from the "needs you" list. Pure — returns a new array, never
 * mutates. The caller keeps the previous array to revert on a failed POST.
 */
export function nextItemsAfterAction(items: InboxItem[], id: string): InboxItem[] {
  return items.filter((item) => item.id !== id);
}
