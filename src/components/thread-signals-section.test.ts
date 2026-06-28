import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { aggregateThreadSignals, buildThreadSignalReviewQueue, THREAD_SIGNALS_EMPTY_STATE } from "@/lib/thread-self-report";
import type { ThreadSelfReport } from "@/lib/thread-self-report";

const source = readFileSync(new URL("./thread-signals-section.tsx", import.meta.url), "utf8");

function report(overrides: Partial<ThreadSelfReport> & { id: string }): ThreadSelfReport {
  return {
    familiarId: "echo",
    sessionId: overrides.id,
    reportedAt: overrides.reportedAt ?? "2026-06-25T12:00:00.000Z",
    overallConfidence: overrides.overallConfidence ?? 80,
    toolReliability: overrides.toolReliability ?? { score: 70, failedTools: [], unreliableTools: [] },
    contextPressure: overrides.contextPressure ?? "adequate",
    skillsUsed: overrides.skillsUsed ?? [],
    skillsNeedingClarity: overrides.skillsNeedingClarity ?? [],
    skillsNeedingAccess: overrides.skillsNeedingAccess ?? [],
    capabilitiesLacking: overrides.capabilitiesLacking ?? [],
    capabilitiesVital: overrides.capabilitiesVital ?? [],
    memoryRecallScore: overrides.memoryRecallScore ?? 75,
    fileLocatabilityScore: overrides.fileLocatabilityScore ?? 85,
    persistentBlockers: overrides.persistentBlockers ?? [],
    ...overrides,
  };
}

describe("aggregateThreadSignals", () => {
  it("returns zero averages for empty reports", () => {
    const agg = aggregateThreadSignals([]);
    assert.equal(agg.averageConfidence, 0);
    assert.equal(agg.averageToolReliability, 0);
    assert.equal(agg.persistentBlockers.length, 0);
  });

  it("computes correct averages", () => {
    const reports = [
      report({ id: "r1", overallConfidence: 60, toolReliability: { score: 80, failedTools: [], unreliableTools: [] }, memoryRecallScore: 70, fileLocatabilityScore: 90 }),
      report({ id: "r2", overallConfidence: 80, toolReliability: { score: 60, failedTools: [], unreliableTools: [] }, memoryRecallScore: 90, fileLocatabilityScore: 70 }),
    ];
    const agg = aggregateThreadSignals(reports);
    assert.equal(agg.averageConfidence, 70);
    assert.equal(agg.averageToolReliability, 70);
    assert.equal(agg.averageMemoryRecall, 80);
    assert.equal(agg.averageFileLocatability, 80);
  });

  it("ranks blockers by frequency × impact weight", () => {
    const blocker = (id: string, impact: "low" | "medium" | "high" | "blocking") => ({
      id, title: id, category: "other" as const, impact, detail: "",
    });
    const reports = [
      report({ id: "r1", persistentBlockers: [blocker("a", "low"), blocker("b", "blocking")] }),
      report({ id: "r2", persistentBlockers: [blocker("b", "blocking")] }),
      report({ id: "r3", persistentBlockers: [blocker("b", "blocking")] }),
    ];
    const agg = aggregateThreadSignals(reports);
    // b: frequency=3, weight=4, score=12; a: frequency=1, weight=1, score=1
    assert.equal(agg.persistentBlockers[0].id, "b");
    assert.equal(agg.persistentBlockers[0].frequency, 3);
  });

  it("marks blockers as crit when in >50% of reports", () => {
    const blocker = { id: "x", title: "X", category: "auth" as const, impact: "high" as const, detail: "" };
    const reports = [
      report({ id: "r1", persistentBlockers: [blocker] }),
      report({ id: "r2", persistentBlockers: [blocker] }),
      report({ id: "r3", persistentBlockers: [] }),
    ];
    const agg = aggregateThreadSignals(reports);
    // x appears in 2/3 = 67% → crit
    assert.equal(agg.persistentBlockers[0].crit, true);
  });

  it("does not mark blockers as crit when in ≤50% of reports", () => {
    const blocker = { id: "y", title: "Y", category: "tooling" as const, impact: "medium" as const, detail: "" };
    const reports = [
      report({ id: "r1", persistentBlockers: [blocker] }),
      report({ id: "r2", persistentBlockers: [] }),
    ];
    const agg = aggregateThreadSignals(reports);
    assert.equal(agg.persistentBlockers[0].crit, false);
  });

  it("deduplicates skills needing clarity (keeps newest)", () => {
    const reports = [
      report({ id: "r1", reportedAt: "2026-06-24T00:00:00.000Z", skillsNeedingClarity: [{ skillId: "exec", reason: "old" }] }),
      report({ id: "r2", reportedAt: "2026-06-25T00:00:00.000Z", skillsNeedingClarity: [{ skillId: "exec", reason: "new" }] }),
    ];
    const agg = aggregateThreadSignals(reports);
    assert.equal(agg.skillsNeedingClarity.length, 1);
    assert.equal(agg.skillsNeedingClarity[0].reason, "new");
  });

  it("builds a prioritized human review queue for summary thread signals", () => {
    const reports = [
      report({
        id: "r1",
        contextPressure: "critical",
        skillsNeedingAccess: [{ skillId: "github", reason: "token expired" }],
        persistentBlockers: [
          { id: "auth", title: "Auth expired", category: "auth", impact: "blocking", detail: "GitHub auth failed" },
        ],
      }),
      report({
        id: "r2",
        contextPressure: "tight",
        capabilitiesLacking: [{ name: "calendar search", importance: "blocking", detail: "cannot inspect conflicts" }],
      }),
    ];
    const review = buildThreadSignalReviewQueue(aggregateThreadSignals(reports));
    assert.equal(review[0].kind, "blocker");
    assert.equal(review[0].severity, "critical");
    assert.match(review[0].title, /Auth expired/);
    assert.ok(review.some((item) => item.kind === "skill-access" && item.title === "github"));
    assert.ok(review.some((item) => item.kind === "context-pressure" && item.detail.includes("critical")));
  });

  it("renders empty state in source file when no reports", () => {
    assert.match(source, /reports\.length === 0/);
    assert.match(source, /THREAD_SIGNALS_EMPTY_STATE/);
    assert.match(THREAD_SIGNALS_EMPTY_STATE, /No thread reports yet/);
    assert.match(source, /export function ThreadSignalsSection/);
  });

  it("renders a review-first Thread Signals layout in source", () => {
    assert.match(source, /buildThreadSignalReviewQueue/, "component derives a review queue");
    assert.match(source, /Review queue/, "component labels the prioritized review area");
    assert.match(source, /fa-thread-review-list/, "component renders the review queue as a scan-first list");
    assert.match(source, /Latest report/, "component shows recency for the summary");
  });
});
