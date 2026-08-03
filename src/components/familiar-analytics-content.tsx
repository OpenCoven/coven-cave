"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FamiliarAnalyticsModel } from "@/components/familiar-analytics-data";
import type { FeedbackSliceStat, MessageFeedbackRollup } from "@/lib/message-feedback-rollup";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { RelativeTime } from "@/components/ui/relative-time";
import { Sparkline, type SparkPoint } from "@/components/ui/sparkline";
import { useAnnouncer } from "@/components/ui/live-region";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { ThreadSignalsSection } from "@/components/thread-signals-section";
import {
  FamiliarAnalyticsDock,
  TrustRing,
  confidenceTier,
  type ContractPropertyDetail,
  type DockAction,
} from "@/components/familiar-analytics-dock";
import {
  ANALYTICS_WINDOWS,
  DEFAULT_LENS,
  DEFAULT_WINDOW,
  PulseOverlay,
  ScopeBar,
  SelfHealStrip,
  StatBand,
  matchesLens,
  withinWindow,
  type LensId,
  type WindowId,
} from "@/components/familiar-analytics-stage";
import { escalateBlockers, type SelfHealRequest } from "@/lib/familiar-heal-requests";
import {
  THREAD_CONFIDENCE_EMPTY_STATE,
  type ThreadConfidence,
  type ThreadMetricKey,
} from "@/lib/thread-confidence";
import type { MetricTrend, SignalTrends, TrendDirection } from "@/lib/signal-trends";
import type { ContractReport, FamiliarProperty } from "@/lib/familiar-contract";
import type { Familiar, SessionRow } from "@/lib/types";
import { Icon } from "@/lib/icon";
import { formatTimeToFirstReply, timeToFirstReplyMs } from "@/lib/first-run-stamps";
import { SessionTraceOverlay, type TraceTarget } from "@/components/session-trace-overlay";
import { sessionDayKey, type PulseDay } from "@/lib/session-pulse";
import { requestAgentsNewChat } from "@/lib/agents-new-chat";
import { buildRehabilitationBrief } from "@/lib/familiar-rehabilitation";
import {
  aggregateThreadSignals,
  buildThreadSignalReviewQueue,
  contextPressureLabel,
  deriveThreadScore,
  type ContextPressure,
  type ThreadSelfReport,
} from "@/lib/thread-self-report";

// Plain-language meaning for each thread-analysis metric (0–100 average across
// this familiar's thread self-reports). Presentation-only — the averages and
// weights come from deriveThreadConfidence in thread-confidence.ts.
const THREAD_METRIC_COPY: Record<ThreadMetricKey, string> = {
  confidence: "How confident the familiar reported feeling across whole threads.",
  toolReliability: "How reliably tools worked when the familiar reached for them.",
  memoryRecall: "How well earlier context and memory could be recalled mid-thread.",
  fileLocatability: "How easily the familiar found the files it needed.",
};

const CONTEXT_PRESSURES: ContextPressure[] = ["adequate", "tight", "excess", "critical"];

// Plain-language explanation of each context-pressure bucket, for the pill tooltip.
const CONTEXT_PRESSURE_HINT: Record<ContextPressure, string> = {
  adequate: "Comfortable context headroom.",
  tight: "Context was near the limit.",
  excess: "More context than needed — wasted budget.",
  critical: "Ran out of context.",
};

/** One thread-analysis metric row: averaged value bar + weight-aware tooltip
 *  + a delta chip against the previous trend bucket when history allows. */
