"use client";

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FamiliarAnalyticsModel } from "@/components/familiar-analytics-data";
import type { FeedbackSliceStat, MessageFeedbackRollup } from "@/lib/message-feedback-rollup";
import { Button } from "@/components/ui/button";
import { AuthedImage } from "@/components/ui/authed-image";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { PulseBars } from "@/components/ui/pulse-bars";
import { RelativeTime } from "@/components/ui/relative-time";
import { Sparkline, type SparkPoint } from "@/components/ui/sparkline";
import { useAnnouncer } from "@/components/ui/live-region";
import { ThreadSignalsSection } from "@/components/thread-signals-section";
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
import { deriveAnalyticsInsight } from "@/lib/familiar-analytics-insight";
import { formatTimeToFirstReply, timeToFirstReplyMs } from "@/lib/first-run-stamps";
import { SessionTraceOverlay, type TraceTarget } from "@/components/session-trace-overlay";
import { pulseTotal, sessionDayKey, type PulseDay } from "@/lib/session-pulse";
import { requestAgentsNewChat } from "@/lib/agents-new-chat";
import {
  aggregateThreadSignals,
  type ContextPressure,
} from "@/lib/thread-self-report";

/** Section shell — shared head (title + count) wrapper used by every panel.
 *  The section carries its `id` so KPI tiles can deep-link straight to it. */
