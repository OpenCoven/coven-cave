/**
 * sentinel-watch — pure watch logic for the Sentinel Watchtower room.
 *
 * Alert triage semantics over the Cave's real escalations (`/api/escalations`)
 * plus session-health derivation over the familiar's real session rows. Kept
 * JSX-free (type-only imports) so the rules are unit-testable under plain
 * `node --experimental-strip-types`.
 */

import type { Escalation, EscalationSeverity } from "@/lib/escalations-types";
import type { SessionRow } from "@/lib/types";

export type AlertScope = "open" | "snoozed" | "resolved" | "all";

export type AlertSeverityFilter = EscalationSeverity | "all";

export type AlertSummary = {
  /** Needs attention now: new/acknowledged, plus snoozes that have come due. */
  open: number;
  critical: number;
  warn: number;
  info: number;
  /** Snoozed with a wake time still in the future. */
  snoozed: number;
  /** Open alerts explicitly flagged as requiring a human decision. */
  decisionsRequired: number;
};

/**
 * Is this alert demanding attention right now? Matches the Inbox badge rule
 * (workspace.tsx): resolved/dismissed never; snoozed only once the snooze has
 * come due (a snooze without a wake time counts as due).
 */
export function isOpenAlert(
  item: Pick<Escalation, "state" | "snoozeUntil">,
  now: number = Date.now(),
): boolean {
  if (item.state === "resolved" || item.state === "dismissed") return false;
  if (item.state === "snoozed" && item.snoozeUntil) {
    return new Date(item.snoozeUntil).getTime() <= now;
  }
  return true;
}

export function summarizeAlerts(items: readonly Escalation[], now: number = Date.now()): AlertSummary {
  const summary: AlertSummary = { open: 0, critical: 0, warn: 0, info: 0, snoozed: 0, decisionsRequired: 0 };
  for (const item of items) {
    if (isOpenAlert(item, now)) {
      summary.open += 1;
      summary[item.severity] += 1;
      if (item.decisionRequired) summary.decisionsRequired += 1;
    } else if (item.state === "snoozed") {
      summary.snoozed += 1;
    }
  }
  return summary;
}

/**
 * Scope + severity filter over the API's already-sorted list (critical first,
 * newest within severity) — order is preserved, never re-invented here.
 */
export function filterAlerts(
  items: readonly Escalation[],
  scope: AlertScope,
  severity: AlertSeverityFilter,
  now: number = Date.now(),
): Escalation[] {
  return items.filter((item) => {
    if (severity !== "all" && item.severity !== severity) return false;
    switch (scope) {
      case "open":
        return isOpenAlert(item, now);
      case "snoozed":
        return item.state === "snoozed" && !isOpenAlert(item, now);
      case "resolved":
        return item.state === "resolved" || item.state === "dismissed";
      case "all":
        return true;
    }
  });
}

export type SessionWatch = {
  running: number;
  /** Unarchived sessions whose last exit was a failure. */
  failed: number;
  /** Most recent failures first, capped for the watch log. */
  recentFailures: SessionRow[];
};

const RECENT_FAILURES_CAP = 6;

function isFailedSession(session: SessionRow): boolean {
  return session.archived_at == null && session.exit_code != null && session.exit_code !== 0;
}

export function watchSessions(sessions: readonly SessionRow[]): SessionWatch {
  const failures = sessions
    .filter(isFailedSession)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return {
    running: sessions.filter((s) => s.status === "running").length,
    failed: failures.length,
    recentFailures: failures.slice(0, RECENT_FAILURES_CAP),
  };
}

export type WatchtowerStatus = {
  label: string;
  tone: "ok" | "busy" | "warn";
};

/** The room's one-line status chip, derived from the latest alert sweep. */
export function watchtowerStatus(summary: Pick<AlertSummary, "open" | "critical">): WatchtowerStatus {
  if (summary.critical > 0) {
    return { label: `${summary.critical} critical alert${summary.critical === 1 ? "" : "s"}`, tone: "warn" };
  }
  if (summary.open > 0) {
    return { label: `${summary.open} open alert${summary.open === 1 ? "" : "s"}`, tone: "busy" };
  }
  return { label: "perimeter clear", tone: "ok" };
}
