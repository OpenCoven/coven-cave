import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift", import.meta.url),
  "utf8",
);

// A computed that finds conversations by title, member name, and message text
// (the unified Recent list from the chats-home redesign — direct and group).
assert.match(home, /private var recentThreads: \[ChatThread\]/, "should expose the search-aware recentThreads");
assert.match(home, /thread\.title\.lowercased\(\)\.contains\(q\)/, "should match by thread title");
assert.match(home, /\$0\.displayName\.lowercased\(\)\.contains\(q\)/, "should match by a member's name");
assert.match(home, /thread\.messages\.contains \{ \$0\.text\.lowercased\(\)\.contains\(q\) \}/, "should match by message text");
assert.match(home, /app\.threads\.filter \{ showArchived \|\| !\$0\.archived \}/, "should search non-archived threads unless archived are shown");

// The Recent section renders the matches, selection-tagged so the split view
// opens the conversation in the detail column (and pushes it when collapsed
// on iPhone).
assert.match(home, /ForEach\(recentThreads\)[\s\S]*?\.tag\(ChatRoute\.thread\(thread\)\)/, "results should open the thread via selection");

// Empty-state accounts for thread matches too.
assert.match(
  home,
  /filteredFamiliars\.isEmpty && recentThreads\.isEmpty/,
  "search empty-state should consider matching threads",
);

console.log("ios-thread-search.test.mjs: ok");
