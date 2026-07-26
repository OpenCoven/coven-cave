import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const view = await read(`${iosRoot}/Views/FamiliarThreadsView.swift`);

// Model deletes a set of threads in one persist.
assert.match(
  model,
  /func deleteThreads\(_ ids: Set<String>\) \{[\s\S]*threads\.removeAll \{ ids\.contains\(\$0\.id\) \}\s*persistThreads\(\)/,
  "AppModel.deleteThreads should bulk-remove and persist",
);

// View has a select mode, selection marks, and a bulk-delete bar.
assert.match(view, /@State private var selectMode = false/, "view should have a select mode");
assert.match(view, /@State private var selectedIds: Set<String> = \[\]/, "view should track selected ids");
assert.match(view, /if selectMode \{ selectionMark\(for: entry\) \}/, "rows show a selection mark in select mode");
assert.match(view, /func tapEntry\(_ entry: Entry\) \{[\s\S]*if selectMode \{[\s\S]*toggleSelection\(thread\.id\)/, "tapping a row toggles selection in select mode");
assert.match(view, /Button\("Select"\) \{ withAnimation \{ selectMode = true \} \}/, "a Select action enters the mode");
assert.match(view, /Text\(selectedIds\.isEmpty \? "Delete" : "Delete \(\\\(selectedIds\.count\)\)"\)/, "a Delete (N) button reflects the count");
assert.match(view, /app\.deleteThreads\(selectedIds\)\s*exitSelect\(\)/, "confirming deletes the selection then exits");
assert.match(view, /Set\(localThreads\.map\(\\\.id\)\)\.isSubset\(of: selectedIds\)/, "Select All covers every local thread");
// Server-only sessions can't be bulk-deleted.
assert.match(view, /if case \.local\(let thread\) = entry \{ toggleSelection\(thread\.id\) \}/, "only local threads are selectable");

console.log("ios-bulk-delete-threads.test.mjs: ok");
