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
import { aggregateThreadSignals } from "@/lib/thread-self-report";

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
        <div className="fa-score-circle" aria-label={`Confidence score ${model.confidence.score}, ${model.confidence.label}`}>
          <strong>{model.confidence.score}</strong>
          <span>{model.confidence.label}</span>
        </div>
      </header>

      <ConfidenceBreakdown confidence={model.confidence} />

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
          <EvalLoopPanel familiarId={model.familiar.id} familiarName={familiarName} />
        ) : (
          <EmptyState compact icon="ph:arrows-clockwise-bold" headline="Eval loop unavailable." />
        )}
      </FaSection>

      <ContractCompliance report={model.contractReport} />
    </>
  );
}
