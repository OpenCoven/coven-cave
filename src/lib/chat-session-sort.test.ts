import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_SESSION_SORT_HEADING,
  CHAT_SESSION_SORT_LABEL,
  CHAT_SESSION_SORT_ORDER,
  chatSessionDurationMs,
  formatChatSessionDuration,
  normalizeChatSessionSort,
  sortChatSessionRows,
} from "./chat-session-sort.ts";
import type { SessionRow } from "./types.ts";

const row = (id: string, created: string, updated: string): SessionRow =>
  ({
    id,
    status: "completed",
    title: id,
    project_root: "/repo",
    harness: "codex",
    exit_code: null,
    archived_at: null,
    created_at: created,
    updated_at: updated,
  }) as SessionRow;

// a: born first, touched last, short. b: born last, touched first, long.
const a = row("a", "2026-08-01T00:00:00.000Z", "2026-08-05T12:00:00.000Z");
const b = row("b", "2026-08-03T00:00:00.000Z", "2026-08-03T09:00:00.000Z");
const c = row("c", "2026-08-02T00:00:00.000Z", "2026-08-04T00:00:00.000Z");
const rows = [b, c, a];

test("an unrecognised or missing stored order falls back to recency", () => {
  assert.equal(normalizeChatSessionSort("duration"), "duration");
  assert.equal(normalizeChatSessionSort("nonsense"), "recent");
  assert.equal(normalizeChatSessionSort(null), "recent");
  assert.equal(normalizeChatSessionSort(undefined), "recent");
});

test("every order has both a menu label and a list heading", () => {
  for (const key of CHAT_SESSION_SORT_ORDER) {
    assert.ok(CHAT_SESSION_SORT_LABEL[key], `${key} has a menu label`);
    assert.ok(CHAT_SESSION_SORT_HEADING[key], `${key} has a list heading`);
  }
});

test("each order sorts by the field it names", () => {
  assert.deepEqual(sortChatSessionRows(rows, "recent").map((r) => r.id), ["a", "c", "b"]);
  assert.deepEqual(sortChatSessionRows(rows, "newest").map((r) => r.id), ["b", "c", "a"]);
  assert.deepEqual(sortChatSessionRows(rows, "oldest").map((r) => r.id), ["a", "c", "b"]);
  // Duration is updated − created, so `a` (4 days alive) beats `c` (2 days)
  // even though "oldest" also happens to put `a` first.
  assert.deepEqual(sortChatSessionRows(rows, "duration").map((r) => r.id), ["a", "c", "b"]);
  assert.notEqual(sortChatSessionRows(rows, "recent"), rows, "the source array is never mutated");
  assert.deepEqual(rows.map((r) => r.id), ["b", "c", "a"], "input order survives sorting");
});

test("duration never goes negative, even with a clock that runs backwards", () => {
  const backwards = row("x", "2026-08-05T12:00:00.000Z", "2026-08-05T11:00:00.000Z");
  assert.equal(chatSessionDurationMs(backwards), 0);
  assert.equal(chatSessionDurationMs(b), 9 * 60 * 60 * 1000);
});

test("elapsed readouts stay a fixed width per unit band", () => {
  assert.equal(formatChatSessionDuration(0), "0s");
  assert.equal(formatChatSessionDuration(48_000), "48s");
  assert.equal(formatChatSessionDuration(59_400), "59s");
  // Rounding to the nearest second before splitting is what stops the readout
  // from ever printing a bare "60s" instead of rolling to the minute band.
  assert.equal(formatChatSessionDuration(59_999), "1m 00s");
  // Zero-padding the trailing half is what keeps a column of these from
  // jittering as runs tick past a single digit.
  assert.equal(formatChatSessionDuration(4 * 60_000 + 1_000), "4m 01s");
  assert.equal(formatChatSessionDuration(59 * 60_000 + 59_000), "59m 59s");
  assert.equal(formatChatSessionDuration(2 * 3_600_000 + 4 * 60_000), "2h 04m");
  assert.equal(formatChatSessionDuration(50 * 3_600_000), "2d 02h");
  assert.equal(formatChatSessionDuration(-5_000), "0s", "a negative span reads as zero, not as garbage");
});
