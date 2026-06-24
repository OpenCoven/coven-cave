import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const client = await read(`${iosRoot}/Networking/CaveClient.swift`);
const app = await read(`${iosRoot}/State/AppModel.swift`);
const view = await read(`${iosRoot}/Views/RemindersView.swift`);

// Client posts done/dismiss/snooze to /api/inbox/{id}/{action}.
assert.match(client, /func inboxAction\(_ id: String, _ action: String, body: Data\? = nil\) async throws -> Reminder\?/, "shared inbox action poster");
assert.match(client, /api\/inbox\/\\\(escaped\)\/\\\(action\)", method: "POST"/, "posts to the action sub-route");
assert.match(client, /func markReminderDone\(id: String\)[\s\S]*inboxAction\(id, "done"\)/, "done action");
assert.match(client, /func dismissReminder\(id: String\)[\s\S]*inboxAction\(id, "dismiss"\)/, "dismiss action");
assert.match(client, /func snoozeReminder\(id: String, minutes: Int\)[\s\S]*"snooze", body: try JSONEncoder\(\)\.encode\(\["minutes": minutes\]\)/, "snooze sends minutes");

// Model applies optimistic status + reconciles from the echoed item.
assert.match(app, /func markReminderDone\(_ reminder: Reminder\) async/, "AppModel.markReminderDone");
assert.match(app, /func snoozeReminder\(_ reminder: Reminder, minutes: Int\) async/, "AppModel.snoozeReminder");
assert.match(app, /func reminderAction\(_ reminder: Reminder, optimistic: String,[\s\S]*applyReminder\(id: reminder\.id\) \{ \$0\.status = optimistic \}[\s\S]*if let updated = try await call\(client\)[\s\S]*catch[\s\S]*reminders = previous/, "optimistic + reconcile + revert");

// View exposes the actions.
assert.match(view, /Task \{ await app\.markReminderDone\(reminder\) \}/, "Done wired in the view");
assert.match(view, /Task \{ await app\.snoozeReminder\(reminder, minutes: 60\) \}/, "Snooze durations wired");
assert.match(view, /Task \{ await app\.dismissReminder\(reminder\) \}/, "Dismiss wired");
assert.match(view, /Label\("Snooze", systemImage: "moon\.zzz"\)/, "Snooze submenu present");

console.log("ios-reminder-actions.test.mjs: ok");
