// Signal trends — "is the familiar improving?" answered from per-thread
// metric snapshots keyed by reflection time. Pure: bucketing, deltas, and
// direction verdicts all take an explicit clock so tests are deterministic.
//
// Snapshots are the compact persisted form of a thread self-report's metrics
// (see snapshotFromReport). The server appends one per report
// (src/lib/server/familiar-self-reports.ts) and backfills legacy reports that
// predate snapshot persistence, so old data always loads.

import type { ContextPressure, ThreadSelfReport } from "@/lib/thread-self-report";
import { THREAD_METRIC_KEYS, THREAD_METRIC_WEIGHTS, type ThreadMetricKey } from "@/lib/thread-confidence";

/** Compact metric snapshot of one thread self-report, keyed by reflection time. */
export type ThreadMetricSnapshot = {
  /** The source report's id — the dedupe key across persisted + backfilled rows. */
  id: string;
  sessionId: string;
  /** Reflection time — the trend x-axis. */
  reportedAt: string;
  confidence: number;
  toolReliability: number;
  memoryRecall: number;
  fileLocatability: number;
  contextPressure: ContextPressure;
};

export type TrendGranularity = "day" | "week";

export type TrendBucket = {
  /** Stable key: day "2026-06-25" or week start "2026-06-22" (Monday, UTC). */
  key: string;
  /** Short human label: "Jun 25" or "wk Jun 22". */
  label: string;
  /** Snapshots that landed in this bucket. */
  count: number;
  /** Per-metric averages; null when the bucket has no snapshots. */
  averages: Record<ThreadMetricKey, number | null>;
  /** Weighted headline score for the bucket (THREAD_METRIC_WEIGHTS); null when empty. */
  score: number | null;
};

export type TrendDirection = "improving" | "flat" | "regressing" | "insufficient";

export type MetricTrend = {
  key: ThreadMetricKey;
  /** Average in the most recent bucket with data. */
  latest: number | null;
  /** Average in the closest earlier bucket with data. */
  previous: number | null;
  /** latest − previous; null until two buckets have data. */
  delta: number | null;
  direction: TrendDirection;
};

export type SignalTrends = {
  granularity: TrendGranularity;
  /** Oldest → newest, spanning the full window (empty buckets included). */
  buckets: TrendBucket[];
  /** Per-metric verdicts, in THREAD_METRIC_KEYS order. */
  metrics: MetricTrend[];
  /** Verdict on the weighted headline score — the one-word answer. */
  overall: Omit<MetricTrend, "key">;
  /** Snapshots that actually landed in the window. */
  snapshotCount: number;
};

/** Day buckets shown when all data is recent; week buckets otherwise. */
export const TREND_DAY_WINDOW = 14;
export const TREND_WEEK_WINDOW = 8;

/**
 * Honest verdict thresholds: a direction is only called when two buckets have
 * data AND the change clears the noise floor — self-reported 0–100 scores
 * jitter a few points between threads, so ±4 reads as flat, not a trend.
 */
export const TREND_FLAT_THRESHOLD = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Reduce a full self-report to its persisted metric snapshot. */
export function snapshotFromReport(report: ThreadSelfReport): ThreadMetricSnapshot {
  return {
    id: report.id,
    sessionId: report.sessionId,
    reportedAt: report.reportedAt,
    confidence: clampScore(report.overallConfidence),
    toolReliability: clampScore(report.toolReliability.score),
    memoryRecall: clampScore(report.memoryRecallScore),
    fileLocatability: clampScore(report.fileLocatabilityScore),
    contextPressure: report.contextPressure,
  };
}

const CONTEXT_PRESSURE_VALUES: ReadonlySet<string> = new Set(["adequate", "tight", "excess", "critical"]);

/** Runtime guard for snapshot lines read back from append-only storage. */
export function isThreadMetricSnapshot(value: unknown): value is ThreadMetricSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.reportedAt === "string" &&
    Number.isFinite(Date.parse(candidate.reportedAt)) &&
    typeof candidate.contextPressure === "string" &&
    CONTEXT_PRESSURE_VALUES.has(candidate.contextPressure) &&
    Number.isFinite(candidate.confidence) &&
    Number.isFinite(candidate.toolReliability) &&
    Number.isFinite(candidate.memoryRecall) &&
    Number.isFinite(candidate.fileLocatability)
  );
}

const METRIC_FIELD: Record<ThreadMetricKey, keyof Pick<ThreadMetricSnapshot, "confidence" | "toolReliability" | "memoryRecall" | "fileLocatability">> = {
  confidence: "confidence",
  toolReliability: "toolReliability",
  memoryRecall: "memoryRecall",
  fileLocatability: "fileLocatability",
};

