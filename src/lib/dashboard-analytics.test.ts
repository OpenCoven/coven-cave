// @ts-nocheck
import assert from "node:assert/strict";
import { sessionsPerDay, familiarMiniProfiles, familiarLoadSeries } from "./dashboard-analytics.ts";

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

console.log("dashboard-analytics.test.ts passed");
