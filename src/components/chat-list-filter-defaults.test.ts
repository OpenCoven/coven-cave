import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /readPersisted<unknown>\(PROJECT_SIDEBAR_KEYS\.selected/,
  "ChatList must not restore a persisted project filter",
);
assert.doesNotMatch(
  source,
  /localStorage\.setItem\(PROJECT_SIDEBAR_KEYS\.selected/,
  "ChatList project filtering should remain local to the current Sessions view",
);
assert.match(
  source,
  /const clearSessionFilters = useCallback\(\(\) => \{\s*setSearch\(""\);\s*setStatusFilter\("all"\);\s*setSelection\("all"\);\s*setShowArchived\(false\);\s*\}, \[\]\);/,
  "One reset should clear every non-familiar Sessions filter",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*clearSessionFilters\(\);\s*setSelectMode\(false\);\s*setSelectedIds\(new Set\(\)\);\s*\}, \[clearSessionFilters, familiar\?\.id\]\);/,
  "Changing familiars should restore the familiar-only default scope",
);
assert.match(
  source,
  /const hasAppliedFilters =\s*search\.trim\(\)\.length > 0 \|\|\s*statusFilter !== "all" \|\|\s*effectiveSelection !== "all" \|\|\s*showArchived;/,
  "The clear action should track search, status, project, and archive filters without treating familiar scope as a filter",
);
assert.match(
  source,
  /\{hasAppliedFilters && \([\s\S]*?onClick=\{clearSessionFilters\}[\s\S]*?Clear filters/,
  "ChatList should show a clear filters action whenever a non-familiar filter is active",
);

console.log("chat-list-filter-defaults.test.ts: ok");
