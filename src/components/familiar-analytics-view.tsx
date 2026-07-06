"use client";

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildFamiliarAnalyticsModel,
  loadFamiliarAnalyticsData,
  type FamiliarAnalyticsData,
  type FamiliarAnalyticsModel,
} from "@/components/familiar-analytics-data";
import { EmptyState } from "@/components/ui/empty-state";
import { PulseBars } from "@/components/ui/pulse-bars";
import { RelativeTime } from "@/components/ui/relative-time";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Sparkline, type SparkPoint } from "@/components/ui/sparkline";
import { useAnnouncer } from "@/components/ui/live-region";
import { ThreadSignalsSection } from "@/components/thread-signals-section";
import { escalateBlockers, type SelfHealRequest } from "@/lib/familiar-heal-requests";
import type { ConfidenceScore } from "@/lib/familiar-confidence";
import type { ContractReport } from "@/lib/familiar-contract";
import { Icon } from "@/lib/icon";
import { deriveAnalyticsInsight } from "@/lib/familiar-analytics-insight";
import { pulseTotal } from "@/lib/session-pulse";
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
  const { announce } = useAnnouncer();

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await loadFamiliarAnalyticsData(familiarId));
      if (quiet) announce("Analytics refreshed.");
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
      {model ? <FamiliarAnalyticsContent model={model} onRefresh={() => void load({ quiet: true })} refreshing={refreshing} /> : (
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

const ConfidenceBreakdown = memo(function ConfidenceBreakdown({ confidence }: { confidence: ConfidenceScore }) {
  return (
    <FaSection id="fa-confidence" title="Confidence breakdown" count={`${confidence.factors.length} factors`}>
      <div className="fa-factor-list">
        {confidence.factors.map((factor) => (
          <div key={factor.label} className="fa-factor">
            <div className="fa-factor__meta">
              <b>{factor.label.replaceAll("_", " ")}</b>
              <span>{Math.round(factor.value)} × {factor.weight.toFixed(2)}</span>
            </div>
            <div className="fa-factor-bar" aria-label={`${factor.label} contributes ${factor.contribution.toFixed(1)}`}>
              <span className="fa-factor-segment" style={{ width: `${Math.max(0, Math.min(100, factor.value))}%` }} />
            </div>
            <small>{factor.contribution.toFixed(1)} points</small>
          </div>
        ))}
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

const ResponseConfidenceSection = memo(function ResponseConfidenceSection({
  rollup,
  events,
}: {
  rollup: ResponseConfidenceRollup;
  events: ResponseConfidenceEvent[];
}) {
  if (rollup.eventCount === 0) {
    return <EmptyState compact icon="ph:chart-bar-bold" headline={RESPONSE_CONFIDENCE_EMPTY_STATE} />;
  }
  const trend = buildResponseTrend(events);

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
        <ScoreTile label="Avg confidence" value={rollup.averageConfidence} />
        <ScoreTile label="Low confidence" value={rollup.lowConfidenceCount} />
        <ScoreTile label="Events" value={rollup.eventCount} />
        <ScoreTile label="Latest" value={rollup.newestEvent?.overallConfidence ?? 0} />
      </div>
      <div className="fa-response-factor-grid" aria-label="Response confidence factor averages">
        {RESPONSE_CONFIDENCE_FACTOR_KEYS.map((key) => (
          <div key={key} className="fa-response-factor">
            <span>{RESPONSE_CONFIDENCE_LABELS[key]}</span>
            <b>{rollup.factorAverages[key]}</b>
            <div className="fa-factor-bar" aria-label={`${RESPONSE_CONFIDENCE_LABELS[key]} ${rollup.factorAverages[key]}`}>
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
    </div>
  );
});

function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="fa-thread-score">
      <div>
        <span>{label}</span>
        <b>{value}</b>
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

/** One-line plain-language read of the familiar's state — turns numbers into meaning. */
const AnalyticsInsightBanner = memo(function AnalyticsInsightBanner({
  model,
  healRequestCount,
}: {
  model: FamiliarAnalyticsModel;
  healRequestCount: number;
}) {
  const insight = deriveAnalyticsInsight(model, healRequestCount);
  return (
    <p className={`fa-insight fa-insight--${insight.tone}`} role="note">
      <Icon name={INSIGHT_ICON[insight.tone]} aria-hidden />
      <span>{insight.text}</span>
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
}: {
  model: FamiliarAnalyticsModel;
  onRefresh?: () => void;
  refreshing?: boolean;
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

  return (
    <>
      <nav className="fa-topbar" aria-label="Breadcrumb">
        <a href="/dashboard">Dashboard</a>
        <span>/</span>
        <a href="/dashboard/familiars/growth">Familiars</a>
        <span>/</span>
        <b>Analytics</b>
        {onRefresh ? (
          <button
            type="button"
            className="retro-icon-btn"
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
          {model.familiar?.avatarUrl ? (
            <img className="fa-avatar" src={model.familiar.avatarUrl} alt={familiarName} />
          ) : (
            <span className="fa-avatar" aria-hidden>{familiarName.slice(0, 1).toUpperCase()}</span>
          )}
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
            label={`14-day activity: ${pulseSessions} session${pulseSessions === 1 ? "" : "s"}`}
            showTips
          />
          <span className="fa-pulse__meta">
            {pulseSessions} session{pulseSessions === 1 ? "" : "s"} · last active{" "}
            <RelativeTime iso={model.growthReport?.lastActiveAt} fallback="never" />
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
          wide
          count={`${model.responseConfidenceRollup.eventCount} ${model.responseConfidenceRollup.eventCount === 1 ? "event" : "events"}`}
        >
          <ResponseConfidenceSection rollup={model.responseConfidenceRollup} events={model.responseConfidenceEvents} />
        </FaSection>

        <ConfidenceBreakdown confidence={model.confidence} />

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
          count={`${model.threadReports.length} ${model.threadReports.length === 1 ? "report" : "reports"}`}
        >
          <ThreadSignalsSection familiarId={model.familiarId} reports={model.threadReports} />
        </FaSection>

        <ContractCompliance report={model.contractReport} />
      </div>
    </>
  );
}
