// @ts-nocheck
import assert from "node:assert/strict";
import { buildFamiliarCardStats } from "./familiars-view-stats.ts";

const NOW = Date.parse("2026-06-08T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60_000).toISOString();

const familiars = [
  { id: "f1", display_name: "Atlas", role: "engineer" },
  { id: "f2", display_name: "Vesta", role: "researcher" },
  { id: "f3", display_name: "Quill", role: "writer" },
];

const sessions = [
  { id: "s1", familiarId: "f1", updated_at: minutesAgo(2), project_root: "/r", harness: "claude", title: "t", status: "running", exit_code: null, archived_at: null, created_at: minutesAgo(10) },
  { id: "s2", familiarId: "f1", updated_at: daysAgo(1), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(1) },
  { id: "s3", familiarId: "f1", updated_at: daysAgo(8), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(8) },
  { id: "s4", familiarId: "f2", updated_at: daysAgo(3), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(3) },
];

const covenEntries = [
  { id: "m1", familiar_id: "f1", title: "Older f1 memory", path: "/a.md", updated_at: minutesAgo(60) },
  { id: "m2", familiar_id: "f1", title: "Latest f1 memory", path: "/b.md", updated_at: minutesAgo(5) },
  { id: "m3", familiar_id: "f2", title: "Only f2 memory", path: "/c.md", updated_at: minutesAgo(120) },
];

const stats = buildFamiliarCardStats({ familiars, sessions, covenEntries, now: NOW });

// f1
const f1 = stats.get("f1");
assert.equal(f1?.memoryCount, 2, "f1 has 2 memories");
assert.equal(f1?.latestMemory?.title, "Latest f1 memory", "f1 latest memory is the most-recent one");
assert.equal(f1?.lastSessionAt, sessions[0].updated_at, "f1 last session is the most-recent");
assert.equal(f1?.sessionsLast7d, 2, "f1 has 2 sessions in the last 7d (s1 and s2; s3 is excluded at 8d)");
assert.equal(f1?.hasActiveSession, true, "f1 has an active session (2min < 5min)");

// f2
const f2 = stats.get("f2");
assert.equal(f2?.memoryCount, 1);
assert.equal(f2?.latestMemory?.title, "Only f2 memory");
assert.equal(f2?.sessionsLast7d, 1);
assert.equal(f2?.hasActiveSession, false, "f2 last session was 3 days ago, not active");

// f3 — nothing
const f3 = stats.get("f3");
assert.equal(f3?.memoryCount, 0);
assert.equal(f3?.latestMemory, null);
assert.equal(f3?.lastSessionAt, null);
assert.equal(f3?.sessionsLast7d, 0);
assert.equal(f3?.hasActiveSession, false);

// 7d window edge: session at exactly 7d should be EXCLUDED (strict less-than)
const edge7d = buildFamiliarCardStats({
  familiars: [{ id: "x", display_name: "X", role: "" }],
  sessions: [{ id: "z", familiarId: "x", updated_at: daysAgo(7), project_root: "/r", harness: "c", title: "t", status: "s", exit_code: 0, archived_at: null, created_at: daysAgo(7) }],
  covenEntries: [],
  now: NOW,
});
assert.equal(edge7d.get("x")?.sessionsLast7d, 0, "session at exactly 7d ago is excluded");

// 5min window edge: session at exactly 5min should be INACTIVE (strict less-than)
const edge5m = buildFamiliarCardStats({
  familiars: [{ id: "y", display_name: "Y", role: "" }],
  sessions: [{ id: "z", familiarId: "y", updated_at: minutesAgo(5), project_root: "/r", harness: "c", title: "t", status: "s", exit_code: 0, archived_at: null, created_at: minutesAgo(5) }],
  covenEntries: [],
  now: NOW,
});
assert.equal(edge5m.get("y")?.hasActiveSession, false, "session at exactly 5min ago is not active");

// Empty inputs
const empty = buildFamiliarCardStats({ familiars: [], sessions: [], covenEntries: [], now: NOW });
assert.equal(empty.size, 0);

console.log("familiars-view-stats: all assertions passed");
