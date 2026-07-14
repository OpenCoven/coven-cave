import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveThreadConfidence,
  threadConfidenceLabel,
  THREAD_CONFIDENCE_EMPTY_STATE,
  THREAD_METRIC_KEYS,
  THREAD_METRIC_WEIGHTS,
} from "./thread-confidence.ts";
import { deriveThreadScore, type ThreadSelfReport } from "./thread-self-report.ts";

function report(over: Partial<ThreadSelfReport> = {}): ThreadSelfReport {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    familiarId: "cody",
    sessionId: "session-1",
    reportedAt: "2026-06-25T12:00:00.000Z",
    overallConfidence: 80,
    toolReliability: { score: 70, failedTools: [], unreliableTools: [] },
    contextPressure: "adequate",
    skillsUsed: [],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesLacking: [],
    capabilitiesVital: [],
    memoryRecallScore: 65,
    fileLocatabilityScore: 60,
    persistentBlockers: [],
    ...over,
  };
}

describe("deriveThreadConfidence", () => {
  it("is explicitly unmeasured with no reports — never a fake Low", () => {
    const confidence = deriveThreadConfidence([]);
    assert.equal(confidence.hasData, false);
    assert.equal(confidence.score, 0);
    assert.equal(confidence.reportCount, 0);
    assert.equal(confidence.metrics.length, 4);
    assert.ok(confidence.metrics.every((metric) => metric.value === 0));
  });

  it("weights the four metric averages exactly like deriveThreadScore", () => {
    const single = report();
    const confidence = deriveThreadConfidence([single]);
    assert.equal(confidence.hasData, true);
    assert.equal(confidence.reportCount, 1);
    assert.equal(confidence.score, deriveThreadScore(single));
    // 80*.35 + 70*.25 + 65*.2 + 60*.2 = 70.5 → 71
    assert.equal(confidence.score, 71);
    assert.equal(confidence.label, "Reliable");
  });

  it("averages metric values across reports", () => {
    const confidence = deriveThreadConfidence([
      report({ overallConfidence: 100, toolReliability: { score: 100, failedTools: [], unreliableTools: [] }, memoryRecallScore: 100, fileLocatabilityScore: 100 }),
      report({ overallConfidence: 60, toolReliability: { score: 40, failedTools: [], unreliableTools: [] }, memoryRecallScore: 20, fileLocatabilityScore: 0 }),
    ]);
    const byKey = Object.fromEntries(confidence.metrics.map((metric) => [metric.key, metric.value]));
    assert.equal(byKey.confidence, 80);
    assert.equal(byKey.toolReliability, 70);
    assert.equal(byKey.memoryRecall, 60);
    assert.equal(byKey.fileLocatability, 50);
    // 80*.35 + 70*.25 + 60*.2 + 50*.2 = 67.5 → 68
    assert.equal(confidence.score, 68);
  });

  it("clamps out-of-range and non-finite metric values", () => {
    const confidence = deriveThreadConfidence([
      report({
        overallConfidence: 250,
        toolReliability: { score: -40, failedTools: [], unreliableTools: [] },
        memoryRecallScore: Number.NaN,
        fileLocatabilityScore: 100,
      }),
    ]);
    const byKey = Object.fromEntries(confidence.metrics.map((metric) => [metric.key, metric.value]));
    assert.equal(byKey.confidence, 100);
    assert.equal(byKey.toolReliability, 0);
    assert.equal(byKey.memoryRecall, 0);
    assert.equal(byKey.fileLocatability, 100);
  });

  it("carries the context-pressure mix through", () => {
    const confidence = deriveThreadConfidence([
      report({ contextPressure: "critical" }),
      report({ contextPressure: "tight" }),
      report({ contextPressure: "adequate" }),
    ]);
    assert.deepEqual(confidence.contextCounts, { adequate: 1, tight: 1, excess: 0, critical: 1 });
  });

  it("keeps metric weights normalized (they sum to 1) and in declared order", () => {
    const total = THREAD_METRIC_KEYS.reduce((sum, key) => sum + THREAD_METRIC_WEIGHTS[key], 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    const confidence = deriveThreadConfidence([report()]);
    assert.deepEqual(confidence.metrics.map((metric) => metric.key), THREAD_METRIC_KEYS);
  });
});

describe("threadConfidenceLabel", () => {
  it("uses the established tier thresholds", () => {
    assert.equal(threadConfidenceLabel(0), "Low");
    assert.equal(threadConfidenceLabel(39), "Low");
    assert.equal(threadConfidenceLabel(40), "Developing");
    assert.equal(threadConfidenceLabel(60), "Reliable");
    assert.equal(threadConfidenceLabel(80), "Trusted");
    assert.equal(threadConfidenceLabel(100), "Trusted");
  });
});

describe("empty-state copy", () => {
  it("teaches enabling self-reporting, matching the response-confidence pattern", () => {
    assert.match(THREAD_CONFIDENCE_EMPTY_STATE, /Enable response self-reporting/);
  });
});
