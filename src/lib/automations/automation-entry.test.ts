// @ts-nocheck
import assert from "node:assert/strict";
import { humanRecurrence } from "./automation-entry.ts";

// humanRecurrence covers every Recurrence shape.
assert.equal(humanRecurrence(undefined), "One-time");
assert.equal(humanRecurrence({ type: "none" }), "One-time");
assert.equal(humanRecurrence({ type: "interval", everyMs: 30 * 60000 }), "Every 30m");
assert.equal(humanRecurrence({ type: "interval", everyMs: 3 * 3600_000 }), "Every 3h");
assert.equal(humanRecurrence({ type: "daily", hour: 9, minute: 5 }), "Daily at 09:05");
assert.equal(humanRecurrence({ type: "weekly", days: [1, 3], hour: 14, minute: 0 }), "Mon/Wed at 14:00");
assert.equal(humanRecurrence({ type: "cron", expr: "0 9 * * 1" }), "Cron: 0 9 * * 1");
// An injected time formatter (e.g. the view's clock-pref-aware one) is used for
// the hour:minute, while the rest of the line stays identical.
const ampm = (h: number, m: number) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
assert.equal(humanRecurrence({ type: "daily", hour: 14, minute: 0 }, ampm), "Daily at 2:00 PM");
assert.equal(humanRecurrence({ type: "weekly", days: [1, 3], hour: 9, minute: 30 }, ampm), "Mon/Wed at 9:30 AM");

console.log("automation-entry.test.ts: ok");