function FaSection({
  id,
  title,
  count,
  wide = false,
  children,
}: {
  id: string;
  title: string;
  count: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`fa-section${wide ? " fa-section--wide" : ""}`} aria-labelledby={`${id}-title`}>
      <div className="fa-section__head">
        <h2 id={`${id}-title`} className="fa-section__title">{title}</h2>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * Collapsible section shell — a full-width panel whose body folds behind a
 * button header (caret + count + a one-line hint when collapsed). Used for the
 * denser drill-down panels (model performance) so the page stays scannable and
 * the heavy content is opt-in. Its `id` still anchors KPI/hash drill-throughs.
 */
function FaCollapsibleSection({
  id,
  title,
  count,
  hint,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: ReactNode;
  /** Shown after the count when collapsed — a preview of what's inside. */
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section id={id} className="fa-section fa-section--wide fa-collapse" aria-labelledby={`${id}-title`}>
      <button
        type="button"
        className="fa-collapse__head focus-ring"
        aria-expanded={open}
        onClick={onToggle}
      >
        <h2 id={`${id}-title`} className="fa-section__title">{title}</h2>
        <span>{count}</span>
        {!open ? <span className="fa-collapse__hint">{hint}</span> : null}
        <Icon
          name="ph:caret-down"
          className={`fa-collapse__caret${open ? " is-open" : ""}`}
          width={14}
          aria-hidden
        />
      </button>
      {open ? <div className="fa-collapse__body">{children}</div> : null}
    </section>
  );
}

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
        <span className="fa-trend__meta">
          {windowPhrase} · {trends.snapshotCount} report{trends.snapshotCount === 1 ? "" : "s"}
        </span>
      </div>
      {dataBuckets.length >= 2 ? (
        <figure
          className="fa-trend__spark"
          role="img"
          aria-label={`Weighted thread score per ${trends.granularity} over the ${windowPhrase}: ${TREND_VERDICT_COPY[overall.direction].toLowerCase()}`}
        >
          <Sparkline points={points} color={trendTokenFor(overall.direction)} height={40} />
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
 * behind the headline score (replacing the retired synthetic factor weights),
 * plus the changes-over-time read. With no reports yet it teaches the fix:
 * enable response self-reporting.
 */
const ThreadAnalysisSection = memo(function ThreadAnalysisSection({
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
  return (
    <FaSection
      id="fa-confidence"
      title="Confidence from thread analysis"
      count={
        confidence.hasData
          ? `${confidence.reportCount} ${confidence.reportCount === 1 ? "report" : "reports"}`
          : "no reports"
      }
    >
      {confidence.hasData ? (
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
      ) : (
        <SelfReportEmptyState
          familiar={familiar}
          onSelfReportEnabled={onSelfReportEnabled}
          headline={THREAD_CONFIDENCE_EMPTY_STATE}
          enabledHeadline="No thread reports yet."
        />
      )}
    </FaSection>
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
const RecentSessionsSection = memo(function RecentSessionsSection({
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
        headline="No sessions yet."
        subtitle="Sessions appear here as this familiar runs."
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
              <li key={session.id} className="fa-session">
                <span className={`fa-session__dot fa-session__dot--${tone}`} aria-hidden />
                <span className="fa-session__main">
                  <a
                    className="fa-session__title focus-ring"
                    href={`/#chat-${encodeURIComponent(session.id)}`}
                    title="Open this thread in chat"
                  >
                    {session.title || session.id}
                  </a>
                  <small className="fa-session__meta">
                    {session.harness} · {session.status}
                    {session.diff ? (
                      <>
                        {" · "}
                        <span className="fa-session__diff">
                          +{session.diff.additions} −{session.diff.deletions}
                        </span>
                      </>
                    ) : null}
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
                  Trace
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

/** Severity → left-rail tone class for the heal cards + attention chips. */
const HEAL_SEV_CLASS: Record<SelfHealRequest["severity"], string> = {
  crit: "crit",
  warn: "warn",
  info: "info",
};

/** A short verb chip for the heal card, mirrored from the request's actionKind. */
const HEAL_ACTION_LABEL: Record<SelfHealRequest["actionKind"], string> = {
  "fix-contract": "Fix contract",
  "write-memory": "Capture memory",
  "request-skill": "Request skill",
  manual: "Review",
};

/**
 * Self-heal requests — the actionable "needs a human" queue. The first card is
 * featured (spans two columns) so the most pressing request reads first; each
 * card offers its suggested action (opens the action modal, which launches a
 * primed working thread) and a trace shortcut. A "view all" tile opens the
 * full list in a modal once the grid overflows.
 */
const SelfHealGrid = memo(function SelfHealGrid({
  requests,
  onAction,
  onTrace,
  onViewAll,
}: {
  requests: SelfHealRequest[];
  onAction: (request: SelfHealRequest) => void;
  onTrace: (request: SelfHealRequest) => void;
  onViewAll: () => void;
}) {
  if (requests.length === 0) {
    return (
      <EmptyState
        compact
        icon="ph:check-circle-bold"
        headline="No self-heal requests."
        subtitle="Nothing needs attention right now."
      />
    );
  }
  const shown = requests.slice(0, 6);
  const hasMore = requests.length > shown.length;
  return (
    <div className="fa-heal-grid">
      {shown.map((request, index) => (
        <article
          key={request.id}
          className={`fa-heal-card fa-heal-card--${HEAL_SEV_CLASS[request.severity]}${index === 0 ? " fa-heal-card--featured" : ""}`}
        >
          <div className="fa-heal-card__head">
            <span className="fa-heal-card__dot" aria-hidden />
            <span className="fa-heal-card__source">{request.source}</span>
            <span className="fa-heal-card__kind">{HEAL_ACTION_LABEL[request.actionKind]}</span>
          </div>
          <b className="fa-heal-card__title">{request.title}</b>
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
              <Icon name="ph:tree-structure" width={13} aria-hidden />
            </button>
          </div>
        </article>
      ))}
      {hasMore ? (
        <button type="button" className="fa-heal-more focus-ring" onClick={onViewAll}>
          <Icon name="ph:caret-right" width={20} aria-hidden />
          <span>View all {requests.length}</span>
        </button>
      ) : null}
    </div>
  );
});

/** The full self-heal list, shown in a modal — every open request, no cap. */
function HealAllModal({
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
  return (
    <Modal open onClose={onClose} breadcrumb={["Self-heal", "All requests"]}>
      <p className="fa-modal-lede">{requests.length} open · needs a human</p>
      <div className="fa-modal-heal-list">
        {requests.map((request) => (
          <article
            key={request.id}
            className={`fa-heal-card fa-heal-card--${HEAL_SEV_CLASS[request.severity]}`}
          >
            <div className="fa-heal-card__head">
              <span className="fa-heal-card__dot" aria-hidden />
              <span className="fa-heal-card__source">{request.source}</span>
              <span className="fa-heal-card__kind">{HEAL_ACTION_LABEL[request.actionKind]}</span>
            </div>
            <b className="fa-heal-card__title">{request.title}</b>
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
                <Icon name="ph:tree-structure" width={13} aria-hidden />
              </button>
            </div>
          </article>
        ))}
      </div>
    </Modal>
  );
}

// ─── Action confirmation modal ───────────────────────────────────────────────

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
 * Action confirmation — a lightweight sheet that explains what a heal action
 * does before it launches a primed working thread with the familiar (the
 * cave's real self-heal path, shared with the thread-signals review queue).
 */
function ActionModal({
  data,
  onConfirm,
  onClose,
}: {
  data: ActionModalData;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["Self-heal", data.title]}
      footerActions={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" leadingIcon="ph:check-bold" onClick={onConfirm}>
            {data.primary}
          </Button>
        </>
      }
    >
      <div className="fa-modal-action">
        <span className={`fa-modal-action__icon fa-modal-action__icon--${data.kind}`} aria-hidden>
          <Icon name={data.icon} width={22} />
        </span>
        <p className="fa-modal-action__blurb">{data.blurb}</p>
      </div>
      <ul className="fa-action-bullets">
        {data.bullets.map((bullet) => (
          <li key={bullet}>
            <Icon name="ph:check-circle-bold" width={16} aria-hidden />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

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

type ContractPropertyDetail = { property: FamiliarProperty; pass: boolean; body: string[] };

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

const ContractCompliance = memo(function ContractCompliance({ report }: { report: ContractReport | null }) {
  const [activeProperty, setActiveProperty] = useState<FamiliarProperty | null>(null);
  const passCount = report ? report.properties.filter((property) => property.pass).length : 0;
  const active = report && activeProperty
    ? report.properties.find((property) => property.property === activeProperty) ?? null
    : null;
  const detail = report && active ? contractPropertyDetail(active.property, active.pass, report) : null;
  return (
    <FaSection
      id="fa-contract"
      title="Contract compliance"
      wide
      count={report ? `${passCount}/${report.properties.length} · ${report.pass ? "passing" : "needs review"}` : "no report"}
    >
      {report ? (
        <>
          <div className="fa-contract-grid">
            {report.properties.map((property) => {
              const isActive = activeProperty === property.property;
              return (
                <button
                  type="button"
                  key={property.property}
                  className={`fa-contract-item${property.pass ? " is-pass" : " is-fail"}${isActive ? " is-active" : ""} focus-ring`}
                  aria-expanded={isActive}
                  onClick={() =>
                    setActiveProperty((prev) => (prev === property.property ? null : property.property))
                  }
                >
                  <Icon name={property.pass ? "ph:check-circle-bold" : "ph:warning-circle"} aria-hidden />
                  <span>{property.property}</span>
                  <Icon name="ph:caret-down" className="fa-contract-item__caret" width={12} aria-hidden />
                </button>
              );
            })}
          </div>
          {detail ? (
            <div className={`fa-contract-detail${detail.pass ? " is-pass" : " is-fail"}`}>
              <div className="fa-contract-detail__head">
                <span className="fa-contract-detail__badge" aria-hidden>
                  <Icon name={detail.pass ? "ph:check-circle-bold" : "ph:warning-circle"} width={16} />
                </span>
                <b>{detail.property}</b>
                <span className="fa-contract-detail__status">{detail.pass ? "Satisfied" : "Failing"}</span>
              </div>
              <div className="fa-contract-detail__body">
                <span className="fa-contract-detail__label">{detail.pass ? "Why it passes" : "What's missing"}</span>
                {detail.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          compact
          icon="ph:file-text"
          headline="No contract report available."
          subtitle="This familiar's identity contract hasn't been evaluated yet."
        />
      )}
    </FaSection>
  );
});

/** Map a confidence label to a tier class so the ring + KPIs read at a glance. */
function confidenceTier(label: ThreadConfidence["label"]): "low" | "developing" | "reliable" | "trusted" {
  switch (label) {
    case "Trusted": return "trusted";
    case "Reliable": return "reliable";
    case "Developing": return "developing";
    default: return "low";
  }
}

/** Radial progress ring for the thread-confidence score — a glanceable hero metric.
 *  With no self-reports yet the ring reads as unmeasured, never a fake "Low". */
const ConfidenceRing = memo(function ConfidenceRing({ confidence }: { confidence: ThreadConfidence }) {
  const score = Math.max(0, Math.min(100, confidence.score));
  const r = 42;
  const circ = 2 * Math.PI * r;
  const dash = confidence.hasData ? (score / 100) * circ : 0;
  const tier = confidence.hasData ? confidenceTier(confidence.label) : "none";
  const reportPhrase = `${confidence.reportCount} thread report${confidence.reportCount === 1 ? "" : "s"}`;
  return (
    <div
      className={`fa-ring fa-ring--${tier}`}
      role="img"
      aria-label={
        confidence.hasData
          ? `Thread confidence ${confidence.score} of 100, ${confidence.label}, from ${reportPhrase}`
          : "Thread confidence not measured yet — no thread self-reports"
      }
      title={confidence.hasData ? `From ${reportPhrase}` : "No thread self-reports yet"}
    >
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle className="fa-ring__track" cx="50" cy="50" r={r} />
        <circle
          className="fa-ring__value"
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="fa-ring__label">
        {confidence.hasData ? (
          <>
            <strong>{confidence.score}</strong>
            <span>{confidence.label}</span>
          </>
        ) : (
          <>
            <strong aria-hidden>—</strong>
            <span>No data</span>
          </>
        )}
      </div>
    </div>
  );
});

type Kpi = {
  key: string;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "warn" | "bad";
  /** Where the tile drills through to — a section anchor or a route. */
  href: string;
};

/** Derive the at-a-glance KPI tiles from the model's (otherwise buried) signals. */
function deriveKpis(model: FamiliarAnalyticsModel, healRequestCount: number): Kpi[] {
  const growth = model.growthReport;
  const contract = model.contractReport;
  const contractPass = contract ? contract.properties.filter((p) => p.pass).length : 0;
  const contractTotal = contract ? contract.properties.length : 0;
  const threadCount = model.threadReports.length;

  return [
    {
      key: "activity",
      icon: "ph:lightning-bold",
      label: "Activity",
      value: growth ? growth.healthLabel : "—",
      sub: growth ? `${growth.sessionsLast7d} session${growth.sessionsLast7d === 1 ? "" : "s"} · 7d` : "no data",
      tone: growth?.healthLabel === "stalled" ? "bad" : growth?.healthLabel === "quiet" ? "warn" : "good",
      href: "/dashboard/familiars/growth",
    },
    {
      key: "contract",
      icon: "ph:check-circle-bold",
      label: "Contract",
      value: contractTotal ? `${contractPass}/${contractTotal}` : "—",
      sub: contract ? (contract.pass ? "passing" : "needs review") : "no report",
      tone: !contractTotal ? undefined : contract?.pass ? "good" : "warn",
      href: "#fa-contract",
    },
    {
      key: "heal",
      icon: "ph:wrench-bold",
      label: "Self-heal",
      value: String(healRequestCount),
      sub: healRequestCount === 0 ? "all clear" : healRequestCount === 1 ? "open request" : "open requests",
      tone: healRequestCount === 0 ? "good" : "warn",
      href: "#fa-heal",
    },
    {
      key: "signals",
      icon: "ph:waveform-bold",
      label: "Thread signals",
      value: String(threadCount),
      sub: threadCount === 1 ? "report" : "reports",
      href: "#fa-thread-signals",
    },
  ];
}

const INSIGHT_ICON: Record<"good" | "warn" | "bad", Parameters<typeof Icon>[0]["name"]> = {
  good: "ph:check-circle-bold",
  warn: "ph:warning-circle",
  bad: "ph:warning-circle",
};

// ─── Needs-attention banner (recommended next actions) ───────────────────────

type NextAction = {
  key: string;
  label: string;
  why: string;
  sev: "crit" | "warn" | "info";
  /** The heal request this action stands in for (opens the same action modal). */
  request: SelfHealRequest;
};

/** Small state chips beside the banner — the at-a-glance "what's off" read. */
type AttentionStat = { key: string; value: string; label: string; tone: "ok" | "warn" | "crit" | "info" };

const SEV_RANK: Record<SelfHealRequest["severity"], number> = { crit: 0, warn: 1, info: 2 };

/**
 * Prioritized "do this next" list, derived from the same real heal requests
 * the self-heal grid shows (severity-first). Each action re-opens the request's
 * action modal, so the banner and the grid stay one behavior.
 */
function deriveNextActions(healRequests: SelfHealRequest[]): NextAction[] {
  return [...healRequests]
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
    .slice(0, 4)
    .map((request) => ({
      key: request.id,
      label: request.suggestedAction || HEAL_ACTION_LABEL[request.actionKind],
      why: request.detail,
      sev: request.severity,
      request,
    }));
}

/** Count of blocking thread signals — read from the aggregate persistent blockers. */
function blockingSignalCount(model: FamiliarAnalyticsModel): number {
  if (model.threadReports.length === 0) return 0;
  const aggregate = aggregateThreadSignals(model.threadReports);
  return aggregate.persistentBlockers.filter((blocker) => blocker.crit || blocker.impact === "blocking").length;
}

/** Derive the state chips: trust, contract, self-heal, blockers, streak. */
function deriveAttentionStats(model: FamiliarAnalyticsModel, healRequestCount: number): AttentionStat[] {
  const stats: AttentionStat[] = [];
  const c = model.confidence;
  if (c.hasData) {
    stats.push({
      key: "trust",
      value: String(c.score),
      label: "trust",
      tone: c.score >= 75 ? "ok" : c.score >= 40 ? "warn" : "crit",
    });
  }
  const contract = model.contractReport;
  if (contract && contract.properties.length > 0) {
    const pass = contract.properties.filter((p) => p.pass).length;
    stats.push({
      key: "contract",
      value: `${pass}/${contract.properties.length}`,
      label: "contract",
      tone: contract.pass ? "ok" : "warn",
    });
  }
  stats.push({
    key: "heal",
    value: String(healRequestCount),
    label: "self-heal",
    tone: healRequestCount === 0 ? "ok" : "warn",
  });
  const blockers = blockingSignalCount(model);
  if (blockers > 0) {
    stats.push({ key: "blockers", value: String(blockers), label: "blockers", tone: "crit" });
  }
  if (model.progression && model.progression.streakDays > 0) {
    stats.push({
      key: "streak",
      value: `${model.progression.streakDays}d`,
      label: "streak",
      tone: "info",
    });
  }
  return stats;
}

/**
 * The synthesized "needs attention" read of the familiar — one plain-language
 * line (deriveAnalyticsInsight) fronting a row of state chips and, when there's
 * anything to do, an expandable prioritized action list. All actions re-use the
 * self-heal action modal so the banner and the grid stay one behavior. When the
 * read is clean, it collapses to a calm all-clear line.
 */
const AnalyticsInsightBanner = memo(function AnalyticsInsightBanner({
  model,
  healRequestCount,
  nextActions,
  stats,
  expanded,
  onToggleExpanded,
  onAction,
}: {
  model: FamiliarAnalyticsModel;
  healRequestCount: number;
  nextActions: NextAction[];
  stats: AttentionStat[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onAction: (request: SelfHealRequest) => void;
}) {
  const insight = deriveAnalyticsInsight(model, healRequestCount);
  const actionable = insight.tone !== "good" && healRequestCount > 0;
  const heading = actionable ? "Needs attention" : "All clear";
  return (
    <section className={`fa-attention fa-insight--${insight.tone}`} aria-label="Needs attention">
      <div className="fa-attention__head">
        <span className="fa-attention__icon" aria-hidden>
          <Icon name={INSIGHT_ICON[insight.tone]} width={18} />
        </span>
        <span className="fa-attention__lede">
          <b className="fa-attention__title">{heading}</b>
          <span className="fa-attention__sub">{insight.text}</span>
        </span>
        {nextActions.length > 0 ? (
          <button
            type="button"
            className="fa-attention__toggle focus-ring"
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? "Hide actions" : `${nextActions.length} recommended action${nextActions.length === 1 ? "" : "s"}`}
            <Icon name="ph:caret-down" className={`fa-attention__caret${expanded ? " is-open" : ""}`} width={12} aria-hidden />
          </button>
        ) : actionable ? (
          <a className="fa-insight__action focus-ring" href="#fa-heal">
            Review
            <Icon name="ph:caret-right" aria-hidden />
          </a>
        ) : null}
      </div>
      {stats.length > 0 ? (
        <div className="fa-attention__stats">
          {stats.map((stat) => (
            <span key={stat.key} className={`fa-attention__stat fa-attention__stat--${stat.tone}`}>
              <b>{stat.value}</b>
              <span>{stat.label}</span>
            </span>
          ))}
        </div>
      ) : null}
      {expanded && nextActions.length > 0 ? (
        <div className="fa-attention__actions">
          <p className="fa-attention__actions-label">Prioritized — do this next</p>
          {nextActions.map((action, index) => (
            <div key={action.key} className={`fa-attention__action-row fa-attention__action-row--${action.sev}`}>
              <span className="fa-attention__n" aria-hidden>{index + 1}</span>
              <span className="fa-attention__action-main">
                <b>{action.label}</b>
                <small>{action.why}</small>
              </span>
              <button
                type="button"
                className="fa-attention__action-btn focus-ring"
                onClick={() => onAction(action.request)}
              >
                {action.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
});

/**
 * Progression band — the renown system's read of this familiar (same
 * derivation as the roster card, so the two surfaces always agree): tier,
 * score, progress toward the next rung, and the ritual streak. A broken
 * streak reads as an invitation, never a reprimand. Rendered inline in the
 * hero header, under the familiar's name.
 */
const ProgressionBand = memo(function ProgressionBand({
  progression,
}: {
  progression: FamiliarAnalyticsModel["progression"];
}) {
  if (!progression) return null;
  const { renown, streakDays } = progression;
  const pct = Math.round(renown.progress * 100);
  return (
    <section className="fa-progression" aria-label="Progression">
      <span className="fa-progression__tier">{renown.tier.label}</span>
      <span className="fa-progression__score">{renown.score} renown</span>
      <div
        className="fa-progression__meter"
        role="img"
        aria-label={
          renown.next
            ? `${renown.next.remaining} renown to ${renown.next.tier.label}`
            : "Top of the ladder"
        }
        title={renown.next ? `${renown.next.remaining} to ${renown.next.tier.label}` : "Top of the ladder"}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="fa-progression__next">
        {renown.next ? `${renown.next.remaining} to ${renown.next.tier.label}` : "top of the ladder"}
      </span>
      <span className="fa-progression__streak">
        <Icon name="ph:flame" aria-hidden />
        {streakDays > 0
          ? `${streakDays}-day streak`
          : "a session today starts a streak"}
      </span>
    </section>
  );
});

/** Scannable KPI row — each tile drills through to the section it summarizes. */
const FamiliarKpis = memo(function FamiliarKpis({
  model,
  healRequestCount,
}: {
  model: FamiliarAnalyticsModel;
  healRequestCount: number;
}) {
  const kpis = deriveKpis(model, healRequestCount);
  return (
    <ul className="fa-kpis" aria-label="Key metrics">
      {kpis.map((kpi) => (
        <li key={kpi.key}>
          <a className={`fa-kpi${kpi.tone ? ` fa-kpi--${kpi.tone}` : ""} focus-ring`} href={kpi.href}>
            <span className="fa-kpi__head">
              <Icon name={kpi.icon} aria-hidden />
              <span className="fa-kpi__label">{kpi.label}</span>
              {/* Drill cue — reveals on hover/focus so tiles read as links. */}
              <Icon name="ph:caret-right" className="fa-kpi__go" aria-hidden />
            </span>
            <strong className="fa-kpi__value">{kpi.value}</strong>
            <span className="fa-kpi__sub">{kpi.sub}</span>
          </a>
        </li>
      ))}
    </ul>
  );
});

export function FamiliarAnalyticsContent({
  model,
  onRefresh,
  refreshing = false,
  updatedAt = null,
}: {
  model: FamiliarAnalyticsModel;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Truthful last-load stamp for the topbar freshness readout. */
  updatedAt?: string | null;
}) {
  const familiarName = model.familiar?.display_name ?? model.familiarId;
  const familiarRole = model.familiar?.role || model.familiar?.harness || "Familiar";
  const threadSignalsAggregate = useMemo(
    () => model.threadReports.length > 0 ? aggregateThreadSignals(model.threadReports) : null,
    [model.threadReports],
  );
  const healRequests = useMemo(() => {
    if (!threadSignalsAggregate) return model.healRequests;
    const escalated = escalateBlockers(model.familiarId, threadSignalsAggregate, model.healRequests);
    return [...escalated, ...model.healRequests];
  }, [model.familiarId, model.healRequests, threadSignalsAggregate]);
  const nextActions = useMemo(() => deriveNextActions(healRequests), [healRequests]);
  const attentionStats = useMemo(
    () => deriveAttentionStats(model, healRequests.length),
    [model, healRequests.length],
  );
  const pulseSessions = pulseTotal(model.sessionPulse);
  // cave-fy1q phase 3: surface the first-run funnel while this install has
  // both stamps. Sampled after mount — localStorage isn't SSR-safe.
  const [timeToFirstReply, setTimeToFirstReply] = useState<string | null>(null);
  useEffect(() => {
    const ms = timeToFirstReplyMs();
    setTimeToFirstReply(ms === null ? null : formatTimeToFirstReply(ms));
  }, []);
  // Pulse-day drill: clicking a hero bar narrows Recent sessions to that day.
  const [selectedDay, setSelectedDay] = useState<PulseDay | null>(null);
  // Session trace overlay target — any surface on the page can open it.
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null);
  // Needs-attention banner: expandable prioritized action list.
  const [actionsExpanded, setActionsExpanded] = useState(false);
  // Model-performance panel folds behind a header (design: opt-in detail).
  const [modelOpen, setModelOpen] = useState(false);
  // Modals: the full self-heal list, and a per-action confirmation sheet.
  const [healAllOpen, setHealAllOpen] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModalData | null>(null);
  const { announce } = useAnnouncer();

  const openAction = useCallback((request: SelfHealRequest) => {
    setActionModal(buildActionModal(request));
  }, []);
  const traceRequest = useCallback((request: SelfHealRequest) => {
    setTraceTarget({ id: request.id, title: request.title });
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
    setHealAllOpen(false);
  }, [actionModal, announce, model.familiarId]);

  const handleSelectDay = useCallback((day: PulseDay) => {
    setSelectedDay((prev) => {
      const next = prev?.key === day.key ? null : day;
      if (next && typeof document !== "undefined") {
        // Land the reader on the filtered list; smoothness comes from the
        // page's scroll-behavior (and holds still under reduced motion).
        document.getElementById("fa-sessions")?.scrollIntoView({ block: "start" });
      }
      return next;
    });
  }, []);

  return (
    <>
      <nav className="fa-topbar" aria-label="Breadcrumb">
        <a href="/dashboard">Dashboard</a>
        <span>/</span>
        <a href="/dashboard/familiars/growth">Familiars</a>
        <span>/</span>
        <b>Analytics</b>
        <a href={`/dashboard/familiars/${encodeURIComponent(model.familiarId)}/profile`}>Profile →</a>
        {updatedAt ? (
          <span className="fa-topbar__updated">
            Updated <RelativeTime iso={updatedAt} />
          </span>
        ) : null}
        {onRefresh ? (
          <button
            type="button"
            className={`retro-icon-btn${refreshing ? " is-refreshing" : ""}`}
            aria-label="Refresh familiar analytics"
            title="Refresh familiar analytics"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <Icon name="ph:arrows-clockwise-bold" aria-hidden />
          </button>
        ) : null}
      </nav>

      {model.errors.length > 0 ? (
        <div className="retro-callout" role="alert">
          <Icon name="ph:warning-circle" aria-hidden />
          <span>{model.errors.join(" · ")}</span>
        </div>
      ) : null}

      <header className="fa-header">
        <span className="fa-header__glow" aria-hidden />
        <div className="fa-header__identity">
          <AuthedImage
            className="fa-avatar"
            src={model.familiar?.avatarUrl}
            alt={familiarName}
            fallback={<span className="fa-avatar" aria-hidden>{familiarName.slice(0, 1).toUpperCase()}</span>}
          />
          <div className="fa-header__meta">
            <p className="retro-eyebrow">
              <Icon name="ph:chart-bar-bold" aria-hidden />
              Familiar analytics
            </p>
            <h1>{familiarName}</h1>
            <p>{familiarRole}</p>
            <ProgressionBand progression={model.progression} />
          </div>
        </div>
        <div className="fa-header__pulse">
          <span className="fa-pulse__label">14-day pulse</span>
          <PulseBars
            pulse={model.sessionPulse}
            label={`14-day activity: ${pulseSessions} session${pulseSessions === 1 ? "" : "s"}. Select a day to filter recent sessions.`}
            size="lg"
            showTips
            onSelectDay={handleSelectDay}
            selectedKey={selectedDay?.key ?? null}
          />
          <span className="fa-pulse__meta">
            <a className="focus-ring" href="#fa-sessions">
              {pulseSessions} session{pulseSessions === 1 ? "" : "s"}
            </a>{" "}
            · last active{" "}
            <RelativeTime iso={model.growthReport?.lastActiveAt} fallback="never" />
            {timeToFirstReply ? <> · first reply {timeToFirstReply} after first open</> : null}
          </span>
        </div>
        <ConfidenceRing confidence={model.confidence} />
      </header>

      <AnalyticsInsightBanner
        model={model}
        healRequestCount={healRequests.length}
        nextActions={nextActions}
        stats={attentionStats}
        expanded={actionsExpanded}
        onToggleExpanded={() => setActionsExpanded((prev) => !prev)}
        onAction={openAction}
      />

      <FamiliarKpis model={model} healRequestCount={healRequests.length} />

      <div className="fa-grid">
        {/* Self-heal requests lead the grid full-width — the actionable "needs
            a human" queue is the first thing worth doing. Its #fa-heal anchor
            keeps the KPI drill-through and the banner's Review link working. */}
        <FaSection
          id="fa-heal"
          title="Self-heal requests"
          wide
          count={`${healRequests.length} ${healRequests.length === 1 ? "request" : "requests"}`}
        >
          <SelfHealGrid
            requests={healRequests}
            onAction={openAction}
            onTrace={traceRequest}
            onViewAll={() => setHealAllOpen(true)}
          />
        </FaSection>

        {/* Confidence + recent sessions pair on the second row — the read and
            the tracing spine side by side. The hero pulse filters the list. */}
        <ThreadAnalysisSection
          confidence={model.confidence}
          trends={model.signalTrends}
          familiar={model.familiar}
          onSelfReportEnabled={onRefresh}
        />

        <FaSection
          id="fa-sessions"
          title="Recent sessions"
          count={`${model.recentSessions.length} recent`}
        >
          <RecentSessionsSection
            sessions={model.recentSessions}
            selectedDay={selectedDay}
            onClearDay={() => setSelectedDay(null)}
            onTrace={setTraceTarget}
          />
        </FaSection>

        <FaSection
          id="fa-thread-signals"
          title="Thread signals"
          // The signals data table earns full width only when there are
          // reports — an empty state shouldn't claim both columns.
          wide={model.threadReports.length > 0}
          count={`${model.threadReports.length} ${model.threadReports.length === 1 ? "report" : "reports"}`}
        >
          <ThreadSignalsSection familiarId={model.familiarId} reports={model.threadReports} />
        </FaSection>

        {/* Model performance — thumbs votes on chat replies, netted per message
            (last vote wins, toggles withdraw) and bucketed by the model and
            runtime that produced them. Folds behind a header (design: opt-in
            detail). Fed by /api/feedback/message GET via message-feedback-rollup.ts. */}
        <FaCollapsibleSection
          id="fa-model-performance"
          title="Model performance"
          count={`${model.modelFeedback.total} ${model.modelFeedback.total === 1 ? "vote" : "votes"}`}
          hint="Thumbs votes on chat replies, by model & runtime"
          open={modelOpen}
          onToggle={() => setModelOpen((prev) => !prev)}
        >
          <ModelFeedbackSection rollup={model.modelFeedback} />
        </FaCollapsibleSection>

        <ContractCompliance report={model.contractReport} />
      </div>

      {traceTarget ? (
        <SessionTraceOverlay target={traceTarget} onClose={() => setTraceTarget(null)} />
      ) : null}

      {healAllOpen ? (
        <HealAllModal
          requests={healRequests}
          onAction={openAction}
          onTrace={traceRequest}
          onClose={() => setHealAllOpen(false)}
        />
      ) : null}

      {actionModal ? (
        <ActionModal data={actionModal} onConfirm={confirmAction} onClose={() => setActionModal(null)} />
      ) : null}
    </>
  );
}

// ─── Model performance (thumbs feedback) ─────────────────────────────────────

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
