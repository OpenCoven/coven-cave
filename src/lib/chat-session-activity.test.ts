import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_ACTIVITY_BUCKET_ORDER,
  chatActivityBucket,
  chatRowIdleMinutes,
  groupChatRowsByActivity,
} from "./chat-session-activity.ts";
import type { SessionRow } from "./types.ts";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const row = (id: string, status: string, idleMinutes: number): SessionRow =>
  ({
    id,
    status,
    title: id,
    project_root: "/repo",
    harness: "codex",
    exit_code: null,
    archived_at: null,
    created_at: minutesAgo(idleMinutes + 30),
    updated_at: minutesAgo(idleMinutes),
  }) as SessionRow;

test("running work floats to Active now regardless of how long it has run", () => {
  // The whole point of the band: you never hunt for the live session.
  assert.equal(chatActivityBucket(row("a", "running", 0), NOW), "active");
  assert.equal(chatActivityBucket(row("b", "running", 20_000), NOW), "active");
});

test("everything else buckets by idle time at the day boundaries", () => {
  assert.equal(chatActivityBucket(row("a", "completed", 5), NOW), "today");
  assert.equal(chatActivityBucket(row("b", "completed", 1439), NOW), "today");
  assert.equal(chatActivityBucket(row("c", "completed", 1440), NOW), "yesterday");
  assert.equal(chatActivityBucket(row("d", "completed", 2879), NOW), "yesterday");
  assert.equal(chatActivityBucket(row("e", "completed", 2880), NOW), "week");
  assert.equal(chatActivityBucket(row("f", "completed", 10_079), NOW), "week");
  assert.equal(chatActivityBucket(row("g", "completed", 10_080), NOW), "older");
});

test("a future timestamp clamps to zero idle rather than sorting into Older", () => {
  // A skewed daemon clock stamping updated_at ahead of us used to compute a
  // negative idle, which is not < 1440 in the way you'd hope once it wraps
  // through the comparison chain. Clamping keeps a fresh row reading fresh.
  const skewed = row("skew", "completed", -120);
  assert.equal(chatRowIdleMinutes(skewed, NOW), 0);
  assert.equal(chatActivityBucket(skewed, NOW), "today");
});

test("an unparseable timestamp reads as fresh, not ancient", () => {
  const broken = { ...row("x", "completed", 10), updated_at: "not-a-date", created_at: "" } as SessionRow;
  assert.equal(chatRowIdleMinutes(broken, NOW), 0);
});

test("groups come back in band order, keep incoming order, and drop empties", () => {
  const rows = [
    row("old", "completed", 20_000),
    row("live", "running", 3),
    row("today-a", "completed", 10),
    row("today-b", "completed", 30),
  ];
  const groups = groupChatRowsByActivity(rows, NOW);
  assert.deepEqual(groups.map((g) => g.bucket), ["active", "today", "older"]);
  assert.deepEqual(groups.map((g) => g.label), ["Active now", "Today", "Older"]);
  assert.deepEqual(
    groups[1].rows.map((r) => r.id),
    ["today-a", "today-b"],
    "the caller's sort inside a band is preserved",
  );
  assert.ok(!groups.some((g) => g.bucket === "yesterday"), "an empty band renders no header");
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  assert.equal(total, rows.length, "every row lands in exactly one band");
});

test("an empty list produces no bands at all", () => {
  assert.deepEqual(groupChatRowsByActivity([], NOW), []);
  assert.equal(CHAT_ACTIVITY_BUCKET_ORDER.length, 5);
});
