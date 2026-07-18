// The headline confidence for familiar analytics AND the dashboard cockpit,
// derived from real thread self-reports (via aggregateThreadSignals) — the
// synthetic factor weights that used to live in familiar-confidence.ts are
// gone. Metric weights match deriveThreadScore so the aggregate score and
// each report's own score read on one scale.

import {
  aggregateThreadSignals,
  type ContextPressure,
  type ThreadSelfReport,
} from "@/lib/thread-self-report";

export type ThreadMetricKey = "confidence" | "toolReliability" | "memoryRecall" | "fileLocatability";

export type ThreadMetric = {
  key: ThreadMetricKey;
  label: string;
  /** Average across reports, clamped to 0–100. */
  value: number;
  /** Weighting coefficient (0–1), not a fixed share of the result: the metric
   *  contributes value × weight points — so at most weight × 100 — to the
   *  headline score. */
  weight: number;
};

export type ThreadConfidenceLabel = "Low" | "Developing" | "Reliable" | "Trusted";

export type ThreadConfidence = {
  /** Weighted 0–100 score across reports; 0 when there are no reports. */
  score: number;
  label: ThreadConfidenceLabel;
  /** Thread self-reports backing the score. */
  reportCount: number;
  /** False = no reports yet; the score is unmeasured, not "low". */
  hasData: boolean;
  /** The averaged metrics behind the score, in weight order. */
  metrics: ThreadMetric[];
  /** Context-pressure mix across reports. */
  contextCounts: Record<ContextPressure, number>;
};

/** Same weights as deriveThreadScore (per-report score) — one scale everywhere. */
export const THREAD_METRIC_WEIGHTS: Record<ThreadMetricKey, number> = {
  confidence: 0.35,
  toolReliability: 0.25,
  memoryRecall: 0.2,
  fileLocatability: 0.2,
};

export const THREAD_METRIC_LABELS: Record<ThreadMetricKey, string> = {
  confidence: "Avg confidence",
  toolReliability: "Tool reliability",
  memoryRecall: "Memory recall",
  fileLocatability: "File-finding",
};

export const THREAD_METRIC_KEYS: ThreadMetricKey[] = [
  "confidence",
  "toolReliability",
  "memoryRecall",
  "fileLocatability",
];

export const THREAD_CONFIDENCE_EMPTY_STATE =
  "No thread analysis yet. Enable response self-reporting to measure confidence from real threads.";

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function threadConfidenceLabel(score: number): ThreadConfidenceLabel {
  if (score >= 80) return "Trusted";
  if (score >= 60) return "Reliable";
  if (score >= 40) return "Developing";
  return "Low";
}

/**
 * Aggregate thread self-reports into the page's headline confidence: the four
 * self-reported metric averages, weighted into one 0–100 score, plus the
 * context-pressure mix. With no reports the result is explicitly unmeasured
 * (hasData false, score 0) — never a fake "Low".
 */
export function deriveThreadConfidence(reports: ThreadSelfReport[]): ThreadConfidence {
  const aggregate = aggregateThreadSignals(reports);
  const values: Record<ThreadMetricKey, number> = {
    confidence: clampScore(aggregate.averageConfidence),
    toolReliability: clampScore(aggregate.averageToolReliability),
    memoryRecall: clampScore(aggregate.averageMemoryRecall),
    fileLocatability: clampScore(aggregate.averageFileLocatability),
  };
  const metrics: ThreadMetric[] = THREAD_METRIC_KEYS.map((key) => ({
    key,
    label: THREAD_METRIC_LABELS[key],
    value: values[key],
    weight: THREAD_METRIC_WEIGHTS[key],
  }));
  const hasData = reports.length > 0;
  const score = hasData
    ? clampScore(metrics.reduce((sum, metric) => sum + metric.value * metric.weight, 0))
    : 0;

  return {
    score,
    label: threadConfidenceLabel(score),
    reportCount: reports.length,
    hasData,
    metrics,
    contextCounts: aggregate.contextCounts,
  };
}
