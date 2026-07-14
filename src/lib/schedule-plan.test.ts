// @ts-nocheck
import assert from "node:assert/strict";
import { describeRecurrence, nextOccurrences } from "./schedule-plan.ts";

// ── describeRecurrence ───────────────────────────────────────────────────────
{
  assert.equal(describeRecurrence({ type: "none" }), null, "one-shots have no cadence sentence");
  assert.equal(describeRecurrence({ type: "interval", everyMs: 30 * 60_000 }), "every 30 min");
  assert.equal(describeRecurrence({ type: "interval", everyMs: 3_600_000 }), "every hour");
  assert.equal(describeRecurrence({ type: "interval", everyMs: 2 * 3_600_000 }), "every 2 hours");
  assert.equal(describeRecurrence({ type: "interval", everyMs: 90 * 60_000 }), "every 90 min");
  assert.equal(describeRecurrence({ type: "interval", everyMs: 30_000 }), "every 30s", "sub-minute intervals keep seconds");
  assert.equal(describeRecurrence({ type: "interval", everyMs: 90_000 }), "every 1m 30s", "non-minute-aligned intervals keep the remainder");
  assert.equal(describeRecurrence({ type: "daily", hour: 9, minute: 0 }), "every day at 9 AM");
  assert.equal(describeRecurrence({ type: "daily", hour: 9, minute: 0 }, { hour12: false }), "every day at 09:00");
  assert.equal(
    describeRecurrence({ type: "weekly", days: [1, 2, 3, 4, 5], hour: 9, minute: 0 }),
    "weekdays at 9 AM",
  );
  assert.equal(
    describeRecurrence({ type: "weekly", days: [0, 6], hour: 10, minute: 0 }),
    "weekends at 10 AM",
  );
  assert.equal(
    describeRecurrence({ type: "weekly", days: [5, 1, 3], hour: 8, minute: 30 }),
    "Mon, Wed, Fri at 8:30 AM",
    "days render sorted regardless of stored order",
  );
  assert.equal(describeRecurrence({ type: "cron", expr: "*/15 * * * *" }), "cron */15 * * * *");
}

// ── nextOccurrences ──────────────────────────────────────────────────────────
{
  // Tuesday 2026-07-14 10:00 local.
  const NOW = new Date(2026, 6, 14, 10, 0, 0, 0).getTime();
  const iso = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi, 0, 0).toISOString();

  assert.deepEqual(nextOccurrences({ type: "none" }, NOW, 3), [], "one-shots produce no sequence");

  const interval = nextOccurrences({ type: "interval", everyMs: 3_600_000 }, NOW, 3);
  assert.equal(interval.length, 3);
  assert.equal(new Date(interval[1]).getTime() - new Date(interval[0]).getTime(), 3_600_000, "steps chain without drift");

  assert.deepEqual(
    nextOccurrences({ type: "daily", hour: 9, minute: 0 }, NOW, 3),
    [iso(2026, 6, 15, 9, 0), iso(2026, 6, 16, 9, 0), iso(2026, 6, 17, 9, 0)],
  );

  assert.deepEqual(
    nextOccurrences({ type: "weekly", days: [1, 3, 5], hour: 8, minute: 30 }, NOW, 3),
    [iso(2026, 6, 15, 8, 30), iso(2026, 6, 17, 8, 30), iso(2026, 6, 20, 8, 30)],
    "weekly walks its day set across the week boundary",
  );

  assert.deepEqual(nextOccurrences({ type: "weekly", days: [], hour: 9, minute: 0 }, NOW, 3), [], "empty day set can't fire");
  assert.deepEqual(nextOccurrences({ type: "cron", expr: "not a cron" }, NOW, 3), [], "invalid cron fails closed");
  assert.equal(nextOccurrences({ type: "cron", expr: "*/15 * * * *" }, NOW, 4).length, 4, "valid cron produces the full window");
}

console.log("schedule-plan.test.ts: ok");
