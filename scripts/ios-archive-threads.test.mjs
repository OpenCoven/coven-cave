import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const thread = await read(`${iosRoot}/State/ChatThread.swift`);
const model = await read(`${iosRoot}/State/AppModel.swift`);
const home = await read(`${iosRoot}/Views/ChatsHomeView.swift`);
const familiarThreads = await read(`${iosRoot}/Views/FamiliarThreadsView.swift`);

assert.match(thread, /var archived: Bool = false/, "ChatThread should carry an archived flag");
assert.match(thread, /var archived: Bool\?/, "ThreadSnapshot.archived should be optional for back-compat");
assert.match(thread, /self\.archived = s\.archived \?\? false/, "snapshot decode should default archived to false");
assert.match(thread, /ThreadSnapshot\([\s\S]*archived: archived\)/, "snapshot encode should include archived");

assert.match(
  model,
  /func setThreadArchived\(_ thread: ChatThread, _ archived: Bool\) \{[\s\S]*target\.archived = archived[\s\S]*persistThreads\(\)/,
  "AppModel.setThreadArchived should set the flag and persist",
);

for (const [name, src] of [["ChatsHomeView", home], ["FamiliarThreadsView", familiarThreads]]) {
  assert.match(src, /showArchived/, `${name} should track a showArchived toggle`);
  assert.match(src, /app\.setThreadArchived\(thread, !thread\.archived\)/, `${name} should toggle archive state`);
  assert.match(src, /thread\.archived \? "Unarchive" : "Archive"/, `${name} should label the archive action by state`);
  assert.match(src, /showArchived \|\| !\$0\.archived/, `${name} should filter out archived by default`);
  assert.match(src, /"Hide archived"/, `${name} should offer a reveal toggle`);
}

console.log("ios-archive-threads.test.mjs: ok");
