import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_SESSION_STATUS,
  CHAT_SESSION_STATUS_ORDER,
  chatSessionStateFromLifecycle,
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


// ── chatSessionStateFromLifecycle ──────────────────────────────────────────
// The bridge cave-dkdev added between the turn lifecycle and the ONE status
// vocabulary both session surfaces speak. It landed untested (flagged in review
// on #5283); these pin the decisions that are easy to get wrong later, because
// every one is a case where the old header said something the list did not.

const st = (over: Partial<Parameters<typeof chatSessionStateFromLifecycle>[0]> = {}) =>
  chatSessionStateFromLifecycle({
    lifecycle: null,
    busy: false,
    error: false,
    daemonRunning: true,
    ...over,
  });

test("a missing daemon reads paused-and-reconnecting, outranking everything else", () => {
  // No daemon means there is no run to report on, so this must win even with a
  // lifecycle in flight — otherwise the header claims a session is running
  // against a backend that is gone.
  assert.deepEqual(st({ daemonRunning: false }), { key: "paused", transport: "reconnecting" });
  assert.deepEqual(st({ daemonRunning: false, lifecycle: "streaming", busy: true }), {
    key: "paused",
    transport: "reconnecting",
  });
  assert.deepEqual(st({ daemonRunning: false, lifecycle: "failed", error: true }), {
    key: "paused",
    transport: "reconnecting",
  });
});

test("failure comes from either the lifecycle or the error flag, and outranks live work", () => {
  assert.deepEqual(st({ lifecycle: "failed" }), { key: "failed", transport: null });
  assert.deepEqual(st({ error: true }), { key: "failed", transport: null });
  assert.deepEqual(st({ error: true, busy: true, lifecycle: "streaming" }), {
    key: "failed",
    transport: null,
  });
});

test("transport modifies live work; it is never a status of its own", () => {
  // The whole point of the change: `connecting` describes the wire. A
  // connecting session is RUNNING, and the pill must still say so.
  assert.deepEqual(st({ lifecycle: "connecting", busy: true }), {
    key: "running",
    transport: "connecting",
  });
  assert.deepEqual(st({ lifecycle: "queued" }), { key: "queued", transport: "connecting" });
  // Once bytes flow there is no wire condition left to report.
  assert.deepEqual(st({ lifecycle: "streaming", busy: true }), { key: "running", transport: null });
  assert.deepEqual(st({ lifecycle: "tooling", busy: true }), { key: "running", transport: null });
});

test("cancellation reads paused, a settled turn reads completed, and busy alone reads running", () => {
  assert.deepEqual(st({ lifecycle: "cancelled" }), { key: "paused", transport: null });
  assert.deepEqual(st({ lifecycle: "complete" }), { key: "completed", transport: null });
  assert.deepEqual(st(), { key: "completed", transport: null });
  // The first tick of a send arrives before any lifecycle event does.
  assert.deepEqual(st({ busy: true }), { key: "running", transport: null });
});

test("every mapping names a state the list vocabulary already has", () => {
  const cases: Parameters<typeof chatSessionStateFromLifecycle>[0][] = [
    { lifecycle: null, busy: false, error: false, daemonRunning: true },
    { lifecycle: "queued", busy: false, error: false, daemonRunning: true },
    { lifecycle: "connecting", busy: true, error: false, daemonRunning: true },
    { lifecycle: "streaming", busy: true, error: false, daemonRunning: true },
    { lifecycle: "tooling", busy: true, error: false, daemonRunning: true },
    { lifecycle: "cancelled", busy: false, error: false, daemonRunning: true },
    { lifecycle: "failed", busy: false, error: false, daemonRunning: true },
    { lifecycle: "complete", busy: false, error: false, daemonRunning: true },
    { lifecycle: null, busy: false, error: false, daemonRunning: false },
  ];
  for (const input of cases) {
    const result = chatSessionStateFromLifecycle(input);
    assert.ok(
      CHAT_SESSION_STATUS_ORDER.includes(result.key),
      `${result.key} must be one of the list's five states`,
    );
    // A pill can only render a presentation that exists.
    assert.ok(CHAT_SESSION_STATUS[result.key], `${result.key} has a presentation`);
  }
});
