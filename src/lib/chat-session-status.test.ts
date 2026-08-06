import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_SESSION_STATUS,
  CHAT_SESSION_STATUS_ORDER,
  chatSessionStatusKey,
  chatStatusChipDisabled,
  countChatSessionStatuses,
  filterChatRowsByStatus,
} from "./chat-session-status.ts";
import type { SessionRow } from "./types.ts";

const row = (id: string, status: string): SessionRow =>
  ({
    id,
    status,
    title: id,
    project_root: "/repo",
    harness: "codex",
    exit_code: null,
    archived_at: null,
    created_at: "2026-08-05T10:00:00.000Z",
    updated_at: "2026-08-05T10:05:00.000Z",
  }) as SessionRow;

test("every reported status maps to a key; anything else reads as finished", () => {
  for (const key of CHAT_SESSION_STATUS_ORDER) {
    assert.equal(chatSessionStatusKey(key), key, `${key} maps to itself`);
  }
  assert.equal(chatSessionStatusKey("RUNNING"), "running", "case is normalized");
  assert.equal(chatSessionStatusKey(" queued "), "queued", "surrounding space is trimmed");
  // A status the daemon grows later must not render as an unlabelled blank
  // pill — it reads as a finished run, the same fallback the old style map used.
  assert.equal(chatSessionStatusKey("exited"), "completed", "unknown status falls back");
  assert.equal(chatSessionStatusKey(null), "completed", "missing status falls back");
});

test("state is never colour-only: running has a dot, every other state a glyph", () => {
  assert.equal(CHAT_SESSION_STATUS.running.icon, null, "running uses the breathing dot");
  for (const key of CHAT_SESSION_STATUS_ORDER) {
    if (key === "running") continue;
    assert.ok(CHAT_SESSION_STATUS[key].icon, `${key} carries a glyph beside its tint`);
  }
});

test("counts describe the whole set and always sum to `all`", () => {
  const rows = [
    row("a", "running"),
    row("b", "running"),
    row("c", "failed"),
    row("d", "completed"),
    row("e", "who-knows"),
  ];
  const counts = countChatSessionStatuses(rows);
  assert.equal(counts.all, 5);
  assert.equal(counts.running, 2);
  assert.equal(counts.failed, 1);
  // The unknown status folds into completed rather than vanishing — a chip row
  // whose numbers don't add up to the total is worse than no numbers.
  assert.equal(counts.completed, 2);
  const summed = CHAT_SESSION_STATUS_ORDER.reduce((n, key) => n + counts[key], 0);
  assert.equal(summed, counts.all, "per-status counts sum to the total");
});

test("filtering by status is exact; `all` passes everything through", () => {
  const rows = [row("a", "running"), row("b", "failed")];
  assert.deepEqual(filterChatRowsByStatus(rows, "all").map((r) => r.id), ["a", "b"]);
  assert.deepEqual(filterChatRowsByStatus(rows, "failed").map((r) => r.id), ["b"]);
  assert.deepEqual(filterChatRowsByStatus(rows, "paused").map((r) => r.id), []);
  assert.notEqual(filterChatRowsByStatus(rows, "all"), rows, "the source array is never handed back");
});

test("an empty chip stays pressable while it is the active filter", () => {
  // Otherwise pressing "Failed", watching the last failure get retried, and
  // then being unable to press anything to get back is a dead end.
  assert.equal(chatStatusChipDisabled(0, false), true, "empty and inactive → unavailable");
  assert.equal(chatStatusChipDisabled(0, true), false, "empty but active → still pressable");
  assert.equal(chatStatusChipDisabled(3, false), false, "populated → available");
});