function ThreadMetricBar({
  label,
  value,
  weight,
  desc,
  trend,
}: {
  label: string;
  value: number;
  weight: number;
  desc: string;
  trend?: MetricTrend;
}) {
  const tip = `${desc} Weighted at ${Math.round(weight * 100)}% — adds up to ${Math.round(weight * 100)} points of the headline score's 100.`;
  return (
    <div className="fa-thread-score">
      <div>
        <span>
          {label}
          <button type="button" className="fa-factor-info" title={tip} aria-label={`${label}: ${tip}`}>
            <Icon name="ph:info" width={12} aria-hidden />
          </button>
        </span>
        <b>
          {trend ? <TrendDeltaChip label={label} trend={trend} /> : null}
          {value}
          <span className="fa-metric-unit">/100</span>
        </b>
      </div>
      <div className="fa-factor-bar" aria-label={`${label} ${value} of 100`}>
        <span className="fa-factor-segment" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

// ─── Signal trends (is the familiar improving?) ──────────────────────────────

const TREND_VERDICT_COPY: Record<TrendDirection, string> = {
  improving: "Improving",
  flat: "Holding steady",
  regressing: "Regressing",
  insufficient: "Not enough history yet",
};

const TREND_VERDICT_ICON: Record<TrendDirection, Parameters<typeof Icon>[0]["name"]> = {
  improving: "ph:trend-up",
  flat: "ph:minus",
  regressing: "ph:trend-down",
  insufficient: "ph:clock",
};

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** Compact per-metric delta against the previous trend bucket (▲ +8 / ▼ -6 / — ±2). */
function TrendDeltaChip({ label, trend }: { label: string; trend: MetricTrend }) {
  if (trend.delta === null || trend.direction === "insufficient") return null;
  const icon =
    trend.direction === "improving" ? "ph:caret-up" : trend.direction === "regressing" ? "ph:caret-down" : "ph:minus";
  const phrase =
    trend.direction === "flat"
      ? `${label} holding steady (${formatDelta(trend.delta)} vs the previous period)`
      : `${label} ${trend.direction} — ${formatDelta(trend.delta)} vs the previous period`;
  return (
    <span
      className={`fa-trend-chip fa-trend-chip--${trend.direction}`}
      role="img"
      aria-label={phrase}
      title={phrase}
    >
      <Icon name={icon} width={11} aria-hidden />
      {formatDelta(trend.delta)}
    </span>
  );
}

/**
 * Changes over time — the honest "is the familiar improving?" read. A verdict
 * chip on the weighted headline score, plus a bucket-scored sparkline (day or
 * week granularity, per the data's span). Insufficient history says so
 * instead of inventing a direction.
 */
function ThreadTrendBlock({ trends }: { trends: SignalTrends }) {
  const overall = trends.overall;
  const dataBuckets = trends.buckets.filter((bucket) => bucket.score !== null);
  const points: SparkPoint[] = trends.buckets.map((bucket) => ({
    label: `${bucket.label}${bucket.count > 0 ? ` · ${bucket.count} report${bucket.count === 1 ? "" : "s"}` : ""}`,
    value: bucket.score,
  }));
  const granularityNoun = trends.granularity === "week" ? "weeks" : "days";
  const windowPhrase = `last ${trends.buckets.length} ${granularityNoun}`;

  return (
    <div className="fa-trend" role="group" aria-label="Thread metric changes over time">
      <div className="fa-trend__head">
        <span
          className={`fa-trend-verdict fa-trend-verdict--${overall.direction}`}
          title={
            overall.delta !== null
              ? `Weighted score ${overall.latest} vs ${overall.previous} in the previous period (${formatDelta(overall.delta)})`
              : "A verdict needs reports in at least two different periods."
          }
        >
          <Icon name={TREND_VERDICT_ICON[overall.direction]} width={13} aria-hidden />
          {TREND_VERDICT_COPY[overall.direction]}
          {overall.delta !== null ? <b>{formatDelta(overall.delta)}</b> : null}
        </span>
        {overall.latest !== null ? (
          <b className="fa-trend__score">{overall.latest}</b>
        ) : null}
        <span className="fa-trend__meta">
          <Icon name="ph:calendar-blank" width={11} aria-hidden />
          {windowPhrase} · {trends.snapshotCount} report{trends.snapshotCount === 1 ? "" : "s"}
        </span>
      </div>
      {dataBuckets.length >= 2 ? (
        <figure
          className="fa-trend__spark"
          role="img"
          aria-label={`Weighted thread score per ${trends.granularity} over the ${windowPhrase}: ${TREND_VERDICT_COPY[overall.direction].toLowerCase()}`}
        >
          <Sparkline points={points} color={trendTokenFor(overall.direction)} height={72} />
          <figcaption aria-hidden>
            Weighted score per {trends.granularity}, oldest to newest · hover for values
          </figcaption>
        </figure>
      ) : (
        <p className="fa-trend__empty">
          Trends appear once reports land on two different {granularityNoun.slice(0, -1)}s.
        </p>
      )}
    </div>
  );
}

/** Trend tone tokens: improving = presence accent, regressing = warning. */
function trendTokenFor(direction: TrendDirection): string {
  if (direction === "improving") return "var(--accent-presence)";
  if (direction === "regressing") return "var(--color-warning)";
  return "var(--text-muted)";
}

/**
 * Confidence from thread analysis — the real self-reported metric averages
 * behind the headline score, plus the changes-over-time read. With no reports
 * yet it teaches the fix: enable response self-reporting.
 */
const ThreadAnalysisBody = memo(function ThreadAnalysisBody({
  confidence,
  trends,
  familiar,
  onSelfReportEnabled,
}: {
  confidence: ThreadConfidence;
  trends: SignalTrends;
  familiar: Familiar | null;
  onSelfReportEnabled?: () => void;
}) {
  const trendByKey = new Map(trends.metrics.map((metric) => [metric.key, metric]));
  if (!confidence.hasData) {
    return (
      <SelfReportEmptyState
        familiar={familiar}
        onSelfReportEnabled={onSelfReportEnabled}
        headline={THREAD_CONFIDENCE_EMPTY_STATE}
        enabledHeadline="No thread reports yet."
      />
    );
  }
  return (
    <div className="fa-thread-analysis">
      <ThreadTrendBlock trends={trends} />
      <div className="fa-thread-score-grid">
        {confidence.metrics.map((metric) => (
          <ThreadMetricBar
            key={metric.key}
            label={metric.label}
            value={metric.value}
            weight={metric.weight}
            desc={THREAD_METRIC_COPY[metric.key]}
            trend={trendByKey.get(metric.key)}
          />
        ))}
      </div>
      <div className="fa-thread-contexts" aria-label="Context pressure distribution">
        {CONTEXT_PRESSURES.map((pressure) => (
          <span
            key={pressure}
            className={`fa-thread-pill fa-thread-pill--${pressure}`}
            title={`${pressure} — ${CONTEXT_PRESSURE_HINT[pressure]}`}
          >
            {pressure} <b>{confidence.contextCounts[pressure]}</b>
          </span>
        ))}
      </div>
    </div>
  );
});

/**
 * Empty state for the self-report-driven thread-analysis panel. When the
 * familiar hasn't enabled self-reporting, the notice carries the fix — a
 * one-click enable that persists `autoSelfReport` to cave-config (the same
 * key the Studio's Brain tab toggles) instead of sending the user hunting
 * through Settings.
 */
function SelfReportEmptyState({
  familiar,
  onSelfReportEnabled,
  headline,
  enabledHeadline,
}: {
  familiar: Familiar | null;
  onSelfReportEnabled?: () => void;
  /** Teach copy when self-reporting is still off. */
  headline: string;
  /** Headline once self-reporting is on but no data has landed yet. */
  enabledHeadline: string;
}) {
  const { announce } = useAnnouncer();
  const [enabling, setEnabling] = useState(false);
  // Truthful optimistic latch: set only after the config write succeeds, so
  // the notice never claims a state the daemon didn't accept.
  const [justEnabled, setJustEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selfReportOn = justEnabled || Boolean(familiar?.autoSelfReport);

  const enable = useCallback(async () => {
    if (!familiar) return;
    setEnabling(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiars: { [familiar.id]: { autoSelfReport: true } } }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? res.statusText);
      setJustEnabled(true);
      announce("Response self-reporting enabled.");
      onSelfReportEnabled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't save");
    } finally {
      setEnabling(false);
    }
  }, [announce, familiar, onSelfReportEnabled]);

  if (selfReportOn) {
    return (
      <EmptyState
        compact
        icon="ph:chart-bar-bold"
        headline={enabledHeadline}
        subtitle={
          justEnabled
            ? "Self-reporting enabled — reports are written when a chat closes or is archived."
            : "Self-reporting is on — reports are written when a chat closes or is archived."
        }
      />
    );
  }

  return (
    <EmptyState
      compact
      icon="ph:chart-bar-bold"
      headline={headline}
      subtitle={error ? `Couldn't enable: ${error}` : undefined}
      actions={
        familiar ? (
          <Button size="sm" variant="primary" loading={enabling} onClick={() => void enable()}>
            Enable self-reporting
          </Button>
        ) : undefined
      }
    />
  );
}

// ─── Thread report ledger (the confidence panel's other face) ────────────────

type ReportGroupBy = "none" | "press" | "band" | "week";

const REPORT_GROUPS: { id: ReportGroupBy; label: string; title: string }[] = [
  { id: "none", label: "Flat", title: "No grouping" },
  { id: "press", label: "Context", title: "Group by context pressure" },
  { id: "band", label: "Score band", title: "Group by score band" },
  { id: "week", label: "Week", title: "Group by the week it was reported" },
];

function scoreBand(score: number): string {
  if (score >= 65) return "Healthy · 65+";
  if (score >= 55) return "Watch · 55–64";
  return "At risk · below 55";
}

function scoreTone(score: number): "good" | "warn" | "bad" {
  if (score >= 65) return "good";
  if (score >= 55) return "warn";
  return "bad";
}

function weekLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "Undated";
  const day = new Date(ms);
  // Monday-anchored week so a report's bucket doesn't drift with the locale.
  const offset = (day.getUTCDay() + 6) % 7;
  const monday = new Date(ms - offset * 24 * 60 * 60 * 1000);
  return `Week of ${monday.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * Every thread self-report in the window, as a ledger. This is the evidence
 * under the confidence summary: one row per report, the four metric columns
 * that feed the weighted score, and the context-pressure verdict — groupable
 * so a reader can ask "which weeks regressed?" without leaving the panel.
 */
const ReportLedger = memo(function ReportLedger({ reports }: { reports: ThreadSelfReport[] }) {
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("none");
  const groups = useMemo(() => {
    const keyOf = (report: ThreadSelfReport): string => {
      if (groupBy === "press") return contextPressureLabel(report.contextPressure).label;
      if (groupBy === "band") return scoreBand(deriveThreadScore(report));
      if (groupBy === "week") return weekLabel(report.reportedAt);
      return "All reports";
    };
    const buckets = new Map<string, ThreadSelfReport[]>();
    for (const report of reports) {
      const key = keyOf(report);
      const list = buckets.get(key);
      if (list) list.push(report);
      else buckets.set(key, [report]);
    }
    return [...buckets.entries()].map(([label, rows]) => {
      const avg = Math.round(rows.reduce((sum, row) => sum + deriveThreadScore(row), 0) / rows.length);
      return { label, rows, avg };
    });
  }, [groupBy, reports]);

  if (reports.length === 0) {
    return (
      <EmptyState
        compact
        icon="ph:table"
        headline="No thread reports in this window."
        subtitle="Widen the window, or let this familiar close a few more threads."
      />
    );
  }

  return (
    <>
      <div className="fa-ledger-tools">
        <span className="fa-ledger-tools__label">Group</span>
        <div className="fa-segmented" role="group" aria-label="Group reports by">
          {REPORT_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`fa-segmented__btn${groupBy === group.id ? " is-active" : ""} focus-ring`}
              aria-pressed={groupBy === group.id}
              title={group.title}
              onClick={() => setGroupBy(group.id)}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>
      <div className="fa-ledger">
        <div className="fa-ledger__head" role="row">
          <span>Date</span>
          <span>Thread topic</span>
          <span className="is-num">Conf</span>
          <span className="is-num">Tool</span>
          <span className="is-num">Mem</span>
          <span className="is-num">File</span>
          <span className="is-num">Score</span>
          <span>Context</span>
        </div>
        <div className="fa-ledger__body">
          {groups.map((group) => (
            <div key={group.label} className="fa-ledger__group">
              {groupBy !== "none" ? (
                <div className={`fa-ledger__group-head fa-ledger__group-head--${scoreTone(group.avg)}`}>
                  <b>{group.label}</b>
                  <span>{group.rows.length} report{group.rows.length === 1 ? "" : "s"}</span>
                  <b className="fa-ledger__group-avg">avg {group.avg}</b>
                </div>
              ) : null}
              {group.rows.map((report) => {
                const score = deriveThreadScore(report);
                const pressure = contextPressureLabel(report.contextPressure);
                return (
                  <div key={report.id} className="fa-ledger__row" role="row">
                    <span className="fa-ledger__when">
                      <RelativeTime iso={report.reportedAt} />
                    </span>
                    <span className="fa-ledger__topic" title={report.threadTitle || report.sessionId}>
                      {report.threadTitle || report.sessionId}
                    </span>
                    <span className="is-num">{report.overallConfidence}</span>
                    <span className="is-num">{report.toolReliability.score}</span>
                    <span className="is-num">{report.memoryRecallScore}</span>
                    <span className="is-num">{report.fileLocatabilityScore}</span>
                    <span className={`fa-ledger__score fa-ledger__score--${scoreTone(score)}`}>
                      <i aria-hidden><b style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></i>
                      <b>{score}</b>
                    </span>
                    <span className={`fa-ledger__press fa-ledger__press--${pressure.severity}`}>
                      {pressure.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="fa-panel__foot">
        Score = 35% confidence · 25% tool · 20% memory · 20% file-finding, per report.
      </p>
    </>
  );
});

// ─── Sessions ───────────────────────────────────────────────────────────────

/** Status tone for a session row's presence dot. */
function sessionStatusTone(status: string): "run" | "bad" | "done" {
  const s = status.toLowerCase();
  if (/(running|active|working|streaming|starting)/.test(s)) return "run";
  if (/(error|fail|killed|crash)/.test(s)) return "bad";
  return "done";
}

/** Session rows per page in the drill-through list — a pager walks the rest. */
const SESSIONS_PAGE_SIZE = 6;

/**
 * Recent sessions — the tracing spine of the page. Every row is one click
 * from the conversation (`/#chat-<id>`) and one click from the daemon event
 * timeline (trace overlay). A clicked pulse day narrows the list to that day;
 * a pager walks history a page at a time instead of truncating it silently.
 */
const RecentSessionsBody = memo(function RecentSessionsBody({
  sessions,
  selectedDay,
  onClearDay,
  onTrace,
}: {
  sessions: SessionRow[];
  selectedDay: PulseDay | null;
  onClearDay: () => void;
  onTrace: (target: TraceTarget) => void;
}) {
  const [page, setPage] = useState(0);
  const filtered = selectedDay
    ? sessions.filter((session) => sessionDayKey(session.updated_at) === selectedDay.key)
    : sessions;
  const pageCount = Math.max(1, Math.ceil(filtered.length / SESSIONS_PAGE_SIZE));
  // A day filter or a shrinking list can strand the page past the end.
  const safePage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);
  const shown = filtered.slice(safePage * SESSIONS_PAGE_SIZE, safePage * SESSIONS_PAGE_SIZE + SESSIONS_PAGE_SIZE);

  if (sessions.length === 0) {
    return (
      <EmptyState
        compact
        icon="ph:terminal-window"
        headline="No sessions in this window."
        subtitle="Widen the window, or let this familiar run."
      />
    );
  }

  return (
    <div className="fa-sessions">
      {selectedDay ? (
        <button
          type="button"
          className="fa-day-chip focus-ring"
          onClick={() => {
            setPage(0);
            onClearDay();
          }}
          title="Clear the day filter"
        >
          {selectedDay.label} · {filtered.length} session{filtered.length === 1 ? "" : "s"}
          <Icon name="ph:x" width={11} aria-hidden />
        </button>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyState
          compact
          icon="ph:terminal-window"
          headline={`No sessions on ${selectedDay?.label ?? "that day"}.`}
          subtitle="Pick another pulse day, or clear the filter."
        />
      ) : (
        <ul className="fa-session-list">
          {shown.map((session) => {
            const tone = sessionStatusTone(session.status);
            return (
              <li key={session.id} className={`fa-session fa-session--${tone}`}>
                <span className="fa-session__rail" aria-hidden />
                <span className="fa-session__main">
                  <a
                    className="fa-session__title focus-ring"
                    href={`/#chat-${encodeURIComponent(session.id)}`}
                    title="Open this thread in chat"
                  >
                    {session.title || session.id}
                  </a>
                  <small className="fa-session__meta">
                    <span className="fa-session__status">{session.status}</span>
                    <span className="fa-session__harness">{session.harness}</span>
                    {session.diff ? (
                      <span className="fa-session__diff">
                        +{session.diff.additions} −{session.diff.deletions}
                      </span>
                    ) : (
                      <span className="fa-session__diff">no diff</span>
                    )}
                  </small>
                </span>
                <RelativeTime iso={session.updated_at} className="fa-session__time" />
                <button
                  type="button"
                  className="fa-trace-btn focus-ring"
                  title="Trace this session's daemon events"
                  aria-label={`Trace ${session.title || session.id}`}
                  onClick={() => onTrace({ id: session.id, title: session.title })}
                >
                  <Icon name="ph:tree-structure" width={12} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > SESSIONS_PAGE_SIZE ? (
        <div className="fa-pager">
          <button
            type="button"
            className="fa-pager__btn focus-ring"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous page of sessions"
          >
            <Icon name="ph:caret-left" width={11} aria-hidden />
            Prev
          </button>
          <span className="fa-pager__label">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="fa-pager__btn focus-ring"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            aria-label="Next page of sessions"
          >
            Next
            <Icon name="ph:caret-right" width={11} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
});

/** The full session log — every session in the window, denser than the list
 *  and sorted newest first, with the same trace shortcut on every row. */
const SessionLog = memo(function SessionLog({
  sessions,
  onTrace,
}: {
  sessions: SessionRow[];
  onTrace: (target: TraceTarget) => void;
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        compact
        icon="ph:terminal-window"
        headline="No sessions in this window."
        subtitle="Widen the window to see more history."
      />
    );
  }
  const failed = sessions.filter((session) => sessionStatusTone(session.status) === "bad").length;
  return (
    <>
      <div className="fa-ledger">
        <div className="fa-ledger__head fa-ledger__head--sessions" role="row">
          <span>#</span>
          <span>Thread</span>
          <span>Status</span>
          <span className="is-num">Diff</span>
          <span />
        </div>
        <div className="fa-ledger__body">
          {sessions.map((session, index) => {
            const tone = sessionStatusTone(session.status);
            return (
              <div key={session.id} className="fa-ledger__row fa-ledger__row--sessions" role="row">
                <span className="fa-ledger__n">{index + 1}</span>
                <span className="fa-ledger__thread">
                  <a
                    className="fa-ledger__topic focus-ring"
                    href={`/#chat-${encodeURIComponent(session.id)}`}
                    title="Open this thread in chat"
                  >
                    {session.title || session.id}
                  </a>
                  <RelativeTime iso={session.updated_at} className="fa-ledger__when" />
                </span>
                <span className={`fa-ledger__status fa-ledger__status--${tone}`}>{session.status}</span>
                <span className="is-num fa-ledger__diff">
                  {session.diff ? `+${session.diff.additions} −${session.diff.deletions}` : "—"}
                </span>
                <button
                  type="button"
                  className="fa-trace-btn fa-trace-btn--sm focus-ring"
                  title="Trace this session"
                  aria-label={`Trace ${session.title || session.id}`}
                  onClick={() => onTrace({ id: session.id, title: session.title })}
                >
                  <Icon name="ph:tree-structure" width={10} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <p className="fa-panel__foot">
        {sessions.length} session{sessions.length === 1 ? "" : "s"} in the window · {sessions.length - failed} completed,{" "}
        {failed} failed · Trace opens the daemon timeline.
      </p>
    </>
  );
});

// ─── Stage panels ───────────────────────────────────────────────────────────

/**
 * A two-faced stage panel. Both faces are always mounted so the panel's height
 * is stable across a flip, and `backface-visibility` keeps the hidden one from
 * bleeding through. The head is duplicated per face because the two faces
 * describe different things — a shared head would have to lie about one.
 */
function FlipPanel({
  id,
  flipped,
  front,
  back,
}: {
  id: string;
  flipped: boolean;
  front: ReactNode;
  back: ReactNode;
}) {
  return (
    <div className="fa-panel-slot" id={id}>
      <div className={`fa-panel-pivot${flipped ? " is-flipped" : ""}`}>
        <section className="fa-panel" aria-hidden={flipped}>{front}</section>
        <section className="fa-panel fa-panel--back" aria-hidden={!flipped}>{back}</section>
      </div>
    </div>
  );
}

function PanelHead({
  icon,
  title,
  count,
  children,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  count?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="fa-panel__head">
      <span className="fa-band-crest" aria-hidden>
        <Icon name={icon} width={13} />
      </span>
      <h2 className="fa-panel__title">{title}</h2>
      {count !== undefined ? <span className="fa-band-count">{count}</span> : null}
      {children}
    </div>
  );
}

// ─── Deep dives (footer expanders) ──────────────────────────────────────────

function FeedbackSliceList({ label, slices }: { label: string; slices: FeedbackSliceStat[] }) {
  return (
    <div className="fa-feedback-group">
      <h3 className="fa-feedback-group__label">{label}</h3>
      <ul className="fa-feedback-list">
        {slices.map((slice) => {
          const pct = Math.round(slice.approval * 100);
          return (
            <li key={slice.key} className="fa-feedback-row">
              <span className="fa-feedback-row__name" title={slice.key}>{slice.key}</span>
              <span className="fa-feedback-row__bar" aria-hidden>
                <i style={{ width: `${pct}%` }} />
              </span>
              <span className="fa-feedback-row__counts" aria-hidden>
                <span className="fa-feedback-row__up">
                  <Icon name="ph:thumbs-up" width={11} aria-hidden />
                  {slice.up}
                </span>
                <span className="fa-feedback-row__down">
                  <Icon name="ph:thumbs-down" width={11} aria-hidden />
                  {slice.down}
                </span>
              </span>
              <span className="sr-only">
                {`${slice.key}: ${slice.up} up, ${slice.down} down — ${pct}% positive`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ModelFeedbackSection({ rollup }: { rollup: MessageFeedbackRollup }) {
  if (rollup.total === 0) {
    return (
      <EmptyState
        compact
        icon="ph:thumbs-up"
        headline="No votes yet."
        subtitle="Thumbs a reply in chat to grade its model and runtime here."
      />
    );
  }
  return (
    <div className="fa-feedback">
      {rollup.models.length > 0 ? (
        <FeedbackSliceList label="Models" slices={rollup.models} />
      ) : null}
      {rollup.runtimes.length > 0 ? (
        <FeedbackSliceList label="Runtimes" slices={rollup.runtimes} />
      ) : null}
      {rollup.models.length === 0 && rollup.runtimes.length === 0 ? (
        <p className="fa-feedback__unstamped">
          {rollup.up} up · {rollup.down} down — older votes carry no model stamp; new votes bucket automatically.
        </p>
      ) : null}
    </div>
  );
}

// ─── Full-stage overlays ────────────────────────────────────────────────────

/**
 * An overlay that covers the stage but not the dock — the familiar's identity
 * stays on screen while you read its evidence. Focus is trapped and returned;
 * Esc closes.
 */
function StageOverlay({
  label,
  onClose,
  head,
  children,
}: {
  label: string;
  onClose: () => void;
  head: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, ref, { onEscape: onClose });
  return (
    <div ref={ref} className="fa-overlay" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      <div className="fa-overlay__head">
        {head}
        <button type="button" className="fa-ghost-btn focus-ring" onClick={onClose}>
          <Icon name="ph:x" width={12} aria-hidden />
          Close · Esc
        </button>
      </div>
      <div className="fa-overlay__body">{children}</div>
    </div>
  );
}

// ─── Action confirmation ────────────────────────────────────────────────────

/** A short verb chip for the heal card, mirrored from the request's actionKind. */
const HEAL_ACTION_LABEL: Record<SelfHealRequest["actionKind"], string> = {
  "fix-contract": "Fix contract",
  "write-memory": "Capture memory",
  "request-skill": "Request skill",
  manual: "Review",
};

type ActionKind = SelfHealRequest["actionKind"];

type ActionModalData = {
  kind: ActionKind;
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  blurb: string;
  bullets: string[];
  primary: string;
  /** The prompt a confirmed action sends into a fresh working thread. */
  prompt: string;
  /** The request behind the sheet, so the sheet can trace it too. */
  request: SelfHealRequest;
};

const ACTION_ICON: Record<ActionKind, Parameters<typeof Icon>[0]["name"]> = {
  "fix-contract": "ph:file-text",
  "write-memory": "ph:brain",
  "request-skill": "ph:sparkle",
  manual: "ph:wrench",
};

function buildActionModal(request: SelfHealRequest): ActionModalData {
  const kind = request.actionKind;
  const base = {
    kind,
    request,
    icon: ACTION_ICON[kind],
    title: request.suggestedAction || HEAL_ACTION_LABEL[kind],
    prompt: `${request.suggestedAction || HEAL_ACTION_LABEL[kind]}: ${request.title}\n\n${request.detail}`,
  };
  switch (kind) {
    case "fix-contract":
      return {
        ...base,
        blurb: "Open a working thread primed to repair this familiar's identity contract so it passes review.",
        bullets: [
          "Scaffold the missing ward.toml / SOUL.md sections",
          "Re-run the compliance check on save",
        ],
        primary: "Open a fix thread",
      };
    case "write-memory":
      return {
        ...base,
        blurb: "Give this familiar durable context so it stops losing ground between threads.",
        bullets: [
          "Snapshot the active thread's decisions into the grimoire",
          "Recall it in every new thread's context window",
        ],
        primary: "Capture memory",
      };
    case "request-skill":
      return {
        ...base,
        blurb: "Locate or install the skill this familiar reported it was missing.",
        bullets: [
          "Search the marketplace for an equivalent skill",
          "Wire it into this familiar's toolset",
        ],
        primary: "Find the skill",
      };
    default:
      return {
        ...base,
        blurb: "Open a working thread with this familiar, primed to resolve the request.",
        bullets: [
          "The thread opens pre-filled with the request details",
          "Resolve it inline and report back",
        ],
        primary: "Open a thread",
      };
  }
}

/**
 * Request detail — what the request is, why it matters, and what the fix thread
 * will actually do, before it launches a primed working thread with the
 * familiar (the cave's real self-heal path, shared with the review queue).
 */
function ActionModal({
  data,
  onConfirm,
  onTrace,
  onClose,
}: {
  data: ActionModalData;
  onConfirm: () => void;
  onTrace: (request: SelfHealRequest) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["Self-heal", data.title]}
      footerActions={
        <>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:tree-structure"
            onClick={() => onTrace(data.request)}
          >
            Trace thread
          </Button>
          <Button variant="primary" size="sm" leadingIcon="ph:check-bold" onClick={onConfirm}>
            {data.primary}
          </Button>
        </>
      }
    >
      <div className={`fa-modal-action fa-modal-action--${data.request.severity}`}>
        <span className={`fa-modal-action__icon fa-modal-action__icon--${data.kind}`} aria-hidden>
          <Icon name={data.icon} width={22} />
        </span>
        <span className="fa-modal-action__ident">
          <span className="fa-modal-action__source">{data.request.source}</span>
          <b>{data.request.title}</b>
        </span>
      </div>
      <div className="fa-modal-facts">
        <span>
          <span className="fa-modal-facts__label">Severity</span>
          <b className={`fa-modal-facts__value fa-modal-facts__value--${data.request.severity}`}>
            {data.request.severity === "crit" ? "Critical" : data.request.severity === "warn" ? "Warning" : "Info"}
          </b>
        </span>
        <span>
          <span className="fa-modal-facts__label">Source</span>
          <b className="fa-modal-facts__value">{data.request.source}</b>
        </span>
        <span>
          <span className="fa-modal-facts__label">Raised</span>
          <b className="fa-modal-facts__value">
            <RelativeTime iso={data.request.createdAt} />
          </b>
        </span>
      </div>
      <p className="fa-modal-detail">{data.request.detail}</p>
      <div className="fa-modal-insight">
        <Icon name="ph:lightbulb" width={15} aria-hidden />
        <span>
          <span className="fa-modal-insight__label">Why it matters</span>
          <span>{data.blurb}</span>
        </span>
      </div>
      <ul className="fa-action-bullets">
        <li className="fa-action-bullets__label">What the fix thread does</li>
        {data.bullets.map((bullet, index) => (
          <li key={bullet}>
            <span className="fa-action-bullets__n" aria-hidden>{index + 1}</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ─── Self-heal board ────────────────────────────────────────────────────────

type BoardGroupBy = "sev" | "source" | "kind";
type BoardSortBy = "severity" | "newest" | "az";

const BOARD_GROUPS: { id: BoardGroupBy; label: string; title: string }[] = [
  { id: "sev", label: "Severity", title: "Group by severity" },
  { id: "source", label: "Source", title: "Group by reporting source" },
  { id: "kind", label: "Action", title: "Group by the action it needs" },
];

const BOARD_SORTS: { id: BoardSortBy; label: string; title: string }[] = [
  { id: "severity", label: "Severity", title: "Most severe first" },
  { id: "newest", label: "Newest", title: "Most recently raised first" },
  { id: "az", label: "A–Z", title: "Alphabetical by title" },
];

const SEV_RANK: Record<SelfHealRequest["severity"], number> = { crit: 0, warn: 1, info: 2 };

const SEV_META: Record<SelfHealRequest["severity"], { label: string; note: string; icon: Parameters<typeof Icon>[0]["name"] }> = {
  crit: { label: "Critical", note: "blocks the contract or the work", icon: "ph:warning-circle" },
  warn: { label: "Warning", note: "worth a short review", icon: "ph:warning" },
  info: { label: "Informational", note: "background improvement", icon: "ph:info" },
};

/**
 * The full self-heal board — every open request, no cap, regroupable and
 * re-sortable. This is where the strip's horizontal track stops being enough:
 * the same cards, laid out so a reader can ask "what is critical" or "what did
 * the contract check raise" and get a whole answer.
 */
function HealBoardModal({
  requests,
  onAction,
  onTrace,
  onClose,
}: {
  requests: SelfHealRequest[];
  onAction: (request: SelfHealRequest) => void;
  onTrace: (request: SelfHealRequest) => void;
  onClose: () => void;
}) {
  const [groupBy, setGroupBy] = useState<BoardGroupBy>("sev");
  const [sortBy, setSortBy] = useState<BoardSortBy>("severity");
  const [severityFilter, setSeverityFilter] = useState<"all" | SelfHealRequest["severity"]>("all");

  const groups = useMemo(() => {
    let rows = severityFilter === "all"
      ? [...requests]
      : requests.filter((request) => request.severity === severityFilter);
    rows = rows.sort((a, b) => {
      if (sortBy === "az") return a.title.localeCompare(b.title);
      if (sortBy === "newest") return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
      return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    });
    const keyOf = (request: SelfHealRequest): string =>
      groupBy === "sev" ? request.severity : groupBy === "source" ? request.source : request.actionKind;
    const buckets = new Map<string, SelfHealRequest[]>();
    for (const request of rows) {
      const key = keyOf(request);
      const list = buckets.get(key);
      if (list) list.push(request);
      else buckets.set(key, [request]);
    }
    return [...buckets.entries()]
      .map(([key, rowsInGroup]) => {
        const meta = groupBy === "sev" ? SEV_META[key as SelfHealRequest["severity"]] : null;
        // A non-severity group takes the tone of its worst member, so grouping
        // by source or action still reads severity at a glance.
        const worst = rowsInGroup.reduce<number>(
          (acc, request) => Math.min(acc, SEV_RANK[request.severity]),
          2,
        );
        const tone = (["crit", "warn", "info"] as const)[worst] ?? "info";
        return {
          key,
          tone: groupBy === "sev" ? (key as SelfHealRequest["severity"]) : tone,
          label: meta ? meta.label : groupBy === "kind" ? HEAL_ACTION_LABEL[key as ActionKind] : key,
          note: meta ? meta.note : `${rowsInGroup.length} request${rowsInGroup.length === 1 ? "" : "s"}`,
          icon: meta ? meta.icon : groupBy === "source" ? "ph:waveform-bold" : ACTION_ICON[key as ActionKind],
          rows: rowsInGroup,
        };
      })
      .sort((a, b) =>
        groupBy === "sev"
          ? SEV_RANK[a.tone as SelfHealRequest["severity"]] - SEV_RANK[b.tone as SelfHealRequest["severity"]]
          : a.label.localeCompare(b.label),
      );
  }, [groupBy, requests, severityFilter, sortBy]);

  const shown = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <Modal open wide onClose={onClose} breadcrumb={["Self-heal", "Board"]}>
      <div className="fa-board-tools">
        <span className="fa-board-tools__count">
          <b>{shown}</b>
          <span>/ {requests.length}</span>
        </span>
        <span className="fa-ledger-tools__label">Group</span>
        <div className="fa-segmented" role="group" aria-label="Group requests by">
          {BOARD_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`fa-segmented__btn${groupBy === group.id ? " is-active" : ""} focus-ring`}
              aria-pressed={groupBy === group.id}
              title={group.title}
              onClick={() => setGroupBy(group.id)}
            >
              {group.label}
            </button>
          ))}
        </div>
        <span className="fa-ledger-tools__label">Sort</span>
        <div className="fa-segmented" role="group" aria-label="Sort requests by">
          {BOARD_SORTS.map((sort) => (
            <button
              key={sort.id}
              type="button"
              className={`fa-segmented__btn${sortBy === sort.id ? " is-active" : ""} focus-ring`}
              aria-pressed={sortBy === sort.id}
              title={sort.title}
              onClick={() => setSortBy(sort.id)}
            >
              {sort.label}
            </button>
          ))}
        </div>
      </div>
      <div className="fa-board-filters">
        {(["all", "crit", "warn", "info"] as const).map((filter) => {
          const n = filter === "all"
            ? requests.length
            : requests.filter((request) => request.severity === filter).length;
          return (
            <button
              key={filter}
              type="button"
              className={`fa-chip${severityFilter === filter ? " is-active" : ""} focus-ring`}
              aria-pressed={severityFilter === filter}
              onClick={() => setSeverityFilter(filter)}
            >
              {filter === "all" ? "All" : SEV_META[filter].label}
              <b className="fa-chip__n">{n}</b>
            </button>
          );
        })}
      </div>
      <div className="fa-board">
        {groups.map((group) => (
          <div key={group.key} className="fa-board__group">
            <div className={`fa-board__group-head fa-board__group-head--${group.tone}`}>
              <Icon name={group.icon} width={13} aria-hidden />
              <b>{group.label}</b>
              <span>{group.note}</span>
              <b className="fa-board__group-n">{group.rows.length}</b>
            </div>
            <div className="fa-board__grid">
              {group.rows.map((request) => (
                <article key={request.id} className={`fa-heal-card fa-heal-card--${request.severity}`}>
                  <span className="fa-heal-card__wash" aria-hidden />
                  <button
                    type="button"
                    className="fa-heal-card__open focus-ring"
                    onClick={() => onAction(request)}
                    title="Open request details"
                  >
                    <span className="fa-heal-card__crest" aria-hidden>
                      <Icon name={ACTION_ICON[request.actionKind]} width={12} />
                    </span>
                    <span className="fa-heal-card__ident">
                      <b className="fa-heal-card__title">{request.title}</b>
                      <span className="fa-heal-card__source">{request.source}</span>
                    </span>
                  </button>
                  <p className="fa-heal-card__detail">{request.detail}</p>
                  <div className="fa-heal-card__foot">
                    <button
                      type="button"
                      className="fa-heal-card__btn focus-ring"
                      onClick={() => onAction(request)}
                    >
                      {request.suggestedAction || HEAL_ACTION_LABEL[request.actionKind]}
                    </button>
                    <button
                      type="button"
                      className="fa-heal-card__trace focus-ring"
                      title="Trace the thread behind this request"
                      aria-label={`Trace ${request.title}`}
                      onClick={() => onTrace(request)}
                    >
                      <Icon name="ph:tree-structure" width={11} aria-hidden />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── Contract ───────────────────────────────────────────────────────────────

/** Which violation `field`s each contract property depends on — mirrors the
 *  per-property coverage logic in familiar-contract.ts so a failing property's
 *  detail panel can quote the exact violations behind it. */
const PROPERTY_FIELDS: Record<FamiliarProperty, string[]> = {
  "Named Identity": ["file", "content", "name", "creature"],
  "Defined Purpose": ["file", "content", "purpose", "core_work", "what_i_am_not"],
  "Bounded Authority": [
    "file",
    "content",
    "boundaries",
    "[protected]",
    "protected.files",
    "[editable]",
    "editable.paths",
    "[approval_tiers]",
    "approval_tiers.auto",
    "approval_tiers.human_review",
  ],
  "Persistent Memory": ["file"],
  "Human Belonging": ["file", "content", "[meta]", "meta.person", "protected.invariants"],
};

/** Plain-language "why it passes" copy per property (there are no positive
 *  reasons in the report — coverage is binary — so the satisfied case reads
 *  from a curated legend, and the failing case quotes real violations). */
const PROPERTY_MET: Record<FamiliarProperty, string> = {
  "Named Identity": "A named familiar is declared with a stable identity across threads.",
  "Defined Purpose": "Purpose and scope are declared, so work stays inside its lane.",
  "Bounded Authority": "Boundaries and approval tiers are declared — authority is scoped.",
  "Persistent Memory": "A durable memory store is attached, so context carries between sessions.",
  "Human Belonging": "An accountable person owns this familiar's work.",
};

/** Build the detail-panel copy for a contract property: the curated "why it
 *  passes" legend when satisfied, else the real violation messages behind it. */
function contractPropertyDetail(
  property: FamiliarProperty,
  pass: boolean,
  report: ContractReport,
): ContractPropertyDetail {
  if (pass) return { property, pass, body: [PROPERTY_MET[property]] };
  const fields = PROPERTY_FIELDS[property];
  const messages = [...report.violations, ...report.warnings]
    .filter((entry) => fields.includes(entry.field))
    .map((entry) => entry.message);
  return {
    property,
    pass,
    body: messages.length > 0 ? messages : ["This property is failing its contract check."],
  };
}

/**
 * The contract, expanded: the five properties on the left, the selected one's
 * evidence on the right. Anchored to the dock so the reader keeps the column
 * it was launched from, and Esc collapses it back.
 */
function ContractPanel({
  report,
  activeProperty,
  onPickProperty,
  onReview,
  onClose,
  criticalCount,
}: {
  report: ContractReport;
  activeProperty: FamiliarProperty | null;
  onPickProperty: (property: FamiliarProperty) => void;
  onReview: () => void;
  onClose: () => void;
  criticalCount: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, ref, { onEscape: onClose });
  const passCount = report.properties.filter((property) => property.pass).length;
  const active = activeProperty
    ? report.properties.find((property) => property.property === activeProperty) ?? null
    : null;
  const detail = active ? contractPropertyDetail(active.property, active.pass, report) : null;
  return (
    <div
      ref={ref}
      className="fa-contract-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Contract compliance detail"
      tabIndex={-1}
    >
      <div className="fa-contract-panel__head">
        <span className="fa-band-crest fa-band-crest--warn" aria-hidden>
          <Icon name="ph:file-text" width={14} />
        </span>
        <b>Contract compliance</b>
        <span className={`fa-band-count${report.pass ? "" : " is-warn"}`}>
          {passCount}/{report.properties.length} · {report.pass ? "passing" : "needs review"}
        </span>
        <span className="fa-band-hint">the five properties every familiar must declare</span>
        <button type="button" className="fa-ghost-btn focus-ring" onClick={onClose} title="Collapse · Esc">
          <Icon name="ph:arrows-in-simple" width={12} aria-hidden />
          Collapse
        </button>
      </div>
      <div className="fa-contract-panel__body">
        <div className="fa-contract-panel__list">
          <ul>
            {report.properties.map((property) => (
              <li key={property.property}>
                <button
                  type="button"
                  className={`fa-contract-item${property.pass ? " is-pass" : " is-fail"}${activeProperty === property.property ? " is-active" : ""} focus-ring`}
                  aria-expanded={activeProperty === property.property}
                  onClick={() => onPickProperty(property.property)}
                >
                  <Icon
                    name={property.pass ? "ph:check-circle-bold" : "ph:warning-circle"}
                    width={14}
                    aria-hidden
                  />
                  <span className="fa-contract-item__name">{property.property}</span>
                  <span className="fa-contract-item__verdict">{property.pass ? "PASS" : "FAIL"}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="fa-contract-panel__note">
            A failing contract means this familiar is operating as an agent, not a familiar.
          </p>
        </div>
        <div className="fa-contract-panel__detail">
          {detail ? (
            <>
              <div className={`fa-contract-detail__head fa-contract-detail__head--lg${detail.pass ? " is-pass" : " is-fail"}`}>
                <Icon
                  name={detail.pass ? "ph:check-circle-bold" : "ph:warning-circle"}
                  width={16}
                  aria-hidden
                />
                <b>{detail.property}</b>
                <span className="fa-contract-detail__status">{detail.pass ? "SATISFIED" : "FAILING"}</span>
              </div>
              <div className={`fa-contract-detail${detail.pass ? " is-pass" : " is-fail"}`}>
                <span className="fa-contract-detail__label">
                  {detail.pass ? "Why it passes" : "What's missing"}
                </span>
                {detail.body.map((line) => (
                  <p key={line} className="fa-contract-detail__body">{line}</p>
                ))}
              </div>
              <div className="fa-modal-facts">
                <span>
                  <span className="fa-modal-facts__label">Declared in</span>
                  <b className="fa-modal-facts__value">ward.toml · SOUL.md</b>
                </span>
                <span>
                  <span className="fa-modal-facts__label">Open requests</span>
                  <b className="fa-modal-facts__value fa-modal-facts__value--crit">
                    {criticalCount} critical
                  </b>
                </span>
              </div>
            </>
          ) : (
            <EmptyState
              compact
              icon="ph:file-text"
              headline="Select a property."
              subtitle="Each one shows the evidence behind its verdict."
            />
          )}
          {!report.pass ? (
            <button type="button" className="fa-primary-btn fa-primary-btn--lg focus-ring" onClick={onReview}>
              <Icon name="ph:sparkle-bold" width={13} aria-hidden />
              Review and resolve
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Trust ──────────────────────────────────────────────────────────────────

const TRUST_BANDS: { key: "low" | "developing" | "reliable" | "trusted"; label: string; range: string }[] = [
  { key: "low", label: "Low", range: "< 40" },
  { key: "developing", label: "Developing", range: "40–59" },
  { key: "reliable", label: "Reliable", range: "60–79" },
  { key: "trusted", label: "Trusted", range: "80+" },
];

/** How the headline trust score is computed — the weighted metric breakdown,
 *  the band ladder, and where this familiar currently sits on it. */
function TrustModal({
  confidence,
  trends,
  onClose,
}: {
  confidence: ThreadConfidence;
  trends: SignalTrends;
  onClose: () => void;
}) {
  const current = confidence.hasData ? confidenceTier(confidence.label) : null;
  const trendByKey = new Map(trends.metrics.map((metric) => [metric.key, metric]));
  return (
    <Modal open onClose={onClose} breadcrumb={["Trust", `How ${confidence.hasData ? confidence.score : "this"} is computed`]}>
      {confidence.hasData ? (
        <>
          <div className="fa-trust-modal">
            <TrustRing confidence={confidence} size="lg" />
            <div className="fa-trust-modal__rows">
              {confidence.metrics.map((metric) => {
                const trend = trendByKey.get(metric.key);
                return (
                  <div key={metric.key} className="fa-trust-row">
                    <span className="fa-trust-row__label">{metric.label}</span>
                    <span className="fa-trust-row__bar" aria-hidden>
                      <i style={{ width: `${Math.max(0, Math.min(100, metric.value))}%` }} />
                    </span>
                    <span className="fa-trust-row__value">
                      {metric.value} × {metric.weight.toFixed(2)}
                    </span>
                    {trend ? <TrendDeltaChip label={metric.label} trend={trend} /> : null}
                  </div>
                );
              })}
              <p className="fa-trust-modal__formula">
                Headline = Σ metric × weight, averaged across {confidence.reportCount} thread self-report
                {confidence.reportCount === 1 ? "" : "s"}.
              </p>
            </div>
          </div>
          <div className="fa-trust-bands">
            {TRUST_BANDS.map((band) => (
              <span
                key={band.key}
                className={`fa-trust-band${current === band.key ? " is-current" : ""}`}
              >
                <b>{band.label}</b>
                <span>{band.range}{current === band.key ? " · current" : ""}</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          compact
          icon="ph:chart-bar-bold"
          headline="Trust isn't measured yet."
          subtitle="It is computed from thread self-reports — this familiar hasn't filed any."
        />
      )}
    </Modal>
  );
}

// ─── Needs-attention actions ────────────────────────────────────────────────

const ACTION_SEV_RANK: Record<SelfHealRequest["severity"], number> = { crit: 0, warn: 1, info: 2 };

/**
 * Prioritized "do this next" list, derived from the same real heal requests
 * the strip shows (severity-first). Each action re-opens the request's action
 * modal, so the dock and the strip stay one behavior.
 */
function deriveNextActions(healRequests: SelfHealRequest[]): DockAction[] {
  return [...healRequests]
    .sort((a, b) => ACTION_SEV_RANK[a.severity] - ACTION_SEV_RANK[b.severity])
    .slice(0, 4)
    .map((request) => ({
      key: request.id,
      label: request.suggestedAction || HEAL_ACTION_LABEL[request.actionKind],
      why: request.detail,
      sev: request.severity,
      request,
    }));
}

// ─── The workbench ──────────────────────────────────────────────────────────

type DeepDive = "signals" | "model" | null;
type Overlay = "signals" | "model" | null;

/**
 * Familiar analytics, as a workbench rather than a scroll.
 *
 * The left dock is the claim — who this familiar is, its renown, its trust
 * score, what needs attention, and whether its contract holds. The stage to its
 * right is the evidence: a lens + window that scope everything below them, the
 * headline stats, the open self-heal queue, and the two panels that flip
 * between a summary and the raw ledger behind it. Deep dives (thread signals,
 * model performance) open over the stage so the dock — the identity you are
 * reading about — never leaves the screen.
 */
export function FamiliarAnalyticsContent({
  model,
  onRefresh,
  refreshing = false,
  updatedAt = null,
}: {
  model: FamiliarAnalyticsModel;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Truthful last-load stamp for the dock's freshness readout. */
  updatedAt?: string | null;
}) {
  const familiarName = model.familiar?.display_name ?? model.familiarId;
  const { announce } = useAnnouncer();

  // ── Scope ────────────────────────────────────────────────────────────────
  const [lens, setLens] = useState<LensId>(DEFAULT_LENS);
  const [windowId, setWindowId] = useState<WindowId>(DEFAULT_WINDOW);
  // One clock per render pass, so every window filter agrees with itself.
  const now = useMemo(() => Date.now(), [windowId, model]);

  // ── Panels + overlays ────────────────────────────────────────────────────
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [confidenceFlipped, setConfidenceFlipped] = useState(false);
  const [sessionsFlipped, setSessionsFlipped] = useState(false);
  const [pulseOpen, setPulseOpen] = useState(false);
  const [deepDive, setDeepDive] = useState<DeepDive>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [trustOpen, setTrustOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [activeProperty, setActiveProperty] = useState<FamiliarProperty | null>(null);
  const [selectedDay, setSelectedDay] = useState<PulseDay | null>(null);
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalData | null>(null);
  // cave-fy1q phase 3: surface the first-run funnel while this install has
  // both stamps. Sampled after mount — localStorage isn't SSR-safe.
  const [timeToFirstReply, setTimeToFirstReply] = useState<string | null>(null);
  useEffect(() => {
    const ms = timeToFirstReplyMs();
    setTimeToFirstReply(ms === null ? null : formatTimeToFirstReply(ms));
  }, []);

  // The tablet band folds the dock through real state, because the rail is a
  // different tree — CSS alone can't hide a branch that isn't rendered. It is a
  // BAND, not a ceiling: below 900px the frame stacks into a page and the rail
  // has nothing to save, so the full dock comes back rather than stretching a
  // column of icon buttons across the width.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 901px) and (max-width: 1180px)");
    const apply = () => setDockCollapsed(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────
  const threadSignalsAggregate = useMemo(
    () => model.threadReports.length > 0 ? aggregateThreadSignals(model.threadReports) : null,
    [model.threadReports],
  );
  const allHealRequests = useMemo(() => {
    if (!threadSignalsAggregate) return model.healRequests;
    const escalated = escalateBlockers(model.familiarId, threadSignalsAggregate, model.healRequests);
    return [...escalated, ...model.healRequests];
  }, [model.familiarId, model.healRequests, threadSignalsAggregate]);
  const healRequests = useMemo(
    () => allHealRequests.filter((request) => matchesLens(request, lens)),
    [allHealRequests, lens],
  );
  const nextActions = useMemo(() => deriveNextActions(healRequests), [healRequests]);

  const windowSessions = useMemo(
    () => model.recentSessions.filter((session) => withinWindow(session.updated_at, windowId, now)),
    [model.recentSessions, now, windowId],
  );
  const windowReports = useMemo(
    () => model.threadReports.filter((report) => withinWindow(report.reportedAt, windowId, now)),
    [model.threadReports, now, windowId],
  );
  const reviewQueue = useMemo(
    () => threadSignalsAggregate ? buildThreadSignalReviewQueue(threadSignalsAggregate) : [],
    [threadSignalsAggregate],
  );
  const contractDetail = useMemo(() => {
    const report = model.contractReport;
    if (!report || !activeProperty) return null;
    const property = report.properties.find((entry) => entry.property === activeProperty);
    if (!property) return null;
    return contractPropertyDetail(property.property, property.pass, report);
  }, [activeProperty, model.contractReport]);
  const criticalCount = allHealRequests.filter((request) => request.severity === "crit").length;

  // ── Actions ──────────────────────────────────────────────────────────────
  const openAction = useCallback((request: SelfHealRequest) => {
    setActionModal(buildActionModal(request));
  }, []);
  const traceRequest = useCallback((request: SelfHealRequest) => {
    setTraceTarget({ id: request.id, title: request.title });
    setActionModal(null);
  }, []);
  // Confirming an action launches a primed working thread with the familiar —
  // the cave's real self-heal path (shared with the thread-signals queue).
  const confirmAction = useCallback(() => {
    if (!actionModal) return;
    requestAgentsNewChat({
      familiarId: model.familiarId,
      initialPrompt: `${actionModal.prompt}\n\nAnalytics source: /dashboard/familiars/${encodeURIComponent(model.familiarId)}/analytics`,
      origin: "chat" as const,
    });
    announce(`Opening a thread to ${actionModal.title.toLowerCase()}.`);
    setActionModal(null);
    setBoardOpen(false);
  }, [actionModal, announce, model.familiarId]);

  // Contract review: direct-launch a thread seeded with the rehabilitation
  // brief — the same "Rite of Binding" flow as the Studio Contract tab.
  const reviewContract = useCallback(() => {
    if (!model.contractReport) return;
    requestAgentsNewChat({
      familiarId: model.familiarId,
      initialPrompt: `${buildRehabilitationBrief(familiarName, model.contractReport)}\n\nAnalytics source: /dashboard/familiars/${encodeURIComponent(model.familiarId)}/analytics`,
      origin: "chat" as const,
    });
    announce(`Opening a review thread to repair ${familiarName}'s contract.`);
  }, [announce, familiarName, model.contractReport, model.familiarId]);

  const handleSelectDay = useCallback((day: PulseDay) => {
    setSelectedDay((prev) => (prev?.key === day.key ? null : day));
    setSessionsFlipped(false);
  }, []);

  const resetScope = useCallback(() => {
    setLens(DEFAULT_LENS);
    setWindowId(DEFAULT_WINDOW);
  }, []);

  const pickProperty = useCallback((property: FamiliarProperty) => {
    setActiveProperty((prev) => (prev === property ? null : property));
  }, []);

  // A full-stage overlay is the top layer: it retires the anchored contract
  // panel and the pulse first, so two focus traps can never be live at once.
  const openOverlay = useCallback((next: Exclude<Overlay, null>) => {
    setContractOpen(false);
    setPulseOpen(false);
    setDeepDive(null);
    setOverlay(next);
  }, []);

  // Esc unwinds the stack one layer at a time: the innermost open thing first.
  // Modal/StageOverlay own their own Esc; this covers the lighter panels.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deepDive) setDeepDive(null);
      else if (pulseOpen) setPulseOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deepDive, pulseOpen]);

  const windowTitle = ANALYTICS_WINDOWS.find((entry) => entry.id === windowId)?.title ?? "";
  const errors = model.errors;

  return (
    <div className="fa-frame">
      <FamiliarAnalyticsDock
        model={model}
        healRequestCount={allHealRequests.length}
        actions={nextActions}
        contractReport={model.contractReport}
        activeProperty={activeProperty}
        contractDetail={contractDetail}
        onPickProperty={pickProperty}
        collapsed={dockCollapsed}
        onToggleCollapsed={() => setDockCollapsed((prev) => !prev)}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onOpenTrust={() => setTrustOpen(true)}
        onOpenSignals={() => openOverlay("signals")}
        onOpenModel={() => openOverlay("model")}
        onAction={openAction}
        onReviewContract={reviewContract}
        onExpandContract={() => { setPulseOpen(false); setContractOpen((prev) => !prev); }}
        contractExpanded={contractOpen}
      />

      <div className="fa-stage">
        <ScopeBar
          lens={lens}
          window={windowId}
          onLens={setLens}
          onWindow={setWindowId}
          onReset={resetScope}
          healRequests={allHealRequests}
          sessionCount={windowSessions.length}
          reportCount={windowReports.length}
        />

        <StatBand
          model={model}
          sessions={windowSessions}
          healRequests={healRequests}
          reportCount={windowReports.length}
          queueCount={reviewQueue.length}
          pulseOpen={pulseOpen}
          onTogglePulse={() => setPulseOpen((prev) => !prev)}
          onOpenSignals={() => openOverlay("signals")}
          onSelectDay={handleSelectDay}
          selectedDayKey={selectedDay?.key ?? null}
        />

        <SelfHealStrip
          requests={healRequests}
          totalRequests={allHealRequests.length}
          onInspect={openAction}
          onTrace={traceRequest}
          onViewAll={() => setBoardOpen(true)}
        />

        <div className="fa-stage-grid">
          <FlipPanel
            id="fa-confidence"
            flipped={confidenceFlipped}
            front={
              <>
                <PanelHead
                  icon="ph:chart-line-up"
                  title="Confidence from thread analysis"
                  count={
                    model.confidence.hasData
                      ? `${model.confidence.reportCount} report${model.confidence.reportCount === 1 ? "" : "s"}`
                      : "no reports"
                  }
                >
                  <button
                    type="button"
                    className="fa-ghost-btn focus-ring"
                    onClick={() => setConfidenceFlipped(true)}
                    title="Flip to every report"
                  >
                    Ledger
                    <Icon name="ph:table" width={11} aria-hidden />
                  </button>
                </PanelHead>
                <div className="fa-panel__body">
                  <ThreadAnalysisBody
                    confidence={model.confidence}
                    trends={model.signalTrends}
                    familiar={model.familiar}
                    onSelfReportEnabled={onRefresh}
                  />
                </div>
              </>
            }
            back={
              <>
                <PanelHead
                  icon="ph:table"
                  title="All thread reports"
                  count={`${windowReports.length} · ${windowTitle.toLowerCase()}`}
                >
                  <button
                    type="button"
                    className="fa-ghost-btn focus-ring"
                    onClick={() => setConfidenceFlipped(false)}
                    title="Back to the summary"
                  >
                    <Icon name="ph:arrow-u-up-left" width={11} aria-hidden />
                    Summary
                  </button>
                </PanelHead>
                <div className="fa-panel__body">
                  <ReportLedger reports={windowReports} />
                </div>
              </>
            }
          />

          <FlipPanel
            id="fa-sessions"
            flipped={sessionsFlipped}
            front={
              <>
                <PanelHead
                  icon="ph:terminal-window"
                  title="Recent sessions"
                  count={`${windowSessions.length} in window`}
                >
                  <button
                    type="button"
                    className="fa-ghost-btn focus-ring"
                    onClick={() => setSessionsFlipped(true)}
                    title="Flip to the full session log"
                  >
                    Log
                    <Icon name="ph:table" width={11} aria-hidden />
                  </button>
                </PanelHead>
                <div className="fa-panel__body">
                  <RecentSessionsBody
                    sessions={windowSessions}
                    selectedDay={selectedDay}
                    onClearDay={() => setSelectedDay(null)}
                    onTrace={setTraceTarget}
                  />
                </div>
              </>
            }
            back={
              <>
                <PanelHead
                  icon="ph:table"
                  title="Session log"
                  count={`${windowSessions.length} · ${windowTitle.toLowerCase()}`}
                >
                  <button
                    type="button"
                    className="fa-ghost-btn focus-ring"
                    onClick={() => setSessionsFlipped(false)}
                    title="Back to the recent list"
                  >
                    <Icon name="ph:arrow-u-up-left" width={11} aria-hidden />
                    Recent
                  </button>
                </PanelHead>
                <div className="fa-panel__body">
                  <SessionLog sessions={windowSessions} onTrace={setTraceTarget} />
                </div>
              </>
            }
          />
        </div>

        {errors.length > 0 && !errorDismissed ? (
          <div className="fa-error-band" role="alert">
            <Icon name="ph:warning-circle" width={15} aria-hidden />
            <span className="fa-error-band__body">
              <b>Analytics partially unavailable</b>
              <span>{errors.join(" · ")} — everything else is from the last good read.</span>
            </span>
            {onRefresh ? (
              <button type="button" className="fa-ghost-btn focus-ring" onClick={onRefresh} disabled={refreshing}>
                <Icon name="ph:arrows-clockwise-bold" width={12} aria-hidden />
                Retry
              </button>
            ) : null}
            <button
              type="button"
              className="fa-icon-btn fa-icon-btn--xs focus-ring"
              aria-label="Dismiss"
              onClick={() => setErrorDismissed(true)}
            >
              <Icon name="ph:x" width={12} aria-hidden />
            </button>
          </div>
        ) : null}

        <div className="fa-foot">
          <span className="fa-foot__legend">
            <span className="fa-scope__crest fa-scope__crest--plain" aria-hidden>
              <Icon name="ph:magnifying-glass" width={13} />
            </span>
            Deep dives
          </span>
          <button
            type="button"
            className={`fa-foot__btn${deepDive === "signals" ? " is-open" : ""} focus-ring`}
            aria-expanded={deepDive === "signals"}
            onClick={() => setDeepDive((prev) => (prev === "signals" ? null : "signals"))}
          >
            <Icon name="ph:waveform-bold" width={13} aria-hidden />
            <b>Thread signals</b>
            <span className="fa-band-count">
              {model.threadReports.length} · {reviewQueue.length} queued
            </span>
            <Icon name="ph:caret-up" className="fa-foot__caret" width={11} aria-hidden />
          </button>
          <button
            type="button"
            className={`fa-foot__btn${deepDive === "model" ? " is-open" : ""} focus-ring`}
            aria-expanded={deepDive === "model"}
            onClick={() => setDeepDive((prev) => (prev === "model" ? null : "model"))}
          >
            <Icon name="ph:thumbs-up" width={13} aria-hidden />
            <b>Model performance</b>
            <span className="fa-band-count">
              {model.modelFeedback.total} vote{model.modelFeedback.total === 1 ? "" : "s"}
            </span>
            <Icon name="ph:caret-up" className="fa-foot__caret" width={11} aria-hidden />
          </button>
          <span className="fa-foot__meta">
            {updatedAt ? <>Updated <RelativeTime iso={updatedAt} /></> : "Not loaded yet"}
            {timeToFirstReply ? <> · first reply {timeToFirstReply} after first open</> : null}
          </span>
        </div>

        {pulseOpen ? (
          <PulseOverlay
            pulse={model.sessionPulse}
            lastActive={model.growthReport?.lastActiveAt ?? model.recentSessions[0]?.updated_at ?? null}
            streakDays={model.progression?.streakDays ?? 0}
            onClose={() => setPulseOpen(false)}
            onSelectDay={handleSelectDay}
            selectedDayKey={selectedDay?.key ?? null}
          />
        ) : null}

        {deepDive === "signals" ? (
          <div className="fa-foot-panel">
            <div className="fa-foot-panel__head">
              <Icon name="ph:waveform-bold" width={14} aria-hidden />
              <b>Thread signals — summary</b>
              <span className="fa-band-count">
                {reviewQueue.length} queued · {model.threadReports.length} report
                {model.threadReports.length === 1 ? "" : "s"}
              </span>
              <button type="button" className="fa-primary-btn focus-ring" onClick={() => openOverlay("signals")}>
                Open full view
                <Icon name="ph:arrow-up-right" width={11} aria-hidden />
              </button>
              <button
                type="button"
                className="fa-icon-btn fa-icon-btn--xs focus-ring"
                aria-label="Collapse summary"
                onClick={() => setDeepDive(null)}
              >
                <Icon name="ph:caret-down" width={12} aria-hidden />
              </button>
            </div>
            {threadSignalsAggregate ? (
              <div className="fa-foot-panel__stats">
                <span className="fa-pulse-stat fa-pulse-stat--warn">
                  <b>{threadSignalsAggregate.persistentBlockers.length}</b>
                  <span>Persistent blockers</span>
                  <small>repeat walls to clear</small>
                </span>
                <span className="fa-pulse-stat fa-pulse-stat--bad">
                  <b>{threadSignalsAggregate.skillsNeedingAccess.length}</b>
                  <span>Skill access</span>
                  <small>install or map</small>
                </span>
                <span className="fa-pulse-stat fa-pulse-stat--good">
                  <b>{threadSignalsAggregate.skillsNeedingClarity.length}</b>
                  <span>Skill clarity</span>
                  <small>definitions to write</small>
                </span>
                <span className="fa-pulse-stat fa-pulse-stat--accent">
                  <b>{threadSignalsAggregate.capabilitiesLacking.length}</b>
                  <span>Capability gaps</span>
                  <small>missing tools</small>
                </span>
              </div>
            ) : (
              <p className="fa-panel__foot">No thread self-reports yet — nothing to summarize.</p>
            )}
          </div>
        ) : null}

        {deepDive === "model" ? (
          <div className="fa-foot-panel">
            <div className="fa-foot-panel__head">
              <Icon name="ph:thumbs-up" width={14} aria-hidden />
              <b>Model performance — summary</b>
              <span className="fa-band-hint">
                thumbs votes on chat replies, netted per message
              </span>
              <button type="button" className="fa-primary-btn focus-ring" onClick={() => openOverlay("model")}>
                Open full view
                <Icon name="ph:arrow-up-right" width={11} aria-hidden />
              </button>
              <button
                type="button"
                className="fa-icon-btn fa-icon-btn--xs focus-ring"
                aria-label="Collapse summary"
                onClick={() => setDeepDive(null)}
              >
                <Icon name="ph:caret-down" width={12} aria-hidden />
              </button>
            </div>
            <ModelFeedbackSection rollup={model.modelFeedback} />
          </div>
        ) : null}

        {overlay === "signals" ? (
          <StageOverlay
            label="Thread signals"
            onClose={() => setOverlay(null)}
            head={
              <>
                <h2 className="fa-overlay__title">Thread signals</h2>
                <span className="fa-band-count">
                  {model.threadReports.length} report{model.threadReports.length === 1 ? "" : "s"} ·{" "}
                  {reviewQueue.length} queued
                </span>
                <span className="fa-band-hint">covers the stage — the dock stays put</span>
              </>
            }
          >
            <ThreadSignalsSection familiarId={model.familiarId} reports={model.threadReports} />
          </StageOverlay>
        ) : null}

        {overlay === "model" ? (
          <StageOverlay
            label="Model performance"
            onClose={() => setOverlay(null)}
            head={
              <>
                <h2 className="fa-overlay__title">Model performance</h2>
                <span className="fa-band-count">
                  {model.modelFeedback.total} vote{model.modelFeedback.total === 1 ? "" : "s"}
                </span>
                <span className="fa-band-hint">
                  thumbs votes on chat replies, netted per message — last vote wins
                </span>
              </>
            }
          >
            <ModelFeedbackSection rollup={model.modelFeedback} />
          </StageOverlay>
        ) : null}

        {contractOpen && model.contractReport ? (
          <ContractPanel
            report={model.contractReport}
            activeProperty={activeProperty}
            onPickProperty={pickProperty}
            onReview={reviewContract}
            onClose={() => setContractOpen(false)}
            criticalCount={criticalCount}
          />
        ) : null}
      </div>

      {trustOpen ? (
        <TrustModal
          confidence={model.confidence}
          trends={model.signalTrends}
          onClose={() => setTrustOpen(false)}
        />
      ) : null}

      {boardOpen ? (
        <HealBoardModal
          requests={allHealRequests}
          onAction={openAction}
          onTrace={traceRequest}
          onClose={() => setBoardOpen(false)}
        />
      ) : null}

      {actionModal ? (
        <ActionModal
          data={actionModal}
          onConfirm={confirmAction}
          onTrace={traceRequest}
          onClose={() => setActionModal(null)}
        />
      ) : null}

      {traceTarget ? (
        <SessionTraceOverlay target={traceTarget} onClose={() => setTraceTarget(null)} />
      ) : null}
    </div>
  );
}
