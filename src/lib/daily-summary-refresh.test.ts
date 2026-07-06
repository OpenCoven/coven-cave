// @ts-nocheck
import assert from "node:assert/strict";
import {
  DAILY_REFRESH_MIN_INTERVAL_MS,
  DAILY_REFRESH_POLL_MS,
  dailySummarySignature,
  shouldRefreshDailySummary,
} from "./daily-summary-refresh.ts";

const now = new Date("2026-06-18T21:15:00.000Z");

const item = (over = {}) => ({
  id: "item-1",
  kind: "reminder",
  title: "Review release notes",
  body: "",
  status: "fired",
  createdAt: "2026-06-18T12:00:00.000Z",
  updatedAt: "2026-06-18T15:00:00.000Z",
  fireAt: "2026-06-18T15:00:00.000Z",
  firedAt: "2026-06-18T15:00:00.000Z",
  snoozeUntil: null,
  recurrence: { type: "none" },
  source: "user",
  familiarId: null,
  sessionId: null,
  link: null,
  auto: null,
  ...over,
});

const session = (over = {}) => ({
  id: "s1",
  title: "Fix board chat route",
  status: "completed",
  updated_at: "2026-06-18T20:00:00.000Z",
  created_at: "2026-06-18T19:00:00.000Z",
  project_root: "/repo/coven-cave",
  harness: "codex",
  model: "gpt-5",
  exit_code: 0,
  archived_at: null,
  familiarId: "sage",
  ...over,
});

// --- signature -------------------------------------------------------------

const base = dailySummarySignature({ items: [item()], sessions: [session()], now });
assert.equal(
  base,
  dailySummarySignature({ items: [item()], sessions: [session()], now }),
  "signature must be stable for identical inputs",
);
assert.notEqual(
  base,
  dailySummarySignature({ items: [item({ status: "done" })], sessions: [session()], now }),
  "an item status change must change the signature",
);
assert.notEqual(
  base,
  dailySummarySignature({
    items: [item()],
    sessions: [session({ updated_at: "2026-06-18T20:30:00.000Z" })],
    now,
  }),
  "a session update must change the signature",
);
assert.notEqual(
  base,
  dailySummarySignature({
    items: [item()],
    sessions: [session()],
    now: new Date("2026-06-19T21:15:00.000Z"),
  }),
  "the date slug is part of the signature",
);
assert.equal(
  base,
  dailySummarySignature({
    items: [
      item(),
      item({ id: "summary", kind: "daily-summary", auto: "daily-summary:2026-06-18" }),
    ],
    sessions: [session()],
    now,
  }),
  "the daily-summary item itself must not feed the signature (its own refresh would loop)",
);
assert.equal(
  base,
  dailySummarySignature({
    items: [item()],
    sessions: [session(), session({ id: "old", updated_at: "2026-06-10T09:00:00.000Z" })],
    now,
  }),
  "sessions from other days must not feed the signature",
);
assert.equal(
  base,
  dailySummarySignature({
    items: [item()],
    sessions: [session(), session({ id: "arch", archived_at: "2026-06-18T20:30:00.000Z" })],
    now,
  }),
  "archived sessions must not feed the signature",
);

// --- refresh policy ----------------------------------------------------------

const FIVE_MIN = DAILY_REFRESH_MIN_INTERVAL_MS;
assert.ok(FIVE_MIN < DAILY_REFRESH_POLL_MS, "poll fallback must be slower than the write throttle");

const decide = (over = {}) =>
  shouldRefreshDailySummary({
    hasItem: true,
    signature: "sig-b",
    lastSignature: "sig-a",
    lastAttemptAt: now.getTime() - FIVE_MIN,
    now,
    ...over,
  });

assert.equal(decide({ hasItem: false, lastAttemptAt: 0 }), true, "missing report → create immediately");
assert.equal(
  decide({ hasItem: false, lastAttemptAt: now.getTime() - 1000 }),
  false,
  "a just-attempted create must not re-fire before the min interval",
);
assert.equal(decide(), true, "signature change past the min interval → refresh");
assert.equal(
  decide({ lastAttemptAt: now.getTime() - 1000 }),
  false,
  "signature change inside the min interval → wait",
);
assert.equal(
  decide({ lastSignature: "sig-b" }),
  false,
  "unchanged signature → no refresh",
);
assert.equal(
  decide({ lastSignature: "sig-b", force: true }),
  true,
  "forced poll tick refreshes despite an unchanged signature",
);
assert.equal(
  decide({ lastSignature: "sig-b", force: true, lastAttemptAt: now.getTime() - 1000 }),
  false,
  "even a forced tick respects the write throttle",
);

console.log("daily-summary-refresh.test.ts: ok");
