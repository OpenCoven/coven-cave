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

// List rows + detail-panel close buttons show a visible keyboard focus ring.
assert.ok(source.includes("focus-ring-inset automation-list-row"), "list rows have a focus ring");
assert.ok(source.includes("focus-ring rounded p-1 transition-colors hover:bg-white/5"), "panel close buttons have a focus ring");

// Reminders bulk-select: the shared multi-select hook + toolbar drive it.
assert.match(source, /useMultiSelect\(reminderVisible/, "reminders use the shared useMultiSelect hook over the visible rows");
assert.match(source, /<SelectionToolbar/, "select mode renders the shared SelectionToolbar");
assert.match(
  source,
  /role=\{selectMode \? "checkbox" : undefined\}/,
  "reminder rows flip from button to checkbox role in select mode",
);
assert.match(source, /aria-checked=\{selectMode \? checked : undefined\}/, "checkbox rows expose aria-checked");
// The three bulk actions exist and hit the right transitions.
assert.match(source, /bulkPatchReminders\(\{ status: "dismissed" \}\)/, "bulk Pause dismisses the selected reminders");
assert.match(source, /bulkPatchReminders\(\{ status: "pending" \}\)/, "bulk Resume re-pends the selected reminders");
assert.match(source, /const bulkDeleteReminders = \(\) =>/, "bulk Delete is wired (deferred + undoable, no async confirm)");
assert.match(source, /scheduleDelete\(ids,/, "bulk Delete routes through the deferred useUndoDelete helper");
// Ephemeral inbox items can't be mutated server-side, so they're filtered out.
assert.match(source, /\.filter\(\(id\) => !id\.startsWith\("eph:"\)\)/, "bulk actions skip ephemeral (eph:) ids");

console.log("automations-view.test.ts: ok");
