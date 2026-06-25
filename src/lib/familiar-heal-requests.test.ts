import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAMILIAR_CONTRACT_SPEC_VERSION, type ContractReport } from "./familiar-contract.ts";
import { deriveHealRequests, escalateBlockers, type SelfHealRequest } from "./familiar-heal-requests.ts";
import type { FamiliarGrowthReport } from "./familiar-growth-signals.ts";
import type { ThreadSignalsAggregate } from "./thread-self-report.ts";
import type { EvalLoopState } from "@/components/eval-loop-panel";

function evalLoopState(): EvalLoopState {
  return {
    familiar_id: "cody",
    last_run: "2026-06-25T10:00:00.000Z",
    iterations: [
      {
        id: "accepted",
        timestamp: "2026-06-25T09:00:00.000Z",
        track: "prompt",
        iteration: 1,
        change_summary: "Accepted prompt change",
        metric_before: 0.4,
        metric_after: 0.7,
        delta: 0.3,
        outcome: "ACCEPT",
      },
      {
        id: "reverted-a",
        timestamp: "2026-06-25T10:00:00.000Z",
        track: "memory",
        iteration: 2,
        change_summary: "Memory change reverted",
        metric_before: 0.7,
        metric_after: 0.5,
        delta: -0.2,
        outcome: "REVERT",
        notes: "needs review",
      },
      {
        id: "reverted-b",
        timestamp: "2026-06-25T11:00:00.000Z",
        track: "synthesis",
        iteration: 3,
        change_summary: "Synthesis change reverted",
        metric_before: 0.7,
        metric_after: 0.6,
        delta: -0.1,
      outcome: "REVERT",
      },
    ],
    track_counts: { synthesis: 1, prompt: 1, memory: 1 },
    total_accepted: 1,
    total_reverted: 2,
    running: false,
  };
}

function aggregateWithBlockers(
  blockers: ThreadSignalsAggregate["persistentBlockers"],
): ThreadSignalsAggregate {
  return {
    averageConfidence: 80,
    averageToolReliability: 80,
    averageMemoryRecall: 80,
    averageFileLocatability: 80,
    contextCounts: { adequate: 1, tight: 0, excess: 0, critical: 0 },
    skillsUsedMost: [],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesVital: [],
    capabilitiesLacking: [],
    persistentBlockers: blockers,
  };
}

function blocker(
  id: string,
  category: ThreadSignalsAggregate["persistentBlockers"][number]["category"],
  crit = true,
): ThreadSignalsAggregate["persistentBlockers"][number] {
  return {
    id,
    title: `${category} blocker`,
    category,
    impact: "blocking",
    detail: `Persistent ${category} issue.`,
    suggestedResolution: `Resolve ${category}.`,
    frequency: 3,
    rankScore: 12,
    crit,
  };
}

function contractReport(): ContractReport {
  return {
    specVersion: FAMILIAR_CONTRACT_SPEC_VERSION,
    pass: false,
    properties: [
      { property: "Named Identity", pass: false },
      { property: "Defined Purpose", pass: true },
      { property: "Bounded Authority", pass: true },
      { property: "Persistent Memory", pass: true },
      { property: "Human Belonging", pass: true },
    ],
    violations: [
      { file: "SOUL.md", field: "name", message: "Missing name." },
      { file: "MEMORY.md", field: "file", message: "Missing memory." },
    ],
    warnings: [],
  };
}

function growthReport(): FamiliarGrowthReport {
  return {
    familiarId: "cody",
    healthLabel: "stalled",
    sessionsLast7d: 0,
    retroAcceptRate: null,
    lastActiveAt: null,
    recentRuns: [],
    trackStats: {
      synthesis: { total: 0, accepted: 0 },
      prompt: { total: 0, accepted: 0 },
      memory: { total: 0, accepted: 0 },
    },
    signals: [
      {
        kind: "session-gap",
        label: "Session gap is critical",
        detail: "No sessions.",
        severity: "crit",
      },
      {
        kind: "low-accept-rate",
        label: "Prompt track is reverting often",
        detail: "Too many reverts.",
        severity: "warn",
      },
    ],
  };
}

