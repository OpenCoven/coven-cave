import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const thread = await read(`${iosRoot}/State/ChatThread.swift`);
const model = await read(`${iosRoot}/State/AppModel.swift`);
const home = await read(`${iosRoot}/Views/ChatsHomeView.swift`);
const familiarThreads = await read(`${iosRoot}/Views/FamiliarThreadsView.swift`);

assert.match(thread, /var pinned: Bool = false/, "ChatThread should carry a pinned flag");
assert.match(thread, /var pinned: Bool\?/, "ThreadSnapshot.pinned should be optional for back-compat");
assert.match(thread, /self\.pinned = s\.pinned \?\? false/, "snapshot decode should default pinned to false");
assert.match(thread, /archived: archived, pinned: pinned/, "snapshot encode should include pinned");

assert.match(
  model,
  /func setThreadPinned\(_ thread: ChatThread, _ pinned: Bool\) \{[\s\S]*target\.pinned = pinned[\s\S]*persistThreads\(\)/,
  "AppModel.setThreadPinned should set the flag and persist",
);
// Both list builders sort pinned threads first.
const sortCount = (model.match(/if a\.pinned != b\.pinned \{ return a\.pinned \}/g) || []).length;
assert.ok(sortCount >= 2, `pinned-first sort should apply to both lists (found ${sortCount})`);

for (const [name, src] of [["ChatsHomeView", home], ["FamiliarThreadsView", familiarThreads]]) {
  assert.match(src, /app\.setThreadPinned\(thread, !thread\.pinned\)/, `${name} should toggle pin state`);
  assert.match(src, /thread\.pinned \? "Unpin" : "Pin"/, `${name} should label the pin action by state`);
}
assert.match(home, /if thread\.pinned \{[\s\S]*pin\.fill/, "ThreadRow should show a pin indicator when pinned");

console.log("ios-pin-threads.test.mjs: ok");
