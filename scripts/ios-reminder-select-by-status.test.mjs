import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const view = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/RemindersView.swift", import.meta.url),
  "utf8",
);

// Status-aware select: a menu offering Select all + per-status options.
assert.match(view, /private let statusOrder = \["pending", "fired", "snoozed", "dismissed", "done"\]/, "ordered statuses");
assert.match(view, /private var statusesPresent: \[String\][\s\S]*statusOrder\.filter\(present\.contains\)/, "only present statuses are offered");
assert.match(
  view,
  /private func selectStatus\(_ status: String\) \{\s*selectedIds\.formUnion\(app\.reminders\.filter \{ \$0\.status == status \}\.map\(\\\.id\)\)/,
  "selectStatus unions every reminder of that status into the selection",
);
assert.match(
  view,
  /ForEach\(statusesPresent, id: \\\.self\) \{ status in\s*Button\("\\\(statusLabel\(status\)\) \(\\\(statusCount\(status\)\)\)"\) \{ selectStatus\(status\) \}/,
  "the Select menu lists each status with its count",
);
assert.match(view, /Button\(allSelected \? "Deselect all" : "Select all"\) \{ toggleSelectAll\(\) \}/, "Select/Deselect all stays available");

console.log("ios-reminder-select-by-status.test.mjs: ok");