describe("deriveHealRequests", () => {
  it("turns eval-loop reverts into warning run-eval requests", () => {
    const requests = deriveHealRequests({
      familiarId: "cody",
      evalLoopState: evalLoopState(),
      contractReport: null,
      growthReport: null,
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].source, "eval-loop");
    assert.equal(requests[0].severity, "warn");
    assert.equal(requests[0].actionKind, "run-eval");
    assert.equal(requests[0].createdAt, "2026-06-25T11:00:00.000Z");
  });

  it("turns contract violations into critical fix-contract requests", () => {
    const requests = deriveHealRequests({
      familiarId: "cody",
      evalLoopState: null,
      contractReport: contractReport(),
      growthReport: null,
    });

    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.source === "contract"));
    assert.ok(requests.every((request) => request.severity === "crit"));
    assert.ok(requests.every((request) => request.actionKind === "fix-contract"));
  });

  it("maps growth critical memory/session signals to write-memory and warnings to manual", () => {
    const requests = deriveHealRequests({
      familiarId: "cody",
      evalLoopState: null,
      contractReport: null,
      growthReport: growthReport(),
    });

    assert.equal(requests[0].source, "growth-signal");
    assert.equal(requests[0].severity, "crit");
    assert.equal(requests[0].actionKind, "write-memory");
    assert.equal(requests[1].severity, "warn");
    assert.equal(requests[1].actionKind, "manual");
  });

  it("returns an empty list for empty inputs", () => {
    assert.deepEqual(
      deriveHealRequests({
        familiarId: "cody",
        evalLoopState: null,
        contractReport: null,
        growthReport: null,
      }),
      [],
    );
  });

  it("sorts critical requests first, then warnings, newest first within severity", () => {
    const requests = deriveHealRequests({
      familiarId: "cody",
      evalLoopState: evalLoopState(),
      contractReport: contractReport(),
      growthReport: growthReport(),
    });

    assert.deepEqual(
      requests.map((request) => request.severity),
      ["crit", "crit", "crit", "warn", "warn", "warn"],
    );
    assert.deepEqual(
      requests.filter((request) => request.severity === "warn").map((request) => request.createdAt),
      [
        "2026-06-25T11:00:00.000Z",
        "2026-06-25T10:00:00.000Z",
        "1970-01-01T00:00:00.000Z",
      ],
    );
  });
});

describe("escalateBlockers", () => {
  it("turns critical aggregate blockers into critical self-heal requests", () => {
    const requests = escalateBlockers("cody", aggregateWithBlockers([blocker("auth-oauth", "auth")]), []);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].id, "auth-oauth");
    assert.equal(requests[0].familiarId, "cody");
    assert.equal(requests[0].source, "self-report-aggregate");
    assert.equal(requests[0].severity, "crit");
    assert.equal(requests[0].actionKind, "fix-contract");
  });

  it("skips non-critical blockers", () => {
    const requests = escalateBlockers("cody", aggregateWithBlockers([blocker("context-noise", "context", false)]), []);

    assert.deepEqual(requests, []);
  });

  it("does not add duplicates already present by blocker id", () => {
    const existing: SelfHealRequest[] = [
      {
        id: "tooling-missing-cli",
        familiarId: "cody",
        source: "growth-signal",
        severity: "crit",
        title: "Existing request",
        detail: "Already tracked.",
        suggestedAction: "Review it.",
        actionKind: "manual",
        createdAt: "2026-06-25T10:00:00.000Z",
        resolved: false,
      },
    ];

    const requests = escalateBlockers(
      "cody",
      aggregateWithBlockers([blocker("tooling-missing-cli", "tooling")]),
      existing,
    );

    assert.deepEqual(requests, []);
  });

  it("maps blocker categories to escalation action kinds", () => {
    const requests = escalateBlockers(
      "cody",
      aggregateWithBlockers([
        blocker("auth", "auth"),
        blocker("tooling", "tooling"),
        blocker("permission", "permission"),
        blocker("infra", "infra"),
        blocker("context", "context"),
        blocker("skill", "skill"),
        blocker("other", "other"),
      ]),
      [],
    );

    assert.deepEqual(
      requests.map((request) => [request.id, request.actionKind]),
      [
        ["auth", "fix-contract"],
        ["tooling", "manual"],
        ["permission", "manual"],
        ["infra", "manual"],
        ["context", "write-memory"],
        ["skill", "request-skill"],
        ["other", "manual"],
      ],
    );
  });

  it("does not mutate aggregate blockers or existing requests", () => {
    const aggregate = aggregateWithBlockers([blocker("context", "context")]);
    const existing: SelfHealRequest[] = [];
    const blockerBefore = { ...aggregate.persistentBlockers[0] };

    escalateBlockers("cody", aggregate, existing);

    assert.deepEqual(aggregate.persistentBlockers[0], blockerBefore);
    assert.deepEqual(existing, []);
  });
});
