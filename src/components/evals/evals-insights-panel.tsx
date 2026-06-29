"use client";

import { useMemo } from "react";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { BarChart } from "@/components/ui/charts/bar-chart";
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
    .map((c) => ({ label: c.name, value: c.failures, color: "var(--color-danger)" }));

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
          <BarChart data={failBars} height={150} />
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
