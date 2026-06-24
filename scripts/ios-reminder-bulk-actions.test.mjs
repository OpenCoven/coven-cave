import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const app = await read(`${iosRoot}/State/AppModel.swift`);
const view = await read(`${iosRoot}/Views/RemindersView.swift`);

// Model bulk-applies each action across the selection, optimistic + revert.
for (const fn of ["markRemindersDone", "dismissReminders"]) {
  assert.match(app, new RegExp(`func ${fn}\\(_ ids: Set<String>\\) async`), `AppModel.${fn}`);
}
assert.match(app, /func snoozeReminders\(_ ids: Set<String>, minutes: Int\) async/, "AppModel.snoozeReminders");
assert.match(
  app,
  /func bulkReminderAction\(_ ids: Set<String>, optimistic: String,[\s\S]*for id in ids \{ applyReminder\(id: id\) \{ \$0\.status = optimistic \} \}[\s\S]*for id in ids \{[\s\S]*call\(client, id\)[\s\S]*catch[\s\S]*reminders = previous/,
  "bulkReminderAction is optimistic-for-all + reconcile + revert",
);

// Select bar offers all four bulk actions on the selection.
assert.match(view, /await app\.markRemindersDone\(selectedIds\); exitSelect\(\)/, "bulk Done on the selection");
assert.match(view, /await app\.snoozeReminders\(selectedIds, minutes: 60\); exitSelect\(\)/, "bulk Snooze on the selection");
assert.match(view, /await app\.dismissReminders\(selectedIds\); exitSelect\(\)/, "bulk Dismiss on the selection");
assert.match(view, /Text\(selectedIds\.isEmpty \? "Actions" : "Actions \(\\\(selectedIds\.count\)\)"\)/, "an Actions (N) menu");
assert.match(view, /Button\(role: \.destructive\) \{ confirmingBulkDelete = true \}/, "Delete stays in the menu");

console.log("ios-reminder-bulk-actions.test.mjs: ok");
