import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/Models/Reminder.swift`);
const client = await read(`${iosRoot}/Networking/CaveClient.swift`);
const app = await read(`${iosRoot}/State/AppModel.swift`);
const view = await read(`${iosRoot}/Views/RemindersView.swift`);
const tasks = await read(`${iosRoot}/Views/TasksView.swift`);

// Model + client speak the inbox contract.
assert.match(model, /struct Reminder: Identifiable, Codable, Hashable/, "a Reminder model exists");
assert.match(model, /struct InboxResponse: Decodable \{ let ok: Bool; let items: \[Reminder\] \}/, "inbox response wrapper");
assert.match(client, /func reminders\(\) async throws -> \[Reminder\][\s\S]*request\("api\/inbox"\)[\s\S]*\.filter \{ \$0\.kind == "reminder" \}/, "reminders() GETs /api/inbox and filters reminders");
assert.match(client, /func deleteReminder\(id: String\) async throws[\s\S]*method: "DELETE"/, "deleteReminder DELETEs /api/inbox/{id}");

// Model bulk-deletes optimistically.
assert.match(app, /var reminders: \[Reminder\] = \[\]/, "AppModel holds reminders");
assert.match(app, /func loadReminders\(\) async/, "AppModel loads reminders");
assert.match(
  app,
  /func deleteReminders\(_ ids: Set<String>\) async \{[\s\S]*reminders\.removeAll \{ ids\.contains\(\$0\.id\) \}[\s\S]*for id in ids \{ try await client\.deleteReminder\(id: id\) \}[\s\S]*catch[\s\S]*reminders = previous/,
  "deleteReminders is optimistic + reverts on failure",
);

// View: bulk-select mode wired to deleteReminders, reachable from Tasks.
assert.match(view, /struct RemindersView: View/, "a RemindersView exists");
assert.match(view, /@State private var selectMode = false/, "view has a select mode");
assert.match(view, /await app\.deleteReminders\(selectedIds\)/, "bulk delete uses the selection");
assert.match(view, /Text\(selectedIds\.isEmpty \? "Delete" : "Delete \(\\\(selectedIds\.count\)\)"\)/, "Delete (N) bar");
assert.match(tasks, /\.sheet\(isPresented: \$showReminders\) \{ RemindersView\(\) \}/, "Tasks tab opens Reminders");

console.log("ios-reminders-bulk-delete.test.mjs: ok");
