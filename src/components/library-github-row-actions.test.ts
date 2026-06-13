// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./library-github-list.tsx", import.meta.url), "utf8");
const libraryView = await readFile(new URL("./library-view.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /const GITHUB_TABLE_COLUMN_COUNT = COLS\.length \+ 4;/,
  "GitHub table should define a single column-count constant for full-width rows",
);

// The row actions live in a dedicated trailing table cell on the main row
// (the earlier "own full-width bottom strip row" design was reverted).
assert.match(
  source,
  /<td className="gh-col-actions">[\s\S]*<div className="gh-row-actions"/,
  "GitHub actions should render in a dedicated trailing actions cell",
);

assert.match(
  source,
  /onOpenSession\?: \(sessionId: string, familiarId\?: string \| null\) => void;/,
  "GitHub list should accept the workspace chat opener",
);

assert.match(
  source,
  /onLaunched=\{\(familiarId, sessionId\) => \{[\s\S]*setHandoffItem\(null\);[\s\S]*if \(sessionId\) onOpenSession\?\.\(sessionId, familiarId\);[\s\S]*\}\}/,
  "Successful handoffs should close the modal and open the created chat session",
);

assert.match(
  libraryView,
  /<LibraryGitHubList[\s\S]*onOpenSession=\{onOpenSession\}/,
  "LibraryView should pass the workspace chat opener into the GitHub list",
);
