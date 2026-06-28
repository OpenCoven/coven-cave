import assert from "node:assert/strict";
import { deriveAnalyticsInsight } from "./familiar-analytics-insight.ts";
import type { FamiliarAnalyticsModel } from "@/components/familiar-analytics-data.ts";

// Build a model with only the fields the insight reads; cast the rest.
function model(over: Partial<FamiliarAnalyticsModel> = {}): FamiliarAnalyticsModel {
  return {
    familiarId: "f",
    familiar: null,
    contractReport: null,
    evalLoopState: null,
    growthReport: null,
    confidence: { score: 50, label: "Developing", factors: [] },
    healRequests: [],
    threadReports: [],
    errors: [],
    ...over,
  } as FamiliarAnalyticsModel;
}

function contract(pass: boolean, total: number, passing: number) {
  return {
    pass,
    properties: Array.from({ length: total }, (_, i) => ({ property: `p${i}`, pass: i < passing })),
  } as unknown as FamiliarAnalyticsModel["contractReport"];
}
function growth(healthLabel: string, retroAcceptRate: number | null = null) {
  return { healthLabel, sessionsLast7d: 3, retroAcceptRate, lastActiveAt: null, signals: [], recentRuns: [], trackStats: {} } as unknown as FamiliarAnalyticsModel["growthReport"];
}

// ---- leads with confidence + activity ----
{
  const i = deriveAnalyticsInsight(model({ confidence: { score: 80, label: "Trusted", factors: [] }, growthReport: growth("active") }), 0);
  assert.match(i.text, /^Trusted, actively used/, "leads with label + activity phrase");
}

// ---- concerns: contract failing dominates tone ----
{
  const i = deriveAnalyticsInsight(model({ contractReport: contract(false, 5, 3), growthReport: growth("active") }), 0);
  assert.equal(i.tone, "bad", "failing contract → bad tone");
  assert.match(i.text, /contract needs review \(3\/5\)/, "names the failing contract");
}

// ---- stalled activity → bad ----
{
  const i = deriveAnalyticsInsight(model({ growthReport: growth("stalled") }), 0);
  assert.equal(i.tone, "bad", "stalled → bad");
  assert.match(i.text, /stalled/);
}

// ---- self-heal + no eval run → warn ----
{
  const i = deriveAnalyticsInsight(model({ contractReport: contract(true, 5, 5), growthReport: growth("active") }), 1);
  assert.equal(i.tone, "warn", "open heal request → warn");
  assert.match(i.text, /1 self-heal request open/, "singular request");
  assert.match(i.text, /eval loop hasn't run/, "flags an idle eval loop");
}

// ---- all clear → good, lists positives ----
{
  const i = deriveAnalyticsInsight(model({ confidence: { score: 90, label: "Trusted", factors: [] }, contractReport: contract(true, 5, 5), growthReport: growth("active", 0.8) }), 0);
  assert.equal(i.tone, "good", "clean state → good");
  assert.match(i.text, /contract clean \(5\/5\)/);
  assert.match(i.text, /eval acceptance 80%/);
}

// ---- joins two clauses with "and" ----
{
  const i = deriveAnalyticsInsight(model({ contractReport: contract(false, 4, 2), growthReport: growth("quiet") }), 2);
  assert.match(i.text, / and /, "two concerns joined with 'and'");
  assert.match(i.text, /2 self-heal requests open/, "plural requests");
}

console.log("familiar-analytics-insight.test.ts OK");
