import type { ReactNode } from "react";
import { FamiliarAnalyticsContent } from "@/components/familiar-analytics-content";
import { buildFamiliarAnalyticsModel } from "@/components/familiar-analytics-data";
import { FAMILIAR_PROPERTIES } from "@/lib/familiar-contract";
import { EMPTY_FEEDBACK_ROLLUP } from "@/lib/message-feedback-rollup";
import { buildRetroRunsSnapshot } from "@/lib/retro-runs";
import "@/styles/familiar-analytics.css";

const model = buildFamiliarAnalyticsModel({
  familiarId: "fixture-analytics",
  familiars: [{ id: "fixture-analytics", display_name: "Review familiar", role: "Review project plans and preserve authored decisions", harness: "codex" }],
  contractReport: { specVersion: "0.1.0", pass: false, properties: FAMILIAR_PROPERTIES.map(property => ({ property, pass: property !== "Defined Purpose" })), violations: [{ file: "SOUL.md", field: "purpose", message: "Describe the familiar's bounded purpose and preserve the human approval boundary." }], warnings: [] },
  sessions: [], memoryAvailability: "ready", fileEntries: [], retroSnapshot: buildRetroRunsSnapshot([]),
  threadReports: [], metricSnapshots: [], modelFeedback: EMPTY_FEEDBACK_ROLLUP, executionAnalytics: null, outcomes: [], errors: [],
});

export function modalAnalyticsFixtures(): Record<string, ReactNode> {
  const analytics = <div className="fa-page" style={{ position: "fixed", inset: 0 }}><FamiliarAnalyticsContent model={model} /></div>;
  return Object.fromEntries(["analytics-signals", "analytics-runtime", "analytics-trust", "analytics-contract", "analytics-board", "analytics-action"].map(name => [name, analytics]));
}
