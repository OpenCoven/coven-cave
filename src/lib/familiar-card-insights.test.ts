// @ts-nocheck
import assert from "node:assert/strict";
import { deriveFamiliarCardInsights } from "./familiar-card-insights.ts";

const NOW = Date.parse("2026-07-12T12:00:00.000Z");

function baseModel(overrides = {}) {
  return {
    familiarId: "nova",
    familiar: { id: "nova", display_name: "Nova", role: "orchestrator" },
    contractReport: null,
    growthReport: {
      familiarId: "nova",
      healthLabel: "active",
      sessionsLast7d: 5,
      retroAcceptRate: null,
      lastActiveAt: new Date(NOW).toISOString(),
      signals: [],
      recentRuns: [],
      trackStats: {
        synthesis: { total: 0, accepted: 0 },
        prompt: { total: 0, accepted: 0 },
        memory: { total: 0, accepted: 0 },
      },
    },
    confidence: {
      score: 82,
      label: "Trusted",
      hasData: true,
      reportCount: 3,
      metrics: [],
      contextCounts: { adequate: 3, tight: 0, excess: 0, critical: 0 },
    },
    healRequests: [],
    threadReports: [],
    modelFeedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    sessionPulse: [],
    recentSessions: [],
    errors: [],
    ...overrides,
  };
}

// ── happy path: trusted, quiet card ─────────────────────────────────────────
{
  const out = deriveFamiliarCardInsights(baseModel());
  assert.equal(out.confidenceLabel, "Trusted");
  assert.equal(out.confidenceScore, 82);
  assert.equal(out.insight.tone, "good", "no concerns → good tone");
  assert.match(out.insight.text, /Trusted/, "insight leads with confidence label");
  assert.equal(out.topSignal, null, "no non-healthy signals");
  assert.equal(out.sessionsLast7d, 5);
  assert.deepEqual(out.runningSessions, []);
  assert.equal(out.feedback, null, "no votes → no feedback stat");
  assert.deepEqual(out.actions, [], "nothing urgent → no contextual actions");
}

// ── running sessions surface as workload + resume action ────────────────────
{
  const sessions = [
    { id: "s1", title: "Fix onboarding flake", status: "running", archived_at: null, updated_at: "2026-07-12T11:59:00.000Z" },
    { id: "s2", title: "Docs pass", status: "done", archived_at: null, updated_at: "2026-07-12T11:00:00.000Z" },
    { id: "s3", title: "Refactor tokens", status: "running", archived_at: null, updated_at: "2026-07-12T10:00:00.000Z" },
    { id: "s4", title: "Old run", status: "running", archived_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" },
    { id: "s5", title: "Third live", status: "running", archived_at: null, updated_at: "2026-07-12T09:00:00.000Z" },
  ];
  const out = deriveFamiliarCardInsights(baseModel({ recentSessions: sessions }));
  assert.deepEqual(
    out.runningSessions.map((s) => s.id),
    ["s1", "s3"],
    "running + unarchived only, capped at 2",
  );
  assert.equal(out.actions[0].kind, "resume-session");
  assert.equal(out.actions[0].sessionId, "s1", "resume targets the freshest running session");
}

// ── feedback rollup → approval stat with top model ──────────────────────────
{
  const out = deriveFamiliarCardInsights(
    baseModel({
      modelFeedback: {
        up: 9,
        down: 1,
        total: 10,
        models: [{ key: "gpt-6", up: 6, down: 1, total: 7, approval: 6 / 7 }],
        runtimes: [],
      },
    }),
  );
  assert.equal(out.feedback.total, 10);
  assert.equal(out.feedback.approval, 0.9);
  assert.equal(out.feedback.topModel, "gpt-6");
}

// ── failing contract wins the health-action slot over heal review ───────────
{
  const contractReport = {
    pass: false,
    properties: [{ id: "p1", pass: false }, { id: "p2", pass: true }],
    violations: [],
  };
  const heals = [{ id: "h1", resolved: false }];
  const out = deriveFamiliarCardInsights(baseModel({ contractReport, healRequests: heals }));
  assert.ok(out.actions.some((a) => a.kind === "fix-contract"), "failing contract → fix action");
  assert.ok(!out.actions.some((a) => a.kind === "review-heals"), "contract action claims the slot");
  assert.equal(out.insight.tone, "bad", "failing contract → bad tone");
}

// ── open heals without contract failure → review action, warn tone ──────────
{
  const out = deriveFamiliarCardInsights(
    baseModel({ healRequests: [{ id: "h1", resolved: false }, { id: "h2", resolved: true }] }),
  );
  assert.ok(out.actions.some((a) => a.kind === "review-heals"));
  assert.equal(out.insight.tone, "warn");
  assert.match(out.insight.text, /1 self-heal request/, "resolved heals not counted");
}

// ── top signal: severity-sorted, healthy filtered; stale memory → action ────
{
  const signals = [
    { kind: "low-retro-volume", label: "Low retro volume", detail: "", severity: "info" },
    { kind: "stale-memory", label: "Memory stale", detail: "", severity: "warn" },
  ];
  const out = deriveFamiliarCardInsights(
    baseModel({ growthReport: { ...baseModel().growthReport, signals } }),
  );
  assert.equal(out.topSignal.kind, "stale-memory", "warn outranks info");
  assert.ok(out.actions.some((a) => a.kind === "refresh-memory"), "stale memory → refresh action");
}

// ── actions capped at 2, most urgent first ──────────────────────────────────
{
  const out = deriveFamiliarCardInsights(
    baseModel({
      recentSessions: [{ id: "s1", title: "Live", status: "running", archived_at: null, updated_at: "2026-07-12T11:00:00.000Z" }],
      contractReport: { pass: false, properties: [{ id: "p", pass: false }], violations: [] },
      growthReport: {
        ...baseModel().growthReport,
        signals: [{ kind: "stale-memory", label: "Memory stale", detail: "", severity: "warn" }],
      },
    }),
  );
  assert.equal(out.actions.length, 2, "capped at 2");
  assert.deepEqual(
    out.actions.map((a) => a.kind),
    ["resume-session", "fix-contract"],
    "resume + contract outrank memory refresh",
  );
}

// ── null growth report degrades gracefully ──────────────────────────────────
{
  const out = deriveFamiliarCardInsights(baseModel({ growthReport: null }));
  assert.equal(out.topSignal, null);
  assert.equal(out.sessionsLast7d, 0);
}

console.log("familiar-card-insights.test.ts: ok");
