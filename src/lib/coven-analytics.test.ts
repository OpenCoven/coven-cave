// @ts-nocheck
import assert from "node:assert/strict";
import {
  confidenceTier,
  covenSessionsSeries,
  deriveCovenVitals,
  deriveCovenInsight,
} from "./coven-analytics.ts";

const NOW = Date.parse("2026-06-29T12:00:00Z");
const day = (offset) => new Date(NOW - offset * 86400_000).toISOString();
const sess = (id, familiarId, createdOffset, archived = false) => ({
  id, familiarId, created_at: day(createdOffset), updated_at: day(createdOffset),
  archived_at: archived ? day(0) : null, title: id,
});

/** Compact insight-row factory with sane defaults. */
const row = (over) => ({
  id: over.id,
  name: over.name ?? over.id,
  role: over.role ?? "Familiar",
  color: over.color ?? "#888",
  emoji: over.emoji ?? null,
  avatarUrl: over.avatarUrl ?? null,
  active: over.active ?? false,
  confidenceScore: over.confidenceScore ?? null,
  confidenceLabel: over.confidenceLabel ?? null,
  health: over.health ?? null,
  sessions7d: over.sessions7d ?? 0,
  trend: over.trend ?? [],
  contractPass: over.contractPass ?? 0,
  contractTotal: over.contractTotal ?? 0,
  lastActiveAt: over.lastActiveAt ?? null,
});

// ── confidenceTier: matches the per-familiar thresholds ──────────────────────
assert.equal(confidenceTier(85), "Trusted", ">=80 is Trusted");
assert.equal(confidenceTier(80), "Trusted", "boundary 80 is Trusted");
assert.equal(confidenceTier(60), "Reliable", "boundary 60 is Reliable");
assert.equal(confidenceTier(59), "Developing", "just under 60 is Developing");
assert.equal(confidenceTier(40), "Developing", "boundary 40 is Developing");
assert.equal(confidenceTier(39), "Low", "under 40 is Low");
assert.equal(confidenceTier(0), "Low");

// ── covenSessionsSeries: labelled, oldest→newest, counts across all familiars ─
{
  const sessions = [sess("a", "f1", 0), sess("b", "f2", 0), sess("c", "f1", 1), sess("old", "f1", 20)];
  const series = covenSessionsSeries(sessions, NOW, 14);
  assert.equal(series.length, 14, "one point per day over the window");
  assert.equal(series[13].value, 2, "today counts every familiar's sessions (a,b)");
  assert.equal(series[12].value, 1, "yesterday has one (c)");
  assert.equal(series[0].value, 0, "13 days ago is empty (the 20d-old one is outside the window)");
  assert.ok(typeof series[0].label === "string" && series[0].label.length > 0, "points carry a date label");
}

// ── deriveCovenVitals: WoW split, averages over scored rows, retro rate ──────
{
  // this week: a(0), b(0), c(2)  → 3 ; last week: d(9) → 1
  const sessions = [sess("a", "f1", 0), sess("b", "f2", 0), sess("c", "f1", 2), sess("d", "f1", 9)];
  const rows = [
    row({ id: "f1", active: true, confidenceScore: 80, confidenceLabel: "Trusted", health: "active", contractPass: 3, contractTotal: 4 }),
    row({ id: "f2", active: false, confidenceScore: 40, confidenceLabel: "Developing", health: "quiet", contractPass: 1, contractTotal: 2 }),
    row({ id: "f3", active: false, confidenceScore: null, health: "stalled" }), // unscored
  ];
  const vitals = deriveCovenVitals({ rows, sessions, retro: { accepted: 6, reverted: 2 }, nowMs: NOW });

  assert.equal(vitals.familiarCount, 3);
  assert.equal(vitals.scoredCount, 2, "only rows with a confidence score count as scored");
  assert.equal(vitals.activeFamiliars, 1);
  assert.equal(vitals.sessions7d, 3, "this-week sessions (a,b,c)");
  assert.equal(vitals.sessionsPrev7d, 1, "last-week sessions (d at 9d)");
  assert.equal(vitals.sessionsWowDelta, 2, "WoW delta = 3 - 1");
  assert.equal(vitals.avgConfidence, 60, "mean of 80 and 40 (unscored f3 excluded)");
  assert.equal(vitals.confidenceTier, "Reliable", "avg 60 tiers to Reliable");
  assert.equal(vitals.contractPass, 4, "3 + 1 passing across the coven");
  assert.equal(vitals.contractTotal, 6, "4 + 2 total");
  assert.equal(vitals.retroAcceptRate, 0.75, "6 / (6+2)");
  assert.equal(vitals.stalledCount, 1);
  assert.equal(vitals.quietCount, 1);
}

