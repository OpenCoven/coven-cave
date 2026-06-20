// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");

// Save is gated on a valid, changed form: not busy, dirty, named, and a valid
// schedule (weekly needs ≥1 day).
assert.match(
  source,
  /const canSave = !busy && dirty && name\.trim\(\)\.length > 0 && !invalidSchedule;/,
  "Save is disabled unless the form is changed, named, and has a valid schedule",
);
assert.match(
  source,
  /scheduleMode === "weekly" && scheduleDays\.length === 0/,
  "a weekly schedule with no days selected is treated as invalid",
);

// A disabled Save must explain itself rather than being a dead button.
assert.match(
  source,
  /const saveBlockedReason =/,
  "an explicit reason is computed when the form blocks saving",
);
assert.match(
  source,
  /Pick at least one day for a weekly schedule\./,
  "weekly-with-no-days surfaces a specific, actionable message",
);
assert.match(
  source,
  /\{saveBlockedReason \?[\s\S]{0,160}?role="alert"/,
  "the blocking reason renders as an alert above the Save button",
);
assert.match(
  source,
  /disabled=\{!canSave\}/,
  "the Save button stays disabled while canSave is false",
);

console.log("automations-view.test.ts: ok");
