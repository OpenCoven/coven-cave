import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketSnapshots,
  deriveSignalTrends,
  isThreadMetricSnapshot,
  pickTrendGranularity,
  snapshotFromReport,
  TREND_DAY_WINDOW,
  TREND_FLAT_THRESHOLD,
  TREND_WEEK_WINDOW,
  type ThreadMetricSnapshot,
} from "./signal-trends.ts";
import type { ThreadSelfReport } from "./thread-self-report.ts";

// Fixed clock: Thursday 2026-06-25T20:00Z. All expectations derive from it.
const NOW = Date.parse("2026-06-25T20:00:00.000Z");

function snapshot(over: Partial<ThreadMetricSnapshot> = {}): ThreadMetricSnapshot {
  return {
    id: over.id ?? `snap-${Math.random().toString(36).slice(2)}`,
    sessionId: "session-1",
    reportedAt: "2026-06-25T12:00:00.000Z",
    confidence: 80,
    toolReliability: 70,
    memoryRecall: 60,
    fileLocatability: 50,
    contextPressure: "adequate",
    ...over,
  };
}

describe("snapshotFromReport", () => {
  it("reduces a report to its clamped metric snapshot keyed by reflection time", () => {
    const report: ThreadSelfReport = {
      id: "r1",
      familiarId: "cody",
      sessionId: "s1",
      reportedAt: "2026-06-24T09:30:00.000Z",
      overallConfidence: 120,
      toolReliability: { score: -5, failedTools: ["gh"], unreliableTools: [] },
      contextPressure: "tight",
      skillsUsed: ["deploy"],
      skillsNeedingClarity: [],
      skillsNeedingAccess: [],
      capabilitiesLacking: [],
      capabilitiesVital: [],
      memoryRecallScore: 66.6,
      fileLocatabilityScore: Number.NaN,
      persistentBlockers: [],
    };
    const snap = snapshotFromReport(report);
    assert.deepEqual(snap, {
      id: "r1",
      sessionId: "s1",
      reportedAt: "2026-06-24T09:30:00.000Z",
      confidence: 100,
      toolReliability: 0,
      memoryRecall: 67,
      fileLocatability: 0,
      contextPressure: "tight",
    });
    assert.ok(isThreadMetricSnapshot(snap));
  });

  it("guards malformed persisted lines", () => {
    assert.equal(isThreadMetricSnapshot(null), false);
    assert.equal(isThreadMetricSnapshot({ id: "x" }), false);
    assert.equal(isThreadMetricSnapshot({ ...snapshot(), confidence: "high" }), false);
  });
});

describe("pickTrendGranularity", () => {
  it("stays daily while every snapshot fits the 14-day window", () => {
    const inWindow = snapshot({ reportedAt: "2026-06-12T00:00:00.000Z" }); // day 1 of 14
    assert.equal(pickTrendGranularity([inWindow], NOW), "day");
  });

  it("switches to weekly once history predates the day window", () => {
    const older = snapshot({ reportedAt: "2026-06-11T23:59:00.000Z" });
    assert.equal(pickTrendGranularity([older], NOW), "week");
  });
});

describe("bucketSnapshots", () => {
  it("builds a fixed 14-day window, oldest first, keeping empty buckets", () => {
    const buckets = bucketSnapshots([snapshot()], "day", NOW);
    assert.equal(buckets.length, TREND_DAY_WINDOW);
    assert.equal(buckets[0].key, "2026-06-12");
    assert.equal(buckets.at(-1)!.key, "2026-06-25");
    assert.equal(buckets.at(-1)!.count, 1);
    assert.equal(buckets.at(-1)!.averages.confidence, 80);
    // 80*.35 + 70*.25 + 60*.2 + 50*.2 = 67.5 → 68
    assert.equal(buckets.at(-1)!.score, 68);
    assert.equal(buckets[0].count, 0);
    assert.equal(buckets[0].averages.confidence, null);
    assert.equal(buckets[0].score, null);
  });

  it("averages within a bucket and drops out-of-window or unparsable snapshots", () => {
    const buckets = bucketSnapshots(
      [
        snapshot({ reportedAt: "2026-06-25T01:00:00.000Z", confidence: 90 }),
        snapshot({ reportedAt: "2026-06-25T23:00:00.000Z", confidence: 70 }),
        snapshot({ reportedAt: "2026-06-01T00:00:00.000Z", confidence: 10 }), // before window
        snapshot({ reportedAt: "not-a-date", confidence: 10 }),
      ],
      "day",
      NOW,
    );
    assert.equal(buckets.at(-1)!.count, 2);
    assert.equal(buckets.at(-1)!.averages.confidence, 80);
    assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 2);
  });

  it("weekly buckets start on UTC Mondays across an 8-week window", () => {
    const buckets = bucketSnapshots([snapshot()], "week", NOW);
    assert.equal(buckets.length, TREND_WEEK_WINDOW);
    // 2026-06-25 is a Thursday; its week starts Monday 2026-06-22.
    assert.equal(buckets.at(-1)!.key, "2026-06-22");
    assert.equal(buckets[0].key, "2026-05-04");
    assert.match(buckets.at(-1)!.label, /^wk /);
    assert.ok(buckets.every((bucket) => new Date(`${bucket.key}T00:00:00.000Z`).getUTCDay() === 1));
  });
});

