import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contextPressureLabel,
  deriveThreadScore,
  type ThreadSelfReport,
} from "./thread-self-report.ts";

function fullReport(): ThreadSelfReport {
  return {
    id: "report-1",
    familiarId: "cody",
    sessionId: "session-1",
    threadTitle: "Analytics foundation",
    reportedAt: "2026-06-25T12:00:00.000Z",
    overallConfidence: 80,
    overallConfidenceReason: "Most signals were healthy.",
    toolReliability: {
      score: 60,
      failedTools: ["build"],
      unreliableTools: ["search"],
      notes: "One transient failure.",
    },
    contextPressure: "tight",
    contextNotes: "Enough room, but close.",
    skillsUsed: ["test-driven-development"],
    skillsNeedingClarity: [{ skillId: "verification-before-completion", reason: "Scope of CI checks." }],
    skillsNeedingAccess: [{ skillId: "github", reason: "Needs PR merge access." }],
    capabilitiesLacking: [
      {
        name: "Self-report API",
        importance: "blocking",
        detail: "Thread signals cannot persist yet.",
      },
    ],
    capabilitiesVital: [
      {
        name: "GitHub CLI",
        currentState: "available",
        notes: "Authenticated.",
      },
    ],
    memoryRecallScore: 50,
    memoryRecallNotes: "Memory was available.",
    fileLocatabilityScore: 90,
    fileLocatabilityNotes: "Files were easy to find.",
    persistentBlockers: [
      {
        id: "blocker-1",
        title: "Missing daemon",
        category: "infra",
        firstSeenAt: "2026-06-24T12:00:00.000Z",
        impact: "medium",
        detail: "Daemon unavailable in local tests.",
        suggestedResolution: "Mock route responses.",
      },
    ],
  };
}

describe("thread self-report helpers", () => {
  it("derives the weighted composite thread score", () => {
    assert.equal(deriveThreadScore(fullReport()), 71);
  });

  it("maps every context pressure to a display label and severity", () => {
    assert.deepEqual(contextPressureLabel("adequate"), { label: "Adequate", severity: "ok" });
    assert.deepEqual(contextPressureLabel("tight"), { label: "Tight", severity: "warn" });
    assert.deepEqual(contextPressureLabel("excess"), { label: "Excess", severity: "warn" });
    assert.deepEqual(contextPressureLabel("critical"), { label: "Critical", severity: "crit" });
  });

  it("constructs a complete ThreadSelfReport shape", () => {
    const report = fullReport();

    assert.equal(report.id, "report-1");
    assert.equal(report.persistentBlockers[0].impact, "medium");
  });
});