// ── deriveCovenVitals: no retro runs → null accept rate, no scores → null avg ─
{
  const rows = [row({ id: "f1", health: "steady" })];
  const vitals = deriveCovenVitals({ rows, sessions: [], retro: null, nowMs: NOW });
  assert.equal(vitals.retroAcceptRate, null, "no retro runs → null (not 0/0 NaN)");
  assert.equal(vitals.avgConfidence, null, "no scored familiars → null avg");
  assert.equal(vitals.confidenceTier, null);
  assert.equal(vitals.sessionsWowDelta, 0);
}

// ── deriveCovenInsight: empty coven ─────────────────────────────────────────
{
  const vitals = deriveCovenVitals({ rows: [], sessions: [], retro: null, nowMs: NOW });
  const insight = deriveCovenInsight({ vitals, rows: [] });
  assert.match(insight.headline, /No familiars/i);
  assert.equal(insight.tone, "warn");
}

// ── deriveCovenInsight: loading roster should not read as empty coven ───────
{
  const vitals = deriveCovenVitals({ rows: [], sessions: [], retro: null, nowMs: NOW });
  const insight = deriveCovenInsight({ vitals, rows: [], familiarsLoaded: false });
  assert.match(insight.headline, /Loading familiars/i);
  assert.doesNotMatch(insight.headline, /No familiars/i);
}

// ── deriveCovenInsight: healthy coven reads "good" and names the leader ──────
{
  const sessions = [sess("a", "f1", 0), sess("b", "f1", 1), sess("c", "f2", 0)];
  const rows = [
    row({ id: "f1", name: "Sage", active: true, confidenceScore: 82, health: "active", sessions7d: 2 }),
    row({ id: "f2", name: "Nova", confidenceScore: 70, health: "steady", sessions7d: 1 }),
  ];
  const vitals = deriveCovenVitals({ rows, sessions, retro: { accepted: 8, reverted: 1 }, nowMs: NOW });
  const insight = deriveCovenInsight({ vitals, rows });
  assert.equal(insight.tone, "good");
  assert.match(insight.headline, /smoothly/i);
  assert.match(insight.detail, /Sage is leading the load/, "names the busiest familiar");
  assert.match(insight.detail, /session/, "leads with weekly activity");
}

// ── deriveCovenInsight: a stalled familiar makes it "bad" and is called out ──
{
  const rows = [
    row({ id: "f1", name: "Sage", confidenceScore: 70, health: "active", sessions7d: 4 }),
    row({ id: "f2", name: "Quiet", confidenceScore: 30, health: "stalled", sessions7d: 0 }),
  ];
  const vitals = deriveCovenVitals({ rows, sessions: [], retro: null, nowMs: NOW });
  const insight = deriveCovenInsight({ vitals, rows });
  assert.equal(insight.tone, "bad", "a stalled familiar drives a bad tone");
  assert.match(insight.detail, /Quiet has stalled/, "names the stalled familiar");
}

// ── deriveCovenInsight: quiet (no stall) reads "warn" ────────────────────────
{
  const rows = [
    row({ id: "f1", name: "Sage", confidenceScore: 75, health: "active", sessions7d: 3 }),
    row({ id: "f2", name: "Dozy", confidenceScore: 65, health: "quiet", sessions7d: 0 }),
  ];
  const vitals = deriveCovenVitals({ rows, sessions: [], retro: null, nowMs: NOW });
  const insight = deriveCovenInsight({ vitals, rows });
  assert.equal(insight.tone, "warn");
  assert.match(insight.detail, /Dozy has gone quiet/);
}

console.log("coven-analytics.test.ts: ok");
