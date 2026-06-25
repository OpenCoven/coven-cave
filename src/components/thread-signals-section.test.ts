import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReactElement, ReactNode } from "react";
import {
  aggregateThreadSignals,
  ThreadSignalsSection,
} from "./thread-signals-section.tsx";
import type { ThreadSelfReport } from "@/lib/thread-self-report";

function report(overrides: Partial<ThreadSelfReport>): ThreadSelfReport {
  return {
    id: overrides.id ?? "report",
    familiarId: "cody",
    sessionId: overrides.sessionId ?? "session",
    reportedAt: overrides.reportedAt ?? "2026-06-25T12:00:00.000Z",
    overallConfidence: overrides.overallConfidence ?? 80,
    toolReliability: overrides.toolReliability ?? { score: 70, failedTools: [], unreliableTools: [] },
    contextPressure: overrides.contextPressure ?? "adequate",
    skillsUsed: overrides.skillsUsed ?? [],
    skillsNeedingClarity: overrides.skillsNeedingClarity ?? [],
    skillsNeedingAccess: overrides.skillsNeedingAccess ?? [],
    capabilitiesLacking: overrides.capabilitiesLacking ?? [],
    capabilitiesVital: overrides.capabilitiesVital ?? [],
    memoryRecallScore: overrides.memoryRecallScore ?? 60,
    fileLocatabilityScore: overrides.fileLocatabilityScore ?? 50,
    persistentBlockers: overrides.persistentBlockers ?? [],
  };
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return flattenText((node as ReactElement<{ children?: ReactNode }>).props.children);
}

describe("thread signals aggregation", () => {
  it("computes average scores and context distribution", () => {
    const agg = aggregateThreadSignals([
      report({ overallConfidence: 80, toolReliability: { score: 60, failedTools: [], unreliableTools: [] }, contextPressure: "adequate", memoryRecallScore: 50, fileLocatabilityScore: 40 }),
      report({ overallConfidence: 100, toolReliability: { score: 80, failedTools: [], unreliableTools: [] }, contextPressure: "critical", memoryRecallScore: 70, fileLocatabilityScore: 80 }),
    ]);

    assert.equal(agg.averageConfidence, 90);
    assert.equal(agg.averageToolReliability, 70);
    assert.equal(agg.averageMemoryRecall, 60);
    assert.equal(agg.averageFileLocatability, 60);
    assert.deepEqual(agg.contextCounts, { adequate: 1, tight: 0, excess: 0, critical: 1 });
  });

  it("deduplicates skills using the most recent clarity/access reasons", () => {
    const agg = aggregateThreadSignals([
      report({
        reportedAt: "2026-06-24T12:00:00.000Z",
        skillsUsed: ["test-driven-development"],
        skillsNeedingClarity: [{ skillId: "tdd", reason: "old reason" }],
        skillsNeedingAccess: [{ skillId: "github", reason: "old access" }],
      }),
      report({
        reportedAt: "2026-06-25T12:00:00.000Z",
        skillsUsed: ["test-driven-development", "verification-before-completion"],
        skillsNeedingClarity: [{ skillId: "tdd", reason: "new reason" }],
        skillsNeedingAccess: [{ skillId: "github", reason: "new access" }],
      }),
    ]);

    assert.deepEqual(agg.skillsUsedMost.slice(0, 2), [
      { skillId: "test-driven-development", count: 2 },
      { skillId: "verification-before-completion", count: 1 },
    ]);
    assert.deepEqual(agg.skillsNeedingClarity, [{ skillId: "tdd", reason: "new reason" }]);
    assert.deepEqual(agg.skillsNeedingAccess, [{ skillId: "github", reason: "new access" }]);
  });

  it("ranks blockers by frequency times impact and marks blockers seen in more than half of reports as crit", () => {
    const agg = aggregateThreadSignals([
      report({
        id: "a",
        persistentBlockers: [
          { id: "auth", title: "Auth missing", category: "auth", impact: "medium", detail: "x" },
          { id: "infra", title: "Infra down", category: "infra", impact: "high", detail: "x" },
        ],
      }),
      report({
        id: "b",
        persistentBlockers: [
          { id: "auth", title: "Auth missing", category: "auth", impact: "medium", detail: "x" },
        ],
      }),
      report({
        id: "c",
        persistentBlockers: [
          { id: "auth", title: "Auth missing", category: "auth", impact: "medium", detail: "x" },
        ],
      }),
    ]);

    assert.equal(agg.persistentBlockers[0].id, "auth");
    assert.equal(agg.persistentBlockers[0].rankScore, 6);
    assert.equal(agg.persistentBlockers[0].crit, true);
    assert.equal(agg.persistentBlockers[1].rankScore, 3);
  });

  it("deduplicates capabilities with worst state and highest importance winning", () => {
    const agg = aggregateThreadSignals([
      report({
        capabilitiesVital: [{ name: "Filesystem", currentState: "available", notes: "ok" }],
        capabilitiesLacking: [{ name: "Calendar", importance: "nice-to-have", detail: "later" }],
      }),
      report({
        capabilitiesVital: [{ name: "Filesystem", currentState: "missing", notes: "gone" }],
        capabilitiesLacking: [{ name: "Calendar", importance: "blocking", detail: "now" }],
      }),
    ]);

    assert.deepEqual(agg.capabilitiesVital, [{ name: "Filesystem", currentState: "missing", notes: "gone" }]);
    assert.deepEqual(agg.capabilitiesLacking, [{ name: "Calendar", importance: "blocking", detail: "now" }]);
  });

  it("renders the empty state when no reports exist", () => {
    const section = ThreadSignalsSection({ familiarId: "cody", reports: [] });
    assert.match(flattenText(section), /No thread reports yet/);
  });
});
