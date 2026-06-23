import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const home = await read(`${iosRoot}/Views/ChatsHomeView.swift`);
const familiarThreads = await read(`${iosRoot}/Views/FamiliarThreadsView.swift`);

assert.match(model, /func duplicateThread\(_ thread: ChatThread\) -> ChatThread/, "AppModel should duplicate a thread");
assert.match(model, /title: "\\\(thread\.title\) \(copy\)"/, "the copy's title is suffixed with (copy)");
assert.match(model, /familiarIds: thread\.familiarIds/, "the copy keeps the participants");
assert.match(model, /thread\.messages\.map \{ message in[\s\S]*DisplayMessage\(role: message\.role/, "the copy carries fresh message copies");
assert.match(model, /let copy = ChatThread\(title:[\s\S]*threads\.insert\(copy, at: 0\)\s*persistThreads\(\)/, "inserts and persists the copy");
// No server session copied — duplicate starts clean.
assert.doesNotMatch(model, /func duplicateThread[\s\S]*sessionIds/, "the duplicate should not copy server sessionIds");

for (const [name, src] of [["ChatsHomeView", home], ["FamiliarThreadsView", familiarThreads]]) {
  assert.match(src, /Button \{ app\.duplicateThread\(thread\) \} label: \{[\s\S]*Label\("Duplicate", systemImage: "plus\.square\.on\.square"\)/, `${name} should offer a Duplicate action`);
}

console.log("ios-duplicate-thread.test.mjs: ok");
