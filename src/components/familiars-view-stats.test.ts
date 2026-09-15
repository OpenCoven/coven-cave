import assert from "node:assert/strict";
import { ACTIVITY_DAYS, buildFamiliarCardStats } from "./familiars-view-stats.ts";
import { NO_CHAT_ATTENTION } from "../lib/chat-attention.ts";
import type { FamiliarFileMemoryStat } from "./familiars-view-stats.ts";

const NOW = Date.parse("2026-06-08T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60_000).toISOString();

const familiars = [
  { id: "f1", display_name: "Atlas", role: "engineer" },
  { id: "f2", display_name: "Vesta", role: "researcher" },
  { id: "f3", display_name: "Quill", role: "writer" },
];

const sessions = [
  { id: "s1", familiarId: "f1", updated_at: minutesAgo(2), project_root: "/r", harness: "claude", title: "t", status: "running", exit_code: null, archived_at: null, created_at: minutesAgo(10), attention: NO_CHAT_ATTENTION },
  { id: "s2", familiarId: "f1", updated_at: daysAgo(1), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(1), attention: NO_CHAT_ATTENTION },
  { id: "s3", familiarId: "f1", updated_at: daysAgo(8), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(8), attention: NO_CHAT_ATTENTION },
  { id: "s5", familiarId: "f1", updated_at: minutesAgo(1), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(9), attention: NO_CHAT_ATTENTION },
  { id: "s6", familiarId: "f1", updated_at: minutesAgo(1), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: minutesAgo(1), created_at: minutesAgo(1), attention: NO_CHAT_ATTENTION },
  { id: "s4", familiarId: "f2", updated_at: daysAgo(3), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(3), attention: NO_CHAT_ATTENTION },
];

// Memory is MEMORY.md files now; the canonical vault moved to the dedicated
// memory application. A file's relPath is its title on the card, which is why
// the latest-memory assertions below read a path rather than a summary title.
function memory(
  id: string,
  familiarId: string,
  title: string,
  modified: string,
): FamiliarFileMemoryStat {
  return {
    familiarId,
    relPath: title,
    fullPath: `/Users/x/.coven/${familiarId}/memory/${id}.md`,
    modified,
  };
}

const fileEntries = [
  memory("m1", "f1", "Older f1 memory", minutesAgo(60)),
  memory("m2", "f1", "Latest f1 memory", minutesAgo(5)),
  memory("m3", "f2", "Only f2 memory", minutesAgo(120)),
];

const stats = buildFamiliarCardStats({
  familiars,
  sessions,
  fileEntries,
  memoryAvailability: "ready",
  now: NOW,
});

// f1
const f1 = stats.get("f1");
assert.equal(f1?.memoryCount, 2, "f1 has 2 memories");
assert.equal(f1?.memoryAvailability, "ready");
assert.equal(f1?.latestMemory?.title, "Latest f1 memory", "f1 latest memory is the most-recent one");
assert.equal(f1?.lastSessionAt, sessions[0].created_at, "f1 last session uses the newest non-archived session start");
assert.equal(f1?.sessionsLast7d, 2, "f1 has 2 sessions in the last 7d (s1 and s2; s3 is excluded at 8d)");
assert.equal(f1?.hasActiveSession, false, "f1 has no session start in the active window");
assert.equal(f1?.sessionsTotal, 4, "f1 counts every non-archived session (s6 archived is excluded)");
assert.equal(f1?.streakDays, 2, "f1 ritual streak spans today (s1) and yesterday (s2); the day-8 gap breaks the chain");
assert.equal(f1?.activity.length, ACTIVITY_DAYS, "activity strip covers ACTIVITY_DAYS UTC days");
assert.equal(f1?.activity[ACTIVITY_DAYS - 1], 1, "today's cell counts s1 (started 10 minutes ago)");
assert.equal(f1?.activity[ACTIVITY_DAYS - 2], 1, "yesterday's cell counts s2");
assert.equal(f1?.activity[ACTIVITY_DAYS - 9], 1, "8-days-ago cell counts s3 (inside the strip even though outside 7d)");
assert.equal(f1?.activity[ACTIVITY_DAYS - 10], 1, "9-days-ago cell counts s5's created_at start");
assert.equal(
  f1?.activity.reduce((sum, n) => sum + n, 0),
  4,
  "strip counts every non-archived session start inside the window (UTC day bucketing)",
);

// f2
const f2 = stats.get("f2");
assert.equal(f2?.memoryCount, 1);
assert.equal(f2?.latestMemory?.title, "Only f2 memory");
assert.equal(f2?.sessionsLast7d, 1);
assert.equal(f2?.hasActiveSession, false, "f2 last session was 3 days ago, not active");
assert.equal(f2?.streakDays, 0, "a 3-day-old session holds no streak — and the card shows a dash, not a zero");

// f3 — nothing
const f3 = stats.get("f3");
assert.equal(f3?.memoryCount, 0);
assert.equal(f3?.memoryAvailability, "ready", "a successful empty list is a confirmed zero");
assert.equal(f3?.latestMemory, null);
assert.equal(f3?.lastSessionAt, null);
assert.equal(f3?.sessionsLast7d, 0);
assert.equal(f3?.hasActiveSession, false);
assert.equal(f3?.sessionsTotal, 0);
assert.ok(f3?.activity.every((n) => n === 0), "zero-session familiar has an all-zero activity strip");
assert.equal(f3?.streakDays, 0, "zero-session familiar has no streak");

// 7d window edge: session at exactly 7d should be EXCLUDED (strict less-than)
const edge7d = buildFamiliarCardStats({
  familiars: [{ id: "x", display_name: "X", role: "" }],
  sessions: [{ id: "z", familiarId: "x", updated_at: daysAgo(7), project_root: "/r", harness: "c", title: "t", status: "s", exit_code: 0, archived_at: null, created_at: daysAgo(7), attention: NO_CHAT_ATTENTION }],
  fileEntries: [],
  memoryAvailability: "ready",
  now: NOW,
});
assert.equal(edge7d.get("x")?.sessionsLast7d, 0, "session at exactly 7d ago is excluded");

// 5min window edge: session at exactly 5min should be INACTIVE (strict less-than)
const edge5m = buildFamiliarCardStats({
  familiars: [{ id: "y", display_name: "Y", role: "" }],
  sessions: [{ id: "z", familiarId: "y", updated_at: minutesAgo(5), project_root: "/r", harness: "c", title: "t", status: "s", exit_code: 0, archived_at: null, created_at: minutesAgo(5), attention: NO_CHAT_ATTENTION }],
  fileEntries: [],
  memoryAvailability: "ready",
  now: NOW,
});
assert.equal(edge5m.get("y")?.hasActiveSession, false, "session at exactly 5min ago is not active");

const activeCreated = buildFamiliarCardStats({
  familiars: [{ id: "a", display_name: "A", role: "" }],
  sessions: [{ id: "recent", familiarId: "a", updated_at: minutesAgo(1), project_root: "/r", harness: "c", title: "t", status: "s", exit_code: 0, archived_at: null, created_at: minutesAgo(1), attention: NO_CHAT_ATTENTION }],
  fileEntries: [],
  memoryAvailability: "ready",
  now: NOW,
});
assert.equal(activeCreated.get("a")?.hasActiveSession, true, "recent non-archived session start is active");

const unavailable = buildFamiliarCardStats({
  familiars: [{ id: "u", display_name: "Unavailable", role: "" }],
  sessions: [],
  fileEntries: [],
  memoryAvailability: "unavailable",
  now: NOW,
}).get("u");
assert.equal(unavailable?.memoryCount, 0, "renown math keeps its conservative numeric fallback");
assert.equal(
  unavailable?.memoryAvailability,
  "unavailable",
  "callers can distinguish an unavailable list from a confirmed zero",
);

const workspaceBacked = buildFamiliarCardStats({
  familiars: [{ id: "w", display_name: "Workspace backed", role: "" }],
  sessions: [],
  fileEntries: [{
    familiarId: "w",
    relPath: "MEMORY.md",
    fullPath: "/tmp/w/MEMORY.md",
    modified: minutesAgo(2),
  }],
  memoryAvailability: "ready",
  now: NOW,
}).get("w");
assert.equal(workspaceBacked?.memoryCount, 1, "workspace memory contributes to the durable count");
assert.equal(workspaceBacked?.memoryAvailability, "ready");
assert.equal(workspaceBacked?.latestMemory?.title, "MEMORY.md");

// There was a second feed here — the canonical vault — and this case proved
// that an empty read from ONE settled source could not claim a confirmed zero
// while the other was unavailable. With one feed left the property is simpler
// but unchanged in spirit: an unavailable read is not a zero.
const partiallyUnavailable = buildFamiliarCardStats({
  familiars: [{ id: "p", display_name: "Partial", role: "" }],
  sessions: [],
  fileEntries: [],
  memoryAvailability: "unavailable",
  now: NOW,
}).get("p");
assert.equal(partiallyUnavailable?.memoryCount, 0);
assert.equal(
  partiallyUnavailable?.memoryAvailability,
  "unavailable",
  "an unavailable read cannot assert that no durable memory exists",
);

// Empty inputs
const empty = buildFamiliarCardStats({
  familiars: [],
  sessions: [],
  fileEntries: [],
  memoryAvailability: "ready",
  now: NOW,
});
assert.equal(empty.size, 0);

console.log("familiars-view-stats: all assertions passed");
