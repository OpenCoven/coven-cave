"use client";

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildFamiliarAnalyticsModel,
  loadFamiliarAnalyticsData,
  type FamiliarAnalyticsData,
  type FamiliarAnalyticsModel,
} from "@/components/familiar-analytics-data";
import type { FeedbackSliceStat, MessageFeedbackRollup } from "@/lib/message-feedback-rollup";
import { Button } from "@/components/ui/button";
import { AuthedImage } from "@/components/ui/authed-image";
import { EmptyState } from "@/components/ui/empty-state";
import { PulseBars } from "@/components/ui/pulse-bars";
import { RelativeTime } from "@/components/ui/relative-time";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Sparkline, type SparkPoint } from "@/components/ui/sparkline";
import { useAnnouncer } from "@/components/ui/live-region";
import { ThreadSignalsSection } from "@/components/thread-signals-section";
import { escalateBlockers, type SelfHealRequest } from "@/lib/familiar-heal-requests";
import type { ConfidenceFactor, ConfidenceScore } from "@/lib/familiar-confidence";
import type { ContractReport } from "@/lib/familiar-contract";
import type { Familiar, SessionRow } from "@/lib/types";
import { Icon } from "@/lib/icon";
import { deriveAnalyticsInsight } from "@/lib/familiar-analytics-insight";
import { formatTimeToFirstReply, timeToFirstReplyMs } from "@/lib/first-run-stamps";
import { SessionTraceOverlay, type TraceTarget } from "@/components/session-trace-overlay";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { pulseTotal, sessionDayKey, type PulseDay } from "@/lib/session-pulse";
import {
  RESPONSE_CONFIDENCE_EMPTY_STATE,
  RESPONSE_CONFIDENCE_FACTOR_KEYS,
  aggregateThreadSignals,
  type ResponseConfidenceEvent,
  type ResponseConfidenceFactorKey,
  type ResponseConfidenceRollup,
} from "@/lib/thread-self-report";