describe("deriveSignalTrends", () => {
  it("answers improving when the latest data bucket clears the threshold", () => {
    const trends = deriveSignalTrends(
      [
        snapshot({ reportedAt: "2026-06-20T12:00:00.000Z", confidence: 60, toolReliability: 60, memoryRecall: 60, fileLocatability: 60 }),
        snapshot({ reportedAt: "2026-06-25T12:00:00.000Z", confidence: 80, toolReliability: 80, memoryRecall: 80, fileLocatability: 80 }),
      ],
      NOW,
    );
    assert.equal(trends.granularity, "day");
    assert.equal(trends.snapshotCount, 2);
    assert.equal(trends.overall.latest, 80);
    assert.equal(trends.overall.previous, 60);
    assert.equal(trends.overall.delta, 20);
    assert.equal(trends.overall.direction, "improving");
    assert.ok(trends.metrics.every((metric) => metric.direction === "improving"));
  });

  it("answers regressing on a drop, comparing the two most recent data buckets", () => {
    const trends = deriveSignalTrends(
      [
        snapshot({ reportedAt: "2026-06-15T12:00:00.000Z", confidence: 90, toolReliability: 90, memoryRecall: 90, fileLocatability: 90 }),
        snapshot({ reportedAt: "2026-06-20T12:00:00.000Z", confidence: 80, toolReliability: 80, memoryRecall: 80, fileLocatability: 80 }),
        snapshot({ reportedAt: "2026-06-25T12:00:00.000Z", confidence: 70, toolReliability: 70, memoryRecall: 70, fileLocatability: 70 }),
      ],
      NOW,
    );
    // Latest (70) vs closest earlier data bucket (80) — not the oldest (90).
    assert.equal(trends.overall.latest, 70);
    assert.equal(trends.overall.previous, 80);
    assert.equal(trends.overall.direction, "regressing");
  });

  it("calls jitter flat — small deltas never become a verdict", () => {
    const trends = deriveSignalTrends(
      [
        snapshot({ reportedAt: "2026-06-20T12:00:00.000Z", confidence: 70, toolReliability: 70, memoryRecall: 70, fileLocatability: 70 }),
        snapshot({ reportedAt: "2026-06-25T12:00:00.000Z", confidence: 70 + TREND_FLAT_THRESHOLD - 1, toolReliability: 70, memoryRecall: 70, fileLocatability: 70 }),
      ],
      NOW,
    );
    assert.equal(trends.overall.direction, "flat");
    const confidence = trends.metrics.find((metric) => metric.key === "confidence")!;
    assert.equal(confidence.delta, TREND_FLAT_THRESHOLD - 1);
    assert.equal(confidence.direction, "flat");
  });

  it("is honest about insufficient history (fewer than two data buckets)", () => {
    const single = deriveSignalTrends([snapshot()], NOW);
    assert.equal(single.overall.direction, "insufficient");
    assert.equal(single.overall.delta, null);
    assert.ok(single.metrics.every((metric) => metric.direction === "insufficient"));

    const none = deriveSignalTrends([], NOW);
    assert.equal(none.snapshotCount, 0);
    assert.equal(none.overall.direction, "insufficient");
  });

  it("two reports inside ONE bucket stay insufficient — a trend needs time between points", () => {
    const trends = deriveSignalTrends(
      [
        snapshot({ reportedAt: "2026-06-25T09:00:00.000Z", confidence: 40, toolReliability: 40, memoryRecall: 40, fileLocatability: 40 }),
        snapshot({ reportedAt: "2026-06-25T18:00:00.000Z", confidence: 90, toolReliability: 90, memoryRecall: 90, fileLocatability: 90 }),
      ],
      NOW,
    );
    assert.equal(trends.overall.direction, "insufficient");
  });

  it("auto-selects weekly for long histories and honors a forced granularity", () => {
    const spread = [
      snapshot({ reportedAt: "2026-05-06T12:00:00.000Z", confidence: 50, toolReliability: 50, memoryRecall: 50, fileLocatability: 50 }),
      snapshot({ reportedAt: "2026-06-24T12:00:00.000Z", confidence: 70, toolReliability: 70, memoryRecall: 70, fileLocatability: 70 }),
    ];
    const auto = deriveSignalTrends(spread, NOW);
    assert.equal(auto.granularity, "week");
    assert.equal(auto.overall.direction, "improving");

    const forcedDaily = deriveSignalTrends(spread, NOW, "day");
    assert.equal(forcedDaily.granularity, "day");
    // The May snapshot falls outside the 14-day window → one data bucket.
    assert.equal(forcedDaily.snapshotCount, 1);
    assert.equal(forcedDaily.overall.direction, "insufficient");
  });
});
