// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");

// The filtered memo must hard-scope to the active familiar — switching
// familiars should re-scope the board the same way ChatList does for chats.
assert.match(
  source,
  /activeFamiliarId === null \|\| c\.familiarId === activeFamiliarId/,
  "BoardView must filter cards by activeFamiliarId (null allowed as a defensive escape hatch)",
);

assert.match(
  source,
  /\[cards, familiarsById, searchQuery, activeFamiliarId\]/,
  "BoardView filtered memo dependency array must include activeFamiliarId so re-filter triggers on familiar switch",
);

// Stats must reflect the visible (filtered) set, not the full unfiltered
// cards array — otherwise "Total: 2" would render next to "Running: 15".
assert.match(
  source,
  /running:\s*filtered\.filter/,
  "BoardView running count must derive from filtered, not cards",
);

assert.match(
  source,
  /blocked:\s*filtered\.filter/,
  "BoardView blocked count must derive from filtered, not cards",
);

assert.match(
  source,
  /const tableGroupBy: GroupBy = activeFamiliarId === null \? groupBy : "status";/,
  "Scoped familiar table view should force status grouping instead of offering a redundant familiar/status switch",
);

assert.match(
  source,
  /<BoardTable[\s\S]{0,180}groupBy=\{tableGroupBy\}/,
  "BoardTable should receive the effective scoped table grouping",
);

console.log("board-view-familiar-scope.test.ts: ok");