export function FamiliarAnalyticsView({ familiarId }: { familiarId: string }) {
  const [data, setData] = useState<FamiliarAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Truthful freshness stamp — set when a load actually lands, never faked.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  // `silent` marks the recurring background poll: it refreshes the data and
  // freshness stamp but never announces (a 60s AT announcement loop is noise).
  const load = useCallback(async ({ quiet = false, silent = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await loadFamiliarAnalyticsData(familiarId));
      setUpdatedAt(new Date().toISOString());
      if (quiet && !silent) announce("Analytics refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "analytics data unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [announce, familiarId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the page live — pulse, sessions, and confidence data drift while
  // familiars work. Pauses in hidden tabs; refreshes on regaining focus.
  usePausablePoll(() => void load({ quiet: true, silent: true }), 60_000);

  const model = useMemo(() => data ? buildFamiliarAnalyticsModel(data) : null, [data]);

  if (loading && !model) {
    return (
      <main className="fa-page" aria-busy="true">
        <div className="fa-section">
          <SkeletonRows count={8} />
        </div>
      </main>
    );
  }

  return (
    <main className="fa-page" aria-busy={refreshing}>
      {error ? (
        <div className="retro-callout" role="alert">
          <Icon name="ph:warning-circle" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}
      {model ? <FamiliarAnalyticsContent model={model} onRefresh={() => void load({ quiet: true })} refreshing={refreshing} updatedAt={updatedAt} /> : (
        <EmptyState
          compact
          icon="ph:users-three-bold"
          headline="No familiar analytics available."
          subtitle="Analytics appear once this familiar has run a session."
        />
      )}
    </main>
  );
}

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

// Plain-language name + one-sentence meaning for each confidence factor, keyed by
// the raw `label` from familiar-confidence.ts. Presentation-only — the score math
// is unchanged. Falls back to a de-underscored label for any unknown factor.
const CONFIDENCE_FACTOR_COPY: Record<string, { name: string; desc: string }> = {
  contract_score: {
    name: "Identity contract",
    desc: "Share of this familiar's identity-contract checks currently passing.",
  },
  accept_rate: {
    name: "Retro acceptance",
    desc: "Share of self-improvement (retro) runs you accepted. Needs at least 3 runs to count.",
  },
  freshness_score: {
    name: "Memory freshness",
    desc: "How current this familiar's memory is — fresh, aging, or stale.",
  },
  activity_score: {
    name: "Recent activity",
    desc: "Sessions in the last 7 days (capped at 10).",
  },
};

function confidenceFactorCopy(label: string): { name: string; desc: string } {
  return CONFIDENCE_FACTOR_COPY[label] ?? { name: label.replaceAll("_", " "), desc: "" };
}

/** The most points a factor can add to the 0–100 score = its weight × 100. */
function maxContribution(factor: ConfidenceFactor): number {
  return Math.round(factor.weight * 100);
}

const ConfidenceBreakdown = memo(function ConfidenceBreakdown({ confidence }: { confidence: ConfidenceScore }) {
  // Scale each factor's bar TRACK to its weight (relative to the heaviest factor),
  // so the filled length ∝ contribution (value × weight) — i.e. the factor's real
  // influence on the score, not its raw value. A long half-full bar (high weight)
  // clearly outweighs a short full bar (low weight).
  const maxWeight = Math.max(0.0001, ...confidence.factors.map((factor) => factor.weight));
  return (
    <FaSection id="fa-confidence" title="Confidence breakdown" count={`${confidence.factors.length} factors`}>
      <div className="fa-factor-list">
        {confidence.factors.map((factor) => {
          const copy = confidenceFactorCopy(factor.label);
          const max = maxContribution(factor);
          const trackPct = Math.round((factor.weight / maxWeight) * 100);
          const tip = `${copy.desc} Worth up to ${max} of 100 points.`.trim();
          return (
            <div key={factor.label} className="fa-factor">
              <div className="fa-factor__meta">
                <b>
                  {copy.name}
                  {copy.desc ? (
                    <button type="button" className="fa-factor-info" title={tip} aria-label={`${copy.name}: ${tip}`}>
                      <Icon name="ph:info" width={12} aria-hidden />
                    </button>
                  ) : null}
                </b>
                <span>
                  {Math.round(factor.value)}<span className="fa-metric-unit">/100</span>
                </span>
              </div>
              <div
                className="fa-factor-bar"
                style={{ width: `${trackPct}%` }}
                aria-label={`${copy.name}: earned ${factor.contribution.toFixed(1)} of ${max} points`}
              >
                <span className="fa-factor-segment" style={{ width: `${Math.max(0, Math.min(100, factor.value))}%` }} />
              </div>
              <small className="fa-factor-earned">
                <b>{factor.contribution.toFixed(1)}</b>
                <span className="fa-metric-unit"> / {max} pts</span>
              </small>
            </div>
          );
        })}
      </div>
    </FaSection>
  );
});

const RESPONSE_CONFIDENCE_LABELS: Record<ResponseConfidenceFactorKey, string> = {
  toolUse: "Tool use",
  context: "Context",
  skills: "Skills",
  permissions: "Permissions",
  memory: "Memory",
  instructionFit: "Instruction fit",
  evidence: "Evidence",
};

/** Trend line of per-response confidence scores, oldest → newest. */
function buildResponseTrend(events: ResponseConfidenceEvent[]): SparkPoint[] {
  return [...events]
    .sort((a, b) => Date.parse(a.responseAt) - Date.parse(b.responseAt))
    .map((event) => ({
      label: new Date(event.responseAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      value: event.overallConfidence,
    }));
}

function trendColor(averageConfidence: number): string {
  if (averageConfidence >= 70) return "var(--color-success)";
  if (averageConfidence >= 50) return "var(--accent-presence)";
  return "var(--color-danger)";
}

/**
 * Empty state for the Response confidence panel. When the familiar hasn't
 * enabled response self-reporting, the notice carries the fix — a one-click
 * enable that persists `autoSelfReport` to cave-config (the same key the
 * Studio's Brain tab toggles) instead of sending the user hunting through
 * Settings.
 */
function SelfReportEmptyState({
  familiar,
  onSelfReportEnabled,
}: {
  familiar: Familiar | null;
  onSelfReportEnabled?: () => void;
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
        headline="No response confidence events yet."
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
      headline={RESPONSE_CONFIDENCE_EMPTY_STATE}
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

/** Score tone shared by the trend line and the per-response chips. */
function confidenceScoreTone(score: number): "good" | "mid" | "bad" {
  if (score >= 70) return "good";
  if (score >= 50) return "mid";
  return "bad";
}

/** How many raw response events the drill-through list shows. */
const RECENT_RESPONSE_EVENTS = 6;

const ResponseConfidenceSection = memo(function ResponseConfidenceSection({
  rollup,
  events,
  familiar,
  onSelfReportEnabled,
  onTrace,
}: {
  rollup: ResponseConfidenceRollup;
  events: ResponseConfidenceEvent[];
  familiar: Familiar | null;
  onSelfReportEnabled?: () => void;
  /** Open the session trace overlay for the session behind an event. */
  onTrace?: (target: TraceTarget) => void;
}) {
  if (rollup.eventCount === 0) {
    return (
      <SelfReportEmptyState familiar={familiar} onSelfReportEnabled={onSelfReportEnabled} />
    );
  }
  const trend = buildResponseTrend(events);
  // Newest first — each event links back to the thread that produced it, so a
  // low score is one click from the conversation that explains it.
  const recentEvents = [...events]
    .sort((a, b) => Date.parse(b.responseAt) - Date.parse(a.responseAt))
    .slice(0, RECENT_RESPONSE_EVENTS);

  return (
    <div className="fa-response-confidence">
      {trend.length >= 2 ? (
        <figure
          className="fa-response-trend"
          role="img"
          aria-label={`Confidence trend across ${rollup.eventCount} responses, averaging ${rollup.averageConfidence} of 100`}
        >
          <Sparkline points={trend} color={trendColor(rollup.averageConfidence)} height={56} />
          <figcaption aria-hidden>
            Per-response confidence, oldest to newest · hover for scores
          </figcaption>
        </figure>
      ) : null}
      <div className="fa-thread-score-grid">
        <ScoreTile label="Avg confidence" value={rollup.averageConfidence} unit="/100" hint="Average self-reported confidence across responses, out of 100." />
        <ScoreTile label="Low-confidence responses" value={rollup.lowConfidenceCount} hint="Responses that scored below 60 / 100." />
        <ScoreTile label="Events" value={rollup.eventCount} hint="Self-report events in this range." />
        <ScoreTile label="Latest" value={rollup.newestEvent?.overallConfidence ?? 0} unit="/100" hint="The most recent response's confidence, out of 100." />
      </div>
      <div className="fa-response-factor-grid" aria-label="Response confidence factor averages, each out of 100">
        {RESPONSE_CONFIDENCE_FACTOR_KEYS.map((key) => (
          <div
            key={key}
            className="fa-response-factor"
            title={`${RESPONSE_CONFIDENCE_LABELS[key]} — weighted average across responses, out of 100.`}
          >
            <span>{RESPONSE_CONFIDENCE_LABELS[key]}</span>
            <b>{rollup.factorAverages[key]}<span className="fa-metric-unit">/100</span></b>
            <div className="fa-factor-bar" aria-label={`${RESPONSE_CONFIDENCE_LABELS[key]} ${rollup.factorAverages[key]} of 100`}>
              <span className="fa-factor-segment" style={{ width: `${Math.max(0, Math.min(100, rollup.factorAverages[key]))}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="fa-response-tags" aria-label="Top response confidence diagnostic tags">
        {rollup.topDiagnosticTags.length === 0 ? <span>No diagnostic tags yet.</span> : rollup.topDiagnosticTags.map((item) => (
          <span key={item.tag}>
            {item.tag} <b>{item.count}</b>
          </span>
        ))}
      </div>
      {recentEvents.length > 0 ? (
        <div className="fa-response-events">
          <h3>Recent responses</h3>
          <ul aria-label="Recent response confidence events">
            {recentEvents.map((event) => (
              <li key={event.id} className="fa-response-event">
                <b
                  className={`fa-response-score fa-response-score--${confidenceScoreTone(event.overallConfidence)}`}
                  title={`Self-reported confidence ${event.overallConfidence} of 100`}
                >
                  {event.overallConfidence}
                </b>
                <span className="fa-response-event__body">
                  <a
                    className="focus-ring"
                    href={`/#chat-${encodeURIComponent(event.sessionId)}`}
                    title="Open this thread in chat"
                  >
                    {event.threadTitle?.trim() || event.sessionId}
                  </a>
                  <small>
                    <RelativeTime iso={event.responseAt} />
                    {event.diagnosticTags.length > 0 ? <> · {event.diagnosticTags.slice(0, 2).join(", ")}</> : null}
                  </small>
                </span>
                {onTrace ? (
                  <button
                    type="button"
                    className="fa-trace-btn focus-ring"
                    title="Trace the session behind this response"
                    aria-label={`Trace session ${event.threadTitle?.trim() || event.sessionId}`}
                    onClick={() => onTrace({ id: event.sessionId, title: event.threadTitle })}
                  >
                    <Icon name="ph:tree-structure" width={12} aria-hidden />
                    Trace
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
});

/** Status tone for a session row's presence dot. */
function sessionStatusTone(status: string): "run" | "bad" | "done" {
  const s = status.toLowerCase();
  if (/(running|active|working|streaming|starting)/.test(s)) return "run";
  if (/(error|fail|killed|crash)/.test(s)) return "bad";
  return "done";
}

/** How many session rows the drill-through list shows at once. */
const RECENT_SESSIONS_SHOWN = 12;

/**
 * Recent sessions — the tracing spine of the page. Every row is one click
 * from the conversation (`/#chat-<id>`) and one click from the daemon event
 * timeline (trace overlay). A clicked pulse day narrows the list to that day.
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
  const filtered = selectedDay
    ? sessions.filter((session) => sessionDayKey(session.updated_at) === selectedDay.key)
    : sessions;
  const shown = filtered.slice(0, RECENT_SESSIONS_SHOWN);

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
          onClick={onClearDay}
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
      {filtered.length > shown.length ? (
        <p className="fa-sessions__truncation">
          Showing {shown.length} of {filtered.length} sessions.
        </p>
      ) : null}
    </div>
  );
});

function ScoreTile({ label, value, unit, hint }: { label: string; value: number; unit?: string; hint?: string }) {
  return (
    <div className="fa-thread-score" title={hint}>
      <div>
        <span>{label}</span>
        <b>
          {value}
          {unit ? <span className="fa-metric-unit">{unit}</span> : null}
        </b>
      </div>
    </div>
  );
}

const SelfHealList = memo(function SelfHealList({ requests }: { requests: SelfHealRequest[] }) {
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
  return (
    <div className="fa-heal-list">
      {requests.map((request) => (
        <article key={request.id} className={`fa-heal-card fa-heal-card--${request.severity}`}>
          <div>
            <span>{request.source}</span>
            <h3>{request.title}</h3>
            <p>{request.detail}</p>
          </div>
          <b>{request.actionKind}</b>
        </article>
      ))}
    </div>
  );
});

const ContractCompliance = memo(function ContractCompliance({ report }: { report: ContractReport | null }) {
  const passCount = report ? report.properties.filter((property) => property.pass).length : 0;
  return (
    <FaSection
      id="fa-contract"
      title="Contract compliance"
      count={report ? `${passCount}/${report.properties.length} · ${report.pass ? "passing" : "needs review"}` : "no report"}
    >
      {report ? (
        <div className="fa-contract-grid">
          {report.properties.map((property) => (
            <div key={property.property} className={`fa-contract-item${property.pass ? " is-pass" : " is-fail"}`}>
              <Icon name={property.pass ? "ph:check-circle-bold" : "ph:warning-circle"} aria-hidden />
              <span>{property.property}</span>
            </div>
          ))}
        </div>
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
function confidenceTier(label: ConfidenceScore["label"]): "low" | "developing" | "reliable" | "trusted" {
  switch (label) {
    case "Trusted": return "trusted";
    case "Reliable": return "reliable";
    case "Developing": return "developing";
    default: return "low";
  }
}

/** Radial progress ring for the confidence score — a glanceable hero metric. */
const ConfidenceRing = memo(function ConfidenceRing({ confidence }: { confidence: ConfidenceScore }) {
  const score = Math.max(0, Math.min(100, confidence.score));
  const r = 42;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const tier = confidenceTier(confidence.label);
  return (
    <div
      className={`fa-ring fa-ring--${tier}`}
      role="img"
      aria-label={`Confidence score ${confidence.score} of 100, ${confidence.label}`}
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
        <strong>{confidence.score}</strong>
        <span>{confidence.label}</span>
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
  const responseEvents = model.responseConfidenceRollup.eventCount;

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
    {
      key: "responses",
      icon: "ph:chart-bar-bold",
      label: "Responses",
      value: String(responseEvents),
      sub: responseEvents === 1 ? "confidence event" : "confidence events",
      href: "#fa-response-confidence",
    },
  ];
}

const INSIGHT_ICON: Record<"good" | "warn" | "bad", Parameters<typeof Icon>[0]["name"]> = {
  good: "ph:check-circle-bold",
  warn: "ph:warning-circle",
  bad: "ph:warning-circle",
};

/** One-line plain-language read of the familiar's state — turns numbers into meaning.
 *  When the read is actionable (attention tones with open heal requests), the
 *  banner carries its own drill-through so the next step is one click. */
const AnalyticsInsightBanner = memo(function AnalyticsInsightBanner({
  model,
  healRequestCount,
}: {
  model: FamiliarAnalyticsModel;
  healRequestCount: number;
}) {
  const insight = deriveAnalyticsInsight(model, healRequestCount);
  const actionable = insight.tone !== "good" && healRequestCount > 0;
  return (
    <p className={`fa-insight fa-insight--${insight.tone}`} role="note">
      <Icon name={INSIGHT_ICON[insight.tone]} aria-hidden />
      <span>{insight.text}</span>
      {actionable ? (
        <a className="fa-insight__action focus-ring" href="#fa-heal">
          Review
          <Icon name="ph:caret-right" aria-hidden />
        </a>
      ) : null}
    </p>
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
        <div className="fa-header__identity">
          <AuthedImage
            className="fa-avatar"
            src={model.familiar?.avatarUrl}
            alt={familiarName}
            fallback={<span className="fa-avatar" aria-hidden>{familiarName.slice(0, 1).toUpperCase()}</span>}
          />
          <div>
            <p className="retro-eyebrow">
              <Icon name="ph:chart-bar-bold" aria-hidden />
              Familiar analytics
            </p>
            <h1>{familiarName}</h1>
            <p>{familiarRole}</p>
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

      <AnalyticsInsightBanner model={model} healRequestCount={healRequests.length} />

      <FamiliarKpis model={model} healRequestCount={healRequests.length} />

      <div className="fa-grid">
        <FaSection
          id="fa-response-confidence"
          title="Response confidence"
          // An empty rollup renders a one-line empty state — spanning the full
          // width would give the page's hero slot to a placeholder and push
          // real signal below the fold, so the section only widens with data.
          wide={model.responseConfidenceRollup.eventCount > 0}
          count={`${model.responseConfidenceRollup.eventCount} ${model.responseConfidenceRollup.eventCount === 1 ? "event" : "events"}`}
        >
          <ResponseConfidenceSection
            rollup={model.responseConfidenceRollup}
            events={model.responseConfidenceEvents}
            familiar={model.familiar}
            onSelfReportEnabled={onRefresh}
            onTrace={setTraceTarget}
          />
        </FaSection>

        {/* Recent sessions — the tracing spine. The hero pulse filters this
            list by day; every row opens its thread or its daemon trace. */}
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

        <ConfidenceBreakdown confidence={model.confidence} />

        {/* Contract compliance pairs with the confidence breakdown — both read
            on identity health — and sits above the fold instead of dangling
            under the operational panels. The #fa-contract KPI drill-through
            keeps working wherever the section lives. */}
        <ContractCompliance report={model.contractReport} />

        <FaSection
          id="fa-heal"
          title="Self-heal requests"
          count={`${healRequests.length} ${healRequests.length === 1 ? "request" : "requests"}`}
        >
          <SelfHealList requests={healRequests} />
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
            runtime that produced them. Fed by /api/feedback/message GET via
            message-feedback-rollup.ts. */}
        <FaSection
          id="fa-model-performance"
          title="Model performance"
          count={`${model.modelFeedback.total} ${model.modelFeedback.total === 1 ? "vote" : "votes"}`}
        >
          <ModelFeedbackSection rollup={model.modelFeedback} />
        </FaSection>
      </div>

      {traceTarget ? (
        <SessionTraceOverlay target={traceTarget} onClose={() => setTraceTarget(null)} />
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
