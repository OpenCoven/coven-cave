import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const thread = await read(`${iosRoot}/State/ChatThread.swift`);
const model = await read(`${iosRoot}/State/AppModel.swift`);
const home = await read(`${iosRoot}/Views/ChatsHomeView.swift`);
const familiarThreads = await read(`${iosRoot}/Views/FamiliarThreadsView.swift`);

assert.match(thread, /var muted: Bool = false/, "ChatThread should carry a muted flag");
assert.match(thread, /var muted: Bool\?/, "ThreadSnapshot.muted should be optional for back-compat");
assert.match(thread, /self\.muted = s\.muted \?\? false/, "snapshot decode should default muted to false");
assert.match(thread, /pinned: pinned, muted: muted\)/, "snapshot encode should include muted");

assert.match(
  model,
  /func setThreadMuted\(_ thread: ChatThread, _ muted: Bool\) \{[\s\S]*target\.muted = muted[\s\S]*persistThreads\(\)/,
  "AppModel.setThreadMuted should set the flag and persist",
);

for (const [name, src] of [["ChatsHomeView", home], ["FamiliarThreadsView", familiarThreads]]) {
  assert.match(src, /app\.setThreadMuted\(thread, !thread\.muted\)/, `${name} should toggle mute state`);
  assert.match(src, /thread\.muted \? "Unmute" : "Mute"/, `${name} should label the mute action by state`);
}
assert.match(home, /if thread\.muted \{[\s\S]*bell\.slash\.fill/, "ThreadRow should show a muted indicator");

console.log("ios-mute-threads.test.mjs: ok");
