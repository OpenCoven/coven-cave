"use client";

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildFamiliarAnalyticsModel,
  loadFamiliarAnalyticsData,
  type FamiliarAnalyticsData,
  type FamiliarAnalyticsModel,
} from "@/components/familiar-analytics-data";
import { EmptyState } from "@/components/ui/empty-state";
import { EvalLoopPanel } from "@/components/eval-loop-panel";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ThreadSignalsSection } from "@/components/thread-signals-section";
import { escalateBlockers, type SelfHealRequest } from "@/lib/familiar-heal-requests";
import type { ConfidenceScore } from "@/lib/familiar-confidence";
import type { ContractReport } from "@/lib/familiar-contract";
import { Icon } from "@/lib/icon";
import {
  RESPONSE_CONFIDENCE_EMPTY_STATE,
  RESPONSE_CONFIDENCE_FACTOR_KEYS,
  aggregateThreadSignals,
  type ResponseConfidenceFactorKey,
  type ResponseConfidenceRollup,
} from "@/lib/thread-self-report";

export function FamiliarAnalyticsView({ familiarId }: { familiarId: string }) {
  const [data, setData] = useState<FamiliarAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await loadFamiliarAnalyticsData(familiarId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "analytics data unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [familiarId]);

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
        <EmptyState compact icon="ph:users-three-bold" headline="No familiar analytics available." />
      )}
    </main>
  );
}