/** UTC start-of-day for a timestamp. */
function dayStartUtc(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** UTC start of the ISO week (Monday) containing a timestamp. */
function weekStartUtc(ms: number): number {
  const dayStart = dayStartUtc(ms);
  const weekday = new Date(dayStart).getUTCDay(); // 0 Sun … 6 Sat
  const sinceMonday = (weekday + 6) % 7;
  return dayStart - sinceMonday * DAY_MS;
}

function bucketKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function bucketLabel(ms: number, granularity: TrendGranularity): string {
  const date = new Date(ms);
  const monthDay = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return granularity === "week" ? `wk ${monthDay}` : monthDay;
}

/**
 * Pick the granularity the data can honestly fill: day buckets while every
 * snapshot fits the 14-day day window; week buckets once history is longer.
 */
export function pickTrendGranularity(snapshots: ThreadMetricSnapshot[], now: number): TrendGranularity {
  const windowStart = dayStartUtc(now) - (TREND_DAY_WINDOW - 1) * DAY_MS;
  const anyOlder = snapshots.some((snapshot) => {
    const ms = Date.parse(snapshot.reportedAt);
    return Number.isFinite(ms) && ms < windowStart;
  });
  return anyOlder ? "week" : "day";
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function weightedScore(averages: Record<ThreadMetricKey, number | null>): number | null {
  let score = 0;
  for (const key of THREAD_METRIC_KEYS) {
    const value = averages[key];
    if (value === null) return null;
    score += value * THREAD_METRIC_WEIGHTS[key];
  }
  return Math.round(score);
}

/**
 * Bucket snapshots into a fixed trailing window ending at `now` (oldest →
 * newest, empty buckets kept so sparklines show gaps honestly). Snapshots
 * outside the window or with unparsable timestamps are dropped.
 */
export function bucketSnapshots(
  snapshots: ThreadMetricSnapshot[],
  granularity: TrendGranularity,
  now: number,
): TrendBucket[] {
  const bucketCount = granularity === "day" ? TREND_DAY_WINDOW : TREND_WEEK_WINDOW;
  const bucketMs = granularity === "day" ? DAY_MS : 7 * DAY_MS;
  const newestStart = granularity === "day" ? dayStartUtc(now) : weekStartUtc(now);
  const starts = Array.from({ length: bucketCount }, (_, index) => newestStart - (bucketCount - 1 - index) * bucketMs);
  const windowStart = starts[0];

  const grouped = new Map<number, ThreadMetricSnapshot[]>();
  for (const snapshot of snapshots) {
    const ms = Date.parse(snapshot.reportedAt);
    if (!Number.isFinite(ms) || ms < windowStart || ms >= newestStart + bucketMs) continue;
    const start = windowStart + Math.floor((ms - windowStart) / bucketMs) * bucketMs;
    const bucket = grouped.get(start);
    if (bucket) bucket.push(snapshot);
    else grouped.set(start, [snapshot]);
  }

  return starts.map((start) => {
    const members = grouped.get(start) ?? [];
    const averages = {} as Record<ThreadMetricKey, number | null>;
    for (const key of THREAD_METRIC_KEYS) {
      averages[key] = average(members.map((snapshot) => clampScore(snapshot[METRIC_FIELD[key]])));
    }
    return {
      key: bucketKey(start),
      label: bucketLabel(start, granularity),
      count: members.length,
      averages,
      score: weightedScore(averages),
    };
  });
}

function directionFor(latest: number | null, previous: number | null): TrendDirection {
  if (latest === null || previous === null) return "insufficient";
  const delta = latest - previous;
  if (Math.abs(delta) < TREND_FLAT_THRESHOLD) return "flat";
  return delta > 0 ? "improving" : "regressing";
}

function trendFrom(series: (number | null)[]): Omit<MetricTrend, "key"> {
  const withData = series
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => entry.value !== null);
  const latest = withData.at(-1)?.value ?? null;
  const previous = withData.length >= 2 ? withData[withData.length - 2].value : null;
  const delta = latest !== null && previous !== null ? latest - previous : null;
  return { latest, previous, delta, direction: directionFor(latest, previous) };
}

/**
 * The full trend read: buckets + per-metric verdicts + the overall answer.
 * Granularity auto-selects unless forced. Directions compare the most recent
 * bucket with data against the closest earlier bucket with data; fewer than
 * two data buckets → "insufficient" rather than a made-up verdict.
 */
export function deriveSignalTrends(
  snapshots: ThreadMetricSnapshot[],
  now: number,
  granularity?: TrendGranularity,
): SignalTrends {
  const resolved = granularity ?? pickTrendGranularity(snapshots, now);
  const buckets = bucketSnapshots(snapshots, resolved, now);
  const metrics = THREAD_METRIC_KEYS.map((key) => ({
    key,
    ...trendFrom(buckets.map((bucket) => bucket.averages[key])),
  }));
  const overall = trendFrom(buckets.map((bucket) => bucket.score));

  return {
    granularity: resolved,
    buckets,
    metrics,
    overall,
    snapshotCount: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
  };
}
