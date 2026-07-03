// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveChatRecencyBuckets } from "./chat-recency.ts";

// Fixed LOCAL-noon clock so calendar-day math is stable in any timezone
// (noon keeps whole-day offsets inside the expected local date).
const NOW_MS = new Date(2026, 6, 3, 12, 0, 0).getTime(); // Jul 3 2026, 12:00 local
const daysAgoIso = (days, hours = 0) =>
  new Date(NOW_MS - days * 86_400_000 - hours * 3_600_000).toISOString();

function session(id, updated_at, created_at = updated_at) {
  return {
    id, title: id, status: "completed", origin: "chat", project_root: "/r",
    harness: "codex", exit_code: null, archived_at: null,
    created_at, updated_at, familiarId: "nova",
  };
}

test("buckets by local calendar day: today / yesterday / week / month / older", () => {
  const buckets = deriveChatRecencyBuckets([
    session("t1", daysAgoIso(0)),   // today
    session("y1", daysAgoIso(1)),   // yesterday
    session("w1", daysAgoIso(2)),   // 2 days old → Previous 7 days
    session("w2", daysAgoIso(7)),   // 7 days old → Previous 7 days (inclusive edge)
    session("m1", daysAgoIso(8)),   // 8 days old → Previous 30 days
    session("m2", daysAgoIso(30)),  // 30 days old → Previous 30 days (inclusive edge)
    session("o1", daysAgoIso(31)),  // 31 days old → Older
  ], NOW_MS);
  assert.deepEqual(buckets.map((b) => [b.key, b.sessions.map((s) => s.id)]), [
    ["today", ["t1"]],
    ["yesterday", ["y1"]],
    ["week", ["w1", "w2"]],
    ["month", ["m1", "m2"]],
    ["older", ["o1"]],
  ]);
  assert.deepEqual(
    buckets.map((b) => b.label),
    ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"],
  );
});

test("empty buckets are omitted; rows sort newest-first within a bucket", () => {
  const buckets = deriveChatRecencyBuckets([
    session("old-a", daysAgoIso(40)),
    session("t-old", daysAgoIso(0, 3)),
    session("t-new", daysAgoIso(0, 1)),
  ], NOW_MS);
  assert.deepEqual(buckets.map((b) => b.key), ["today", "older"]);
  assert.deepEqual(buckets[0].sessions.map((s) => s.id), ["t-new", "t-old"]);
});

test("created_at fallback; invalid timestamps → Older; future skew reads as today", () => {
  const created = deriveChatRecencyBuckets([session("c1", "", daysAgoIso(1))], NOW_MS);
  assert.deepEqual(created.map((b) => b.key), ["yesterday"]);
  const invalid = deriveChatRecencyBuckets([session("bad", "not-a-date")], NOW_MS);
  assert.deepEqual(invalid.map((b) => b.key), ["older"]);
  const future = deriveChatRecencyBuckets(
    [session("f1", new Date(NOW_MS + 3_600_000).toISOString())], NOW_MS);
  assert.deepEqual(future.map((b) => b.key), ["today"]);
});