/** Section shell — shared head (title + count) wrapper used by every panel. */
function FaSection({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="fa-section" aria-labelledby={`${id}-title`}>
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
    <FaSection id="fa-confidence" title="Confidence Breakdown" count={`${confidence.factors.length} factors`}>
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

const ResponseConfidenceSection = memo(function ResponseConfidenceSection({
  rollup,
}: {
  rollup: ResponseConfidenceRollup;
}) {
  if (rollup.eventCount === 0) {
    return <EmptyState compact icon="ph:chart-bar-bold" headline={RESPONSE_CONFIDENCE_EMPTY_STATE} />;
  }

  return (
    <div className="fa-response-confidence">
      <div className="fa-thread-score-grid">
        <ScoreTile label="Avg confidence" value={rollup.averageConfidence} />
        <ScoreTile label="Low confidence" value={rollup.lowConfidenceCount} />
        <ScoreTile label="Events" value={rollup.eventCount} />
        <ScoreTile label="Newest" value={rollup.newestEvent?.overallConfidence ?? 0} />
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
    return <EmptyState compact icon="ph:check-circle-bold" headline="No self-heal requests." />;
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
  return (
    <FaSection id="fa-contract" title="Contract Compliance" count={report?.pass ? "passing" : "needs review"}>
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
        <EmptyState compact icon="ph:file-text" headline="No contract report available." />
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

type Kpi = { key: string; icon: Parameters<typeof Icon>[0]["name"]; label: string; value: string; sub: string; tone?: "good" | "warn" | "bad" };

/** Derive the at-a-glance KPI tiles from the model's (otherwise buried) signals. */
function deriveKpis(model: FamiliarAnalyticsModel, healRequestCount: number): Kpi[] {
  const growth = model.growthReport;
  const contract = model.contractReport;
  const contractPass = contract ? contract.properties.filter((p) => p.pass).length : 0;
  const contractTotal = contract ? contract.properties.length : 0;
  const acceptRate = growth?.retroAcceptRate ?? null;
  const evals = model.evalLoopState?.iterations?.length ?? 0;

  return [
    {
      key: "activity",
      icon: "ph:lightning-bold",
      label: "Activity",
      value: growth ? growth.healthLabel : "—",
      sub: growth ? `${growth.sessionsLast7d} session${growth.sessionsLast7d === 1 ? "" : "s"} · 7d` : "no data",
      tone: growth?.healthLabel === "stalled" ? "bad" : growth?.healthLabel === "quiet" ? "warn" : "good",
    },
    {
      key: "evals",
      icon: "ph:arrows-clockwise-bold",
      label: "Eval acceptance",
      value: acceptRate == null ? "—" : `${Math.round(acceptRate * 100)}%`,
      sub: `${evals} iteration${evals === 1 ? "" : "s"}`,
      tone: acceptRate == null ? undefined : acceptRate >= 0.6 ? "good" : acceptRate >= 0.3 ? "warn" : "bad",
    },
    {
      key: "contract",
      icon: "ph:check-circle-bold",
      label: "Contract",
      value: contractTotal ? `${contractPass}/${contractTotal}` : "—",
      sub: contract ? (contract.pass ? "passing" : "needs review") : "no report",
      tone: !contractTotal ? undefined : contract?.pass ? "good" : "warn",
    },
    {
      key: "heal",
      icon: "ph:wrench-bold",
      label: "Self-heal",
      value: String(healRequestCount),
      sub: healRequestCount === 0 ? "all clear" : healRequestCount === 1 ? "open request" : "open requests",
      tone: healRequestCount === 0 ? "good" : "warn",
    },
    {
      key: "signals",
      icon: "ph:waveform-bold",
      label: "Thread signals",
      value: String(model.threadReports.length),
      sub: model.threadReports.length === 1 ? "report" : "reports",
    },
  ];
}

/** Scannable KPI row — surfaces growth, eval, contract, and heal signals up top. */
const FamiliarKpis = memo(function FamiliarKpis({
  model,
  healRequestCount,
}: {
  model: FamiliarAnalyticsModel;
  healRequestCount: number;
}) {
  const kpis = deriveKpis(model, healRequestCount);
  return (
    <div className="fa-kpis" role="list" aria-label="Key metrics">
      {kpis.map((kpi) => (
        <div key={kpi.key} className={`fa-kpi${kpi.tone ? ` fa-kpi--${kpi.tone}` : ""}`} role="listitem">
          <div className="fa-kpi__head">
            <Icon name={kpi.icon} aria-hidden />
            <span className="fa-kpi__label">{kpi.label}</span>
          </div>
          <strong className="fa-kpi__value">{kpi.value}</strong>
          <span className="fa-kpi__sub">{kpi.sub}</span>
        </div>
      ))}
    </div>
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
              Familiar Analytics
            </p>
            <h1>{familiarName}</h1>
            <p>{familiarRole}</p>
          </div>
        </div>
        <ConfidenceRing confidence={model.confidence} />
      </header>

      <FamiliarKpis model={model} healRequestCount={healRequests.length} />

      <ConfidenceBreakdown confidence={model.confidence} />

      <FaSection
        id="fa-response-confidence"
        title="Response Confidence"
        count={`${model.responseConfidenceRollup.eventCount} ${model.responseConfidenceRollup.eventCount === 1 ? "event" : "events"}`}
      >
        <ResponseConfidenceSection rollup={model.responseConfidenceRollup} />
      </FaSection>

      <FaSection
        id="fa-heal"
        title="Self-Heal Requests"
        count={`${healRequests.length} ${healRequests.length === 1 ? "request" : "requests"}`}
      >
        <SelfHealList requests={healRequests} />
      </FaSection>

      <FaSection
        id="fa-thread-signals"
        title="Thread Signals"
        count={`${model.threadReports.length} ${model.threadReports.length === 1 ? "report" : "reports"}`}
      >
        <ThreadSignalsSection familiarId={model.familiarId} reports={model.threadReports} />
      </FaSection>

      <FaSection id="fa-eval" title="Eval Loop" count={`${model.evalLoopState?.iterations?.length ?? 0} iterations`}>
        {model.familiar ? (
          <EvalLoopPanel
            familiarId={model.familiar.id}
            familiarName={familiarName}
            responseConfidenceRollup={model.responseConfidenceRollup}
          />
        ) : (
          <EmptyState compact icon="ph:arrows-clockwise-bold" headline="Eval loop unavailable." />
        )}
      </FaSection>

      <ContractCompliance report={model.contractReport} />
    </>
  );
}
