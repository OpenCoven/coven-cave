import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAMILIAR_CONTRACT_SPEC_VERSION, type ContractReport } from "./familiar-contract.ts";
import { deriveConfidenceScore } from "./familiar-confidence.ts";
import type { FamiliarGrowthReport } from "./familiar-growth-signals.ts";

function contractReport(passing: number): ContractReport {
  const properties = [
    "Named Identity",
    "Defined Purpose",
    "Bounded Authority",
    "Persistent Memory",
    "Human Belonging",
  ] as const;

  return {
    specVersion: FAMILIAR_CONTRACT_SPEC_VERSION,
    pass: passing === properties.length,
    properties: properties.map((property, index) => ({ property, pass: index < passing })),
    violations: [],
    warnings: [],
  };
}

function growthReport(args: {
  runs: number;
  accepted: number;
  sessionsLast7d?: number;
}): FamiliarGrowthReport {
  const runs = Array.from({ length: args.runs }, (_, index) => ({
    id: `run-${index}`,
    familiarId: "cody",
    familiarName: "Cody",
    familiarRole: "agent",
    iterationId: `iter-${index}`,
    iteration: index + 1,
    timestamp: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    track: "synthesis" as const,
    outcome: index < args.accepted ? ("ACCEPT" as const) : ("REVERT" as const),
    changeSummary: "Iteration",
    metricBefore: 0,
    metricAfter: 1,
    delta: 1,
    raw: {},
  }));

  return {
    familiarId: "cody",
    healthLabel: "active",
    sessionsLast7d: args.sessionsLast7d ?? 0,
    retroAcceptRate: args.runs === 0 ? null : args.accepted / args.runs,
    lastActiveAt: null,
    signals: [],
    recentRuns: runs,
    trackStats: {
      synthesis: { total: args.runs, accepted: args.accepted },
      prompt: { total: 0, accepted: 0 },
      memory: { total: 0, accepted: 0 },
    },
  };
}

describe("deriveConfidenceScore", () => {
  it("assigns all four label thresholds", () => {
    assert.equal(
      deriveConfidenceScore({
        contractReport: contractReport(0),
        growthReport: growthReport({ runs: 0, accepted: 0 }),
        familiar: { memory_freshness: null },
      }).label,
      "Low",
    );

    assert.equal(
      deriveConfidenceScore({
        contractReport: contractReport(5),
        growthReport: growthReport({ runs: 0, accepted: 0 }),
        familiar: { memory_freshness: "aging" },
      }).label,
      "Developing",
    );

    assert.equal(
      deriveConfidenceScore({
        contractReport: contractReport(5),
        growthReport: growthReport({ runs: 4, accepted: 3 }),
        familiar: { memory_freshness: "aging" },
      }).label,
      "Reliable",
    );

    assert.equal(
      deriveConfidenceScore({
        contractReport: contractReport(5),
        growthReport: growthReport({ runs: 5, accepted: 5, sessionsLast7d: 10 }),
        familiar: { memory_freshness: "fresh" },
      }).label,
      "Trusted",
    );
  });

  it("guards accept rate at zero until at least three retro runs exist", () => {
    const score = deriveConfidenceScore({
      contractReport: contractReport(0),
      growthReport: growthReport({ runs: 2, accepted: 2 }),
      familiar: { memory_freshness: null },
    });

    assert.equal(score.factors.find((factor) => factor.label === "accept_rate")?.value, 0);
  });

  it("maps each freshness state to its weighted factor value", () => {
    const cases = [
      ["fresh", 100],
      ["aging", 60],
      ["stale", 20],
      [null, 0],
      [undefined, 0],
    ] as const;

    for (const [memory_freshness, expected] of cases) {
      const score = deriveConfidenceScore({
        contractReport: contractReport(0),
        growthReport: growthReport({ runs: 0, accepted: 0 }),
        familiar: { memory_freshness },
      });

      assert.equal(score.factors.find((factor) => factor.label === "freshness_score")?.value, expected);
    }
  });

  it("caps activity contribution at ten sessions", () => {
    const score = deriveConfidenceScore({
      contractReport: contractReport(0),
      growthReport: growthReport({ runs: 0, accepted: 0, sessionsLast7d: 18 }),
      familiar: { memory_freshness: null },
    });

    assert.equal(score.factors.find((factor) => factor.label === "activity_score")?.value, 100);
    assert.equal(score.factors.find((factor) => factor.label === "activity_score")?.contribution, 10);
  });

  it("keeps factor contributions aligned with the rounded score", () => {
    const score = deriveConfidenceScore({
      contractReport: contractReport(3),
      growthReport: growthReport({ runs: 4, accepted: 2, sessionsLast7d: 4 }),
      familiar: { memory_freshness: "aging" },
    });
    const contributionSum = score.factors.reduce((sum, factor) => sum + factor.contribution, 0);

    assert.equal(score.score, Math.round(contributionSum));
  });

  it("returns the zero edge case", () => {
    assert.deepEqual(
      deriveConfidenceScore({
        contractReport: contractReport(0),
        growthReport: growthReport({ runs: 0, accepted: 0 }),
        familiar: { memory_freshness: null },
      }),
      {
        score: 0,
        label: "Low",
        factors: [
          { label: "contract_score", value: 0, weight: 0.3, contribution: 0 },
          { label: "accept_rate", value: 0, weight: 0.4, contribution: 0 },
          { label: "freshness_score", value: 0, weight: 0.2, contribution: 0 },
          { label: "activity_score", value: 0, weight: 0.1, contribution: 0 },
        ],
      },
    );
  });

  it("returns the max edge case", () => {
    const score = deriveConfidenceScore({
      contractReport: contractReport(5),
      growthReport: growthReport({ runs: 5, accepted: 5, sessionsLast7d: 10 }),
      familiar: { memory_freshness: "fresh" },
    });

    assert.equal(score.score, 100);
    assert.equal(score.label, "Trusted");
  });
});
