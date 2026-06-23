import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift", import.meta.url),
  "utf8",
);

// A computed that finds direct threads by title, member name, and message text.
assert.match(home, /private var matchingThreads: \[ChatThread\]/, "should expose matchingThreads");
assert.match(home, /thread\.title\.lowercased\(\)\.contains\(q\)/, "should match by thread title");
assert.match(home, /\$0\.displayName\.lowercased\(\)\.contains\(q\)/, "should match by a member's name");
assert.match(home, /thread\.messages\.contains \{ \$0\.text\.lowercased\(\)\.contains\(q\) \}/, "should match by message text");
assert.match(home, /\.filter \{ !\$0\.isGroup && \(showArchived \|\| !\$0\.archived\) \}/, "should search direct, non-archived threads");

// A "Chats" results section, shown only when there are matches.
assert.match(home, /if !matchingThreads\.isEmpty \{[\s\S]*Section\("Chats"\) \{[\s\S]*ForEach\(matchingThreads\)/, "should render a Chats results section");
assert.match(home, /path\.append\(\.thread\(thread\)\)/, "results should open the thread");

// Empty-state accounts for thread matches too.
assert.match(
  home,
  /filteredFamiliars\.isEmpty && filteredGroups\.isEmpty && matchingThreads\.isEmpty/,
  "search empty-state should consider matching threads",
);

console.log("ios-thread-search.test.mjs: ok");
