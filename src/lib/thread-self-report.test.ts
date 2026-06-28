import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateResponseConfidenceEvents,
  buildReflectTranscript,
  buildThreadReflectPrompt,
  contextPressureLabel,
  deriveThreadScore,
  normalizeResponseConfidenceEvent,
  type ResponseConfidenceEvent,
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

  it("normalizes response confidence events by clamping scores and preserving diagnostics", () => {
    const event = normalizeResponseConfidenceEvent({
      id: "event-1",
      familiarId: "cody",
      sessionId: "session-1",
      responseId: "response-1",
      responseAt: "2026-06-28T06:00:00.000Z",
      reportedAt: "2026-06-28T06:00:03.000Z",
      overallConfidence: 123,
      factors: {
        toolUse: { score: 0, weight: 1.5, reason: "Tool failed.", signals: ["tool-failed"] },
        context: { score: -8, weight: 1, reason: "Context was missing.", signals: ["context-missing"] },
        skills: { score: 88, weight: 0.8, reason: "Correct skill used.", signals: ["skill-used"] },
        permissions: { score: 65, weight: 0.7, reason: "No permission block.", signals: [] },
        memory: { score: 74, weight: 0.9, reason: "Memory was partial.", signals: ["memory-partial"] },
        instructionFit: { score: 91, weight: 1.2, reason: "Matched the ask.", signals: ["on-task"] },
        evidence: { score: 101, weight: 1.1, reason: "Tests cited.", signals: ["tests-run"] },
      },
      diagnosticTags: ["tool-failed", "context-missing", "tool-failed"],
      calibrationNotes: "Low confidence was warranted.",
      rubricVersion: "2026-06-28.v1",
    });

    assert.equal(event.overallConfidence, 100);
    assert.equal(event.factors.toolUse.score, 1);
    assert.equal(event.factors.context.score, 1);
    assert.equal(event.factors.evidence.score, 100);
    assert.deepEqual(event.diagnosticTags, ["tool-failed", "context-missing"]);
    assert.equal(event.calibrationNotes, "Low confidence was warranted.");
  });

  it("aggregates response confidence events into weighted factor trends", () => {
    const base: ResponseConfidenceEvent = normalizeResponseConfidenceEvent({
      id: "event-1",
      familiarId: "cody",
      sessionId: "session-1",
      responseId: "response-1",
      responseAt: "2026-06-28T06:00:00.000Z",
      reportedAt: "2026-06-28T06:00:05.000Z",
      overallConfidence: 50,
      factors: {
        toolUse: { score: 20, weight: 2, reason: "Tool failed.", signals: ["tool-failed"] },
        context: { score: 40, weight: 1, reason: "Context tight.", signals: ["context-tight"] },
        skills: { score: 70, weight: 1, reason: "Skill ok.", signals: [] },
        permissions: { score: 80, weight: 1, reason: "No block.", signals: [] },
        memory: { score: 60, weight: 1, reason: "Partial.", signals: [] },
        instructionFit: { score: 90, weight: 1, reason: "Fit.", signals: [] },
        evidence: { score: 30, weight: 1, reason: "Thin evidence.", signals: ["needs-source"] },
      },
      diagnosticTags: ["tool-failed", "needs-source"],
      rubricVersion: "2026-06-28.v1",
    });
    const newer: ResponseConfidenceEvent = normalizeResponseConfidenceEvent({
      ...base,
      id: "event-2",
      responseId: "response-2",
      reportedAt: "2026-06-28T07:00:05.000Z",
      overallConfidence: 90,
      factors: {
        ...base.factors,
        toolUse: { score: 100, weight: 1, reason: "Tool clean.", signals: [] },
        evidence: { score: 80, weight: 1, reason: "Evidence present.", signals: [] },
      },
      diagnosticTags: ["needs-source", "context-tight"],
    });

    const rollup = aggregateResponseConfidenceEvents([base, newer]);

    assert.equal(rollup.eventCount, 2);
    assert.equal(rollup.averageConfidence, 70);
    assert.equal(rollup.lowConfidenceCount, 1);
    assert.equal(rollup.newestEvent?.id, "event-2");
    assert.equal(rollup.factorAverages.toolUse, 47);
    assert.equal(rollup.factorAverages.evidence, 55);
    assert.deepEqual(rollup.topDiagnosticTags.slice(0, 2), [
      { tag: "needs-source", count: 2 },
      { tag: "context-tight", count: 1 },
    ]);
  });
});

describe("buildReflectTranscript", () => {
  it("formats user/assistant turns and drops system/empty ones", () => {
    const out = buildReflectTranscript([
      { role: "system", text: "boot" },
      { role: "user", text: "  hi there  " },
      { role: "assistant", text: "hello" },
      { role: "assistant", text: "   " },
    ]);
    assert.equal(out, "user: hi there\nassistant: hello");
  });

  it("keeps only the most recent turns and truncates long ones", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: "user" as const, text: `m${i}` }));
    const out = buildReflectTranscript(many);
    assert.equal(out.split("\n").length, 24, "caps at the most recent 24 turns");
    assert.ok(out.includes("m39") && !out.includes("m0\n") && !out.startsWith("user: m0"));

    const long = buildReflectTranscript([{ role: "assistant", text: "x".repeat(2000) }]);
    assert.ok(long.length < 700 && long.endsWith("…"), "long turns are clipped with an ellipsis");
  });
});

describe("buildThreadReflectPrompt", () => {
  it("embeds the transcript and the exact JSON shape the route validates", () => {
    const prompt = buildThreadReflectPrompt({
      sessionId: "sess-1",
      transcript: "user: do the thing\nassistant: done",
    });
    assert.ok(prompt.includes("session: sess-1"));
    assert.ok(prompt.includes("user: do the thing"));
    for (const key of ["overallConfidence", "toolReliability", "contextPressure", "persistentBlockers"]) {
      assert.ok(prompt.includes(`"${key}"`), `prompt declares ${key}`);
    }
    assert.ok(/Return ONLY a valid JSON object/.test(prompt));
  });

  it("falls back to a context-free instruction when no transcript is given", () => {
    const prompt = buildThreadReflectPrompt({ sessionId: "sess-2" });
    assert.ok(prompt.includes("Reflect on the thread just completed (session: sess-2)"));
  });
});
