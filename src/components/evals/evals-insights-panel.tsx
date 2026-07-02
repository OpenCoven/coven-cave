"use client";

import { useMemo } from "react";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { suitePassRateTrend, failureClusters } from "@/lib/evals/eval-analytics";
import type { EvalRun, EvalSuite } from "@/lib/evals/eval-model";

/**
 * Insights tab body. Shows, for the selected suite's run history: a pass-rate
 * trend (with the SLA floor as a threshold line + a breach/ok badge) and a
 * failure-frequency bar with a flaky-case list. Empty until the suite has runs.
 */
export function EvalsInsightsPanel({ suite, runs }: { suite: EvalSuite | null; runs: EvalRun[] }) {
  const suiteRuns = useMemo(
    () => (suite ? runs.filter((r) => r.suiteId === suite.id) : runs),
    [suite, runs],
  );
  const trend = useMemo(() => suitePassRateTrend(suiteRuns), [suiteRuns]);
  const clusters = useMemo(() => failureClusters(suiteRuns), [suiteRuns]);

  if (suiteRuns.length === 0) {
    return <div className="evals-empty">No runs yet — run a suite to see trends and failure analysis.</div>;
  }

  const sla = suite?.slaMinPassRate;
  const latest = trend.length ? trend[trend.length - 1].y : null;
  const breached = sla != null && latest != null && latest < sla;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const failBars = clusters.byCase
    .filter((c) => c.failures > 0)
    .slice(0, 8)
    .map((c) => ({ caseId: c.caseId, label: c.name, failures: c.failures, runs: c.runs }));
  const maxFailures = Math.max(1, ...failBars.map((c) => c.failures));

  return (
    <div className="evals-insights">
      <section className="evals-insights__card">
        <div className="evals-insights__head">
          <span className="evals-insights__title">Pass rate over time</span>
          {sla != null ? (
            breached ? (
              <span className="evals-insights__breach">SLA breach · {pct(latest!)} &lt; {pct(sla)}</span>
            ) : (
              <span className="evals-insights__ok">Meets SLA · {pct(sla)}</span>
            )
          ) : null}
        </div>
        <TrendChart
          series={[{ id: suite?.id ?? "all", label: "Pass rate", color: "var(--accent-presence)", points: trend }]}
          threshold={sla}
          height={160}
        />
      </section>

      {failBars.length > 0 ? (
        <section className="evals-insights__card">
          <div className="evals-insights__head">
            <span className="evals-insights__title">Failures by case</span>
          </div>
          {/* Labeled horizontal bars — with only a handful of categories, the
              unlabeled SVG bar chart read as a solid color block. Real text
              rows (name · count · proportional track) stay legible at any
              count and are screen-reader accessible. */}
          <ul className="evals-fail-bars">
            {failBars.map((c) => (
              <li key={c.caseId} className="evals-fail-bar">
                <span className="evals-fail-bar__name" title={c.label}>{c.label}</span>
                <span className="evals-fail-bar__count">
                  {c.failures}/{c.runs} run{c.runs === 1 ? "" : "s"}
                </span>
                <span className="evals-fail-bar__track" aria-hidden>
                  <span
                    className="evals-fail-bar__fill"
                    style={{ width: `${(c.failures / maxFailures) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {clusters.byCase.some((c) => c.flaky) ? (
        <section className="evals-insights__card">
          <div className="evals-insights__head">
            <span className="evals-insights__title">Flaky cases</span>
          </div>
          <ul className="evals-insights__flaky">
            {clusters.byCase
              .filter((c) => c.flaky)
              .map((c) => (
                <li key={c.caseId}>
                  <b>{c.name}</b>
                  <span>
                    {c.failures}/{c.runs} failed
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
