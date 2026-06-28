import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReflectTranscript,
  buildThreadReflectPrompt,
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
