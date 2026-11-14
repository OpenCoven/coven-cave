// @ts-nocheck
// The shared snooze durations and the announcement a snooze makes (#6483).
import assert from "node:assert/strict";
import { DEFAULT_SNOOZE_OPTIONS, minutesUntilTomorrowMorning, snoozedUntilLabel } from "./snooze-options.ts";

assert.deepEqual(
  DEFAULT_SNOOZE_OPTIONS.map((o) => o.label),
  ["5 min", "30 min", "1 hour", "Tomorrow 9am"],
  "every snooze control offers the same four choices",
);
assert.deepEqual(DEFAULT_SNOOZE_OPTIONS.slice(0, 3).map((o) => o.minutes()), [5, 30, 60]);

// 9pm → 9am next day is 12 hours; 8:59am → 9am next day is a day and a minute.
assert.equal(minutesUntilTomorrowMorning(new Date(2026, 10, 12, 21, 0)), 12 * 60);
assert.equal(minutesUntilTomorrowMorning(new Date(2026, 10, 12, 8, 59)), 24 * 60 + 1);

const now = new Date(2026, 10, 12, 15, 0);
const later = new Date(2026, 10, 12, 15, 30).getTime();
const tomorrow = new Date(2026, 10, 13, 9, 0).getTime();
const nextWeek = new Date(2026, 10, 19, 9, 0).getTime();
assert.match(snoozedUntilLabel(later, now), /^Snoozed until \d{1,2}:30/);
assert.match(snoozedUntilLabel(tomorrow, now), /^Snoozed until tomorrow, \d{1,2}:00/);
assert.doesNotMatch(snoozedUntilLabel(nextWeek, now), /tomorrow/);
assert.match(snoozedUntilLabel(nextWeek, now), /^Snoozed until .+, \d{1,2}:00/);

console.log("snooze-options.test.ts: ok");
