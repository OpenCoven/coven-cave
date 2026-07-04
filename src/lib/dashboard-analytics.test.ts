// @ts-nocheck
import assert from "node:assert/strict";
import { sessionsPerDay, familiarMiniProfiles, familiarLoadSeries, dashboardSignals } from "./dashboard-analytics.ts";

const NOW = Date.parse("2026-06-29T12:00:00Z");
const day = (offset) => new Date(NOW - offset * 86400_000).toISOString();
const sess = (id, familiarId, createdOffset, archived = false) => ({
  id, familiarId, created_at: day(createdOffset), updated_at: day(createdOffset),
  archived_at: archived ? day(0) : null, title: id,
});

const sessions = [
  sess("a", "f1", 0), sess("b", "f1", 0), sess("c", "f1", 3),
  sess("d", "f2", 0),
  sess("old", "f1", 30),       // outside 7d window
  sess("arch", "f1", 0, true), // archived → excluded
];
const familiars = [
  { id: "f1", display_name: "Sage", color: "#a", active_sessions: 1 },
  { id: "f2", display_name: "Nova", color: "#b", active_sessions: 0 },
  { id: "f3", display_name: "Quiet", color: "#c", active_sessions: 0 },
];

// ── sessionsPerDay: length=days, oldest→newest, today's bucket counts today ────
const f1Days = sessionsPerDay(sessions, "f1", NOW, 7);
assert.equal(f1Days.length, 7, "one bucket per day");
assert.equal(f1Days[6], 2, "two f1 sessions today (a,b); archived excluded");
assert.equal(f1Days[3], 1, "one f1 session 3 days ago");
assert.equal(f1Days[0], 0, "nothing 6 days ago");
assert.equal(sessionsPerDay(sessions, null, NOW, 7)[6], 3, "null familiarId counts all (a,b,d)");

// ── familiarMiniProfiles: per familiar, 7d count + active + lastActive + trend ─
const profiles = familiarMiniProfiles(familiars, sessions, NOW);
const f1 = profiles.find((p) => p.id === "f1");
assert.equal(f1.sessionsLast7d, 3, "f1 had 3 sessions in 7d (a,b,c; old + archived excluded)");
assert.equal(f1.active, true, "f1 active_sessions>0");
assert.equal(f1.trend.length, 7, "trend is a 7-point sparkline series");
assert.equal(f1.trend[6].value, 2, "trend today = 2");
const quiet = profiles.find((p) => p.id === "f3");
assert.equal(quiet.sessionsLast7d, 0, "f3 has no sessions");

// ── familiarLoadSeries: top-N by 7d load, multi-series {id,label,color,points} ─
const series = familiarLoadSeries(familiars, sessions, NOW, 7, 2);
assert.equal(series.length, 2, "top 2 familiars by load (f3 has 0, dropped)");
assert.equal(series[0].id, "f1", "f1 leads (3 sessions)");
assert.equal(series[0].points.length, 7, "each series has 7 points");
assert.ok(series[0].points.every((p) => typeof p.x === "number" && typeof p.y === "number"), "points are {x,y}");

// ── dashboardSignals: stalled PR + large reading queue + trending-down familiar ─
const ghItem = (id, kind, updatedOffset, state, title) => ({
  id, kind, title, repo: "o/r", url: "#", state, updatedAt: day(updatedOffset),
});
const sigGithub = [
  ghItem("p1", "pr", 9, "open", "Old PR"),          // stalled (>7d)
  ghItem("p2", "pr", 2, "open", "Fresh PR"),        // not stalled
  ghItem("p3", "pr", 20, "closed", "Closed PR"),    // closed → ignored
  ghItem("p4", "issue", 30, "open", "Old issue"),   // not a PR → ignored
];
// f1: sessions only in the prior window (offset 5) → trending down.
// f2: a session today (offset 0) → not trending down.
const sigSessions = [sess("s1", "f1", 5), sess("s2", "f2", 0)];
const sigFamiliars = [
  { id: "f1", display_name: "Sage" },
  { id: "f2", display_name: "Nova" },
];
const sigReading = Array.from({ length: 9 }, (_, i) => ({ status: "want-to-read" }));

const signals = dashboardSignals({
  github: sigGithub, reading: sigReading, sessions: sigSessions, familiars: sigFamiliars, nowMs: NOW,
});
const sigIds = signals.map((s) => s.id);
assert.ok(sigIds.includes("pr-stalled-p1"), "stalled open PR surfaces a warn signal");
assert.ok(!sigIds.some((id) => id.startsWith("pr-stalled-p2")), "fresh PR is not flagged");
assert.ok(!sigIds.some((id) => id.startsWith("pr-stalled-p3")), "closed PR is not flagged");
assert.ok(!sigIds.some((id) => id.startsWith("pr-stalled-p4")), "issues are not flagged as stalled PRs");
assert.ok(sigIds.includes("reading-large"), "large reading queue (>8) surfaces an info signal");
assert.ok(sigIds.includes("familiar-down-f1"), "familiar quiet for 3d after prior activity is flagged");
assert.ok(!sigIds.includes("familiar-down-f2"), "recently-active familiar is not flagged");
assert.equal(signals[0].severity, "warn", "warnings sort ahead of info");
assert.equal(dashboardSignals({ github: [], reading: [], sessions: [], familiars: [], nowMs: NOW }).length, 0, "no signals when nothing is drifting");

// ── Signals are actionable: each carries the destination to act on it ─
const stalled = signals.find((s) => s.id === "pr-stalled-p1");
assert.equal(stalled.href, "#", "stalled-PR signal links to the PR's own URL");
assert.equal(stalled.external, true, "PR links leave the app via the external opener");
assert.equal(signals.find((s) => s.id === "reading-large").href, "/?mode=library", "reading signal opens the library");
assert.equal(
  signals.find((s) => s.id === "familiar-down-f1").href,
  "/dashboard/familiars/f1/analytics",
  "trending-down signal opens that familiar's analytics",
);

console.log("dashboard-analytics.test.ts passed");
