// @ts-nocheck
import assert from "node:assert/strict";
import { sessionsPerDay, familiarMiniProfiles, familiarLoadSeries, dashboardSignals, defaultInsightOrder, sortInsightRows, filterInsightRows, spaceUsageRows, sortSpaceRows, formatBytes } from "./dashboard-analytics.ts";

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

// ── dashboardSignals: stalled PR + trending-down familiar ─
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
const signals = dashboardSignals({
  github: sigGithub, sessions: sigSessions, familiars: sigFamiliars, nowMs: NOW,
});
const sigIds = signals.map((s) => s.id);
assert.ok(sigIds.includes("pr-stalled-p1"), "stalled open PR surfaces a warn signal");
assert.ok(!sigIds.some((id) => id.startsWith("pr-stalled-p2")), "fresh PR is not flagged");
assert.ok(!sigIds.some((id) => id.startsWith("pr-stalled-p3")), "closed PR is not flagged");
assert.ok(!sigIds.some((id) => id.startsWith("pr-stalled-p4")), "issues are not flagged as stalled PRs");
assert.ok(sigIds.includes("familiar-down-f1"), "familiar quiet for 3d after prior activity is flagged");
assert.ok(!sigIds.includes("familiar-down-f2"), "recently-active familiar is not flagged");
assert.equal(signals[0].severity, "warn", "warnings sort ahead of info");
assert.equal(dashboardSignals({ github: [], sessions: [], familiars: [], nowMs: NOW }).length, 0, "no signals when nothing is drifting");

// ── Signals are actionable: each carries the destination to act on it ─
const stalled = signals.find((s) => s.id === "pr-stalled-p1");
assert.equal(stalled.href, "#", "stalled-PR signal links to the PR's own URL");
assert.equal(stalled.external, true, "PR links leave the app via the external opener");
assert.equal(
  signals.find((s) => s.id === "familiar-down-f1").href,
  "/dashboard/familiars/f1/analytics",
  "trending-down signal opens that familiar's analytics",
);

// ── Insights table: sort + filter (pure) ─
const row = (id, over = {}) => ({
  id, name: id, role: "familiar", color: "#a", emoji: null, avatarUrl: null, active: false,
  confidenceScore: null, confidenceLabel: null, health: null, sessions7d: 0, trend: [],
  contractPass: 0, contractTotal: 0, lastActiveAt: null, ...over,
});
const rows = [
  row("alpha", { confidenceScore: 60, sessions7d: 1, contractPass: 1, contractTotal: 2, lastActiveAt: day(3) }),
  row("bravo", { confidenceScore: 90, sessions7d: 5, contractPass: 2, contractTotal: 2, lastActiveAt: day(0), health: "active" }),
  row("charlie", { sessions7d: 9, lastActiveAt: day(1), role: "scout" }), // unscored, no contract
];

assert.deepEqual(
  defaultInsightOrder(rows).map((r) => r.id),
  ["bravo", "alpha", "charlie"],
  "default curated order: confidence desc, then activity",
);
assert.deepEqual(
  sortInsightRows(rows, "sessions", "desc").map((r) => r.id),
  ["charlie", "bravo", "alpha"],
  "sessions desc",
);
assert.deepEqual(
  sortInsightRows(rows, "name", "asc").map((r) => r.id),
  ["alpha", "bravo", "charlie"],
  "name asc",
);
assert.deepEqual(
  sortInsightRows(rows, "confidence", "asc").map((r) => r.id),
  ["alpha", "bravo", "charlie"],
  "confidence asc ranks real scores; unscored rows sink even ascending",
);
assert.deepEqual(
  sortInsightRows(rows, "contract", "desc").map((r) => r.id),
  ["bravo", "alpha", "charlie"],
  "contract sorts by pass ratio; contract-less rows sink",
);
assert.deepEqual(
  sortInsightRows(rows, "lastActive", "desc").map((r) => r.id),
  ["bravo", "charlie", "alpha"],
  "lastActive desc puts most recent first",
);
assert.deepEqual(filterInsightRows(rows, " BRA ").map((r) => r.id), ["bravo"], "filter matches names case/space-insensitively");
assert.deepEqual(filterInsightRows(rows, "scout").map((r) => r.id), ["charlie"], "filter matches roles");
assert.deepEqual(filterInsightRows(rows, "active").map((r) => r.id), ["bravo"], "filter matches health buckets");
assert.equal(filterInsightRows(rows, "").length, 3, "empty query keeps everything");

// ── Space usage rows: share, sort, cleanup destinations, formatting ─
const area = (id, label, bytes, files, over = {}) => ({
  id, label, relPath: `~/.coven/${id}`, exists: true, bytes, files, lastModifiedMs: NOW - bytes, truncated: false, ...over,
});
const spaceAreas = [
  area("memory", "Familiar memory", 3000, 3),
  area("conversations", "Chat transcripts", 6000, 10),
  area("trash", "Trash", 1000, 1, { truncated: true }),
  area("flows", "Flows", 0, 0),                        // empty → dropped
  { ...area("journal", "Journal", 0, 0), exists: false }, // missing → dropped
];
const spaceRows = spaceUsageRows(spaceAreas);
assert.deepEqual(spaceRows.map((r) => r.id).sort(), ["conversations", "memory", "trash"], "empty and missing areas are dropped");
assert.equal(spaceRows.find((r) => r.id === "conversations").sharePct, 60, "share is pct of total scanned bytes");
assert.equal(spaceRows.find((r) => r.id === "memory").href, "/?mode=agents", "memory row carries a cleanup destination");
assert.equal(spaceRows.find((r) => r.id === "trash").href, null, "areas without an owning surface stay plain rows");
assert.equal(spaceRows.find((r) => r.id === "trash").truncated, true, "truncation flag survives to the row");

assert.deepEqual(
  sortSpaceRows(spaceRows, "bytes", "desc").map((r) => r.id),
  ["conversations", "memory", "trash"],
  "space rows sort by size desc",
);
assert.deepEqual(
  sortSpaceRows(spaceRows, "label", "asc").map((r) => r.id),
  ["conversations", "memory", "trash"],
  "space rows sort by label asc",
);
assert.deepEqual(
  sortSpaceRows(spaceRows, "files", "asc").map((r) => r.id),
  ["trash", "memory", "conversations"],
  "space rows sort by file count asc",
);

assert.equal(formatBytes(0), "0 B");
assert.equal(formatBytes(512), "512 B");
assert.equal(formatBytes(2048), "2.0 KB");
assert.equal(formatBytes(1024 * 1024 * 34), "34 MB");
assert.equal(formatBytes(1024 ** 3 * 1.5), "1.5 GB");

console.log("dashboard-analytics.test.ts passed");
