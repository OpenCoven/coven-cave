// Synthesizes the scattered familiar-analytics signals (confidence, activity,
// contract, growth, self-heal) into a single plain-language "so what" line,
// so the KPI numbers carry meaning at a glance. Pure + unit-tested; the view
// renders the result as a tinted insight banner above the KPI row.

import type { FamiliarAnalyticsModel } from "@/components/familiar-analytics-data";

export type InsightTone = "good" | "warn" | "bad";
export type AnalyticsInsight = { text: string; tone: InsightTone };

const HEALTH_PHRASE: Record<string, string> = {
  active: "actively used",
  steady: "steady",
  quiet: "quiet lately",
  stalled: "stalled",
};

/** Join clauses naturally: ["a"] → "a"; ["a","b"] → "a and b". */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Build a one-line interpretation of a familiar's current analytics state.
 * Leads with thread-derived confidence + activity, then names up to two
 * concerns (or, if all clear, up to two positives). Tone reflects the most
 * pressing signal. Confidence comes from real thread self-reports
 * (deriveThreadConfidence) — with no reports yet the lead is honestly
 * "Unmeasured" rather than a fake "Low".
 */
export function deriveAnalyticsInsight(
  model: FamiliarAnalyticsModel,
  healRequestCount: number,
): AnalyticsInsight {
  const c = model.confidence;
  const g = model.growthReport;
  const contract = model.contractReport;
  const contractTotal = contract?.properties.length ?? 0;
  const contractPass = contract ? contract.properties.filter((p) => p.pass).length : 0;

  const healthPhrase = g ? HEALTH_PHRASE[g.healthLabel] ?? null : null;
  const confidenceLead = c.hasData ? c.label : "Unmeasured";
  const lead = healthPhrase ? `${confidenceLead}, ${healthPhrase}` : confidenceLead;

  const concerns: string[] = [];
  const positives: string[] = [];

  if (contractTotal > 0) {
    if (contract!.pass) positives.push(`contract clean (${contractPass}/${contractTotal})`);
    else concerns.push(`contract needs review (${contractPass}/${contractTotal})`);
  }
  if (healRequestCount > 0) {
    concerns.push(`${healRequestCount} self-heal request${healRequestCount === 1 ? "" : "s"} open`);
  }
  const lowThreadConfidence = c.hasData && c.score < 40;
  if (lowThreadConfidence) {
    concerns.push(`thread confidence low (${c.score}/100)`);
  }
  if (model.threadReports.length > 0) positives.push(`${model.threadReports.length} thread signal report${model.threadReports.length === 1 ? "" : "s"}`);

  const contractFailing = contractTotal > 0 && !contract!.pass;
  const tone: InsightTone =
    contractFailing || g?.healthLabel === "stalled"
      ? "bad"
      : healRequestCount > 0 || lowThreadConfidence
        ? "warn"
        : "good";

  const tail = concerns.length ? concerns.slice(0, 2) : positives.slice(0, 2);
  const text = tail.length ? `${lead} — ${joinClauses(tail)}.` : `${lead}.`;
  return { text, tone };
}
