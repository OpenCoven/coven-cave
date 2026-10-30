import { FamiliarAnalyticsContent } from "@/components/familiar-analytics-content";
import { buildFamiliarAnalyticsModel } from "@/components/familiar-analytics-data";
import { buildFamiliarExecutionAnalytics, normalizeExecutionAttemptSnapshot } from "@/lib/familiar-execution-analytics";
import { FAMILIAR_PROPERTIES } from "@/lib/familiar-contract";
import { EMPTY_FEEDBACK_ROLLUP } from "@/lib/message-feedback-rollup";
import { buildRetroRunsSnapshot } from "@/lib/retro-runs";
import { snapshotFromReport } from "@/lib/signal-trends";
import type { ThreadSelfReport } from "@/lib/thread-self-report";
import type { SessionRow } from "@/lib/types";
import "@/styles/familiar-analytics.css";

// Synthetic observations pass through the same derivation as the real screen.
const reports: ThreadSelfReport[] = [90, 70, 50].map((score, index) => ({
  id: `fixture-report-${index}`, familiarId: "fixture-analytics", sessionId: `fixture-session-${index}`,
  reportedAt: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
  overallConfidence: score, toolReliability: { score, failedTools: [], unreliableTools: [] },
  contextPressure: index === 2 ? "tight" : "adequate", skillsUsed: ["review"], skillsNeedingClarity: [], skillsNeedingAccess: [],
  capabilitiesLacking: [], capabilitiesVital: [], memoryRecallScore: score, fileLocatabilityScore: score,
  persistentBlockers: [{ id: "fixture-tool", title: "Fixture tool unavailable", category: "tooling", impact: "blocking", detail: "Synthetic tool failure across three reports.", firstSeenAt: "2026-10-22T12:00:00.000Z", suggestedResolution: "Inspect the source trace before retrying." }],
}));
const sessions: SessionRow[] = reports.map((report, index) => ({
  id: report.sessionId, familiarId: report.familiarId, title: `Fixture review ${index + 1}`,
  project_root: "/fixture/review", harness: "codex", model: "fixture-model", runtime: "local", status: "completed",
  exit_code: 0, archived_at: null, created_at: report.reportedAt, updated_at: report.reportedAt,
  attention: { state: "none", since: null, reason: null }, origin: "chat",
}));
const executionAnalytics = buildFamiliarExecutionAnalytics({
  familiarId: "fixture-analytics",
  attempts: [1, 2, 3, 10].map((days, index) => {
    const completedAt = new Date(Date.now() - days * 86_400_000).toISOString();
    const snapshot = normalizeExecutionAttemptSnapshot({
      schemaVersion: 1, attemptId: `fixture-attempt-${index}`, familiarId: "fixture-analytics",
      sessionId: `fixture-runtime-${index}`, turnId: `fixture-turn-${index}`, attemptNumber: 1,
      execution: { kind: "assistant-response", origin: "chat" },
      harness: { id: "codex", ...(index === 2 ? {} : { version: "fixture-version" }) },
      ...(index === 2 ? {} : { models: { requested: { kind: "model", id: "fixture-model" }, confirmed: "fixture-model" } }),
      timing: { completedAt, durationMs: (index + 1) * 2000 },
      ...([0, 3].includes(index) ? { usage: { inputTokens: 20, outputTokens: 10 } } : {}),
      outcome: { status: ["succeeded", "error", "cancelled", "succeeded"][index] },
      provenance: { source: "live", sourceSchema: "execution-attempt-v1", capturedAt: completedAt },
      coverage: { knownFields: [] },
    });
    if (!snapshot) throw new Error("Invalid synthetic runtime observation");
    return snapshot;
  }),
});
const model = buildFamiliarAnalyticsModel({
  familiarId: "fixture-analytics",
  familiars: [{ id: "fixture-analytics", display_name: "Review familiar", role: "Review project plans", harness: "codex", autoSelfReport: true }],
  contractReport: { specVersion: "0.1.0", pass: false, properties: FAMILIAR_PROPERTIES.map(property => ({ property, pass: property !== "Defined Purpose" })), violations: [{ file: "SOUL.md", field: "purpose", message: "Describe the bounded purpose and preserve human approval." }], warnings: [] },
  sessions, memoryAvailability: "ready", fileEntries: [], retroSnapshot: buildRetroRunsSnapshot([]),
  threadReports: reports, metricSnapshots: reports.map(snapshotFromReport), modelFeedback: EMPTY_FEEDBACK_ROLLUP,
  executionAnalytics, outcomes: [], errors: [],
});

export function PopulatedAnalyticsFixture() {
  return <div className="fa-page" style={{ position: "fixed", inset: 0 }}><FamiliarAnalyticsContent model={model} /></div>;
}
