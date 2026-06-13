// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// ───────── Source-kind filter chips ─────────

assert.match(
  source,
  /const \[sourceFilter, setSourceFilter\] = useState<"all" \| FileMemoryEntry\["sourceKind"\]>\("all"\);/,
  "AgentsMemoryView must track a source-kind filter",
);

assert.match(
  source,
  /sourceFilter === "all" \|\| entry\.sourceKind === sourceFilter/,
  "Memory files must be filtered by the active source-kind filter",
);

assert.match(
  source,
  /function SourceFilterChip\(/,
  "A SourceFilterChip component must exist for the interactive stats",
);

assert.match(
  source,
  /aria-pressed=\{active\}/,
  "Source filter chips must expose pressed state for accessibility",
);

for (const wired of ["coven-origin", "external-harness", "runtime"]) {
  assert.ok(
    source.includes(`s === "${wired}" ? "all" : "${wired}"`),
    `Clicking the ${wired} chip must toggle the filter on/off`,
  );
}

// ───────── Honest count + show-more pagination ─────────

assert.match(
  source,
  /onShowMore\?: \(\) => void;/,
  "MemoryFilesList must accept an onShowMore callback",
);

assert.match(
  source,
  /const hidden = entries\.length - sliced\.length;/,
  "MemoryFilesList must compute how many entries are hidden by the cap",
);

assert.match(
  source,
  /Show \{Math\.min\(hidden, 80\)\} more · \{sliced\.length\} of \{entries\.length\}/,
  "MemoryFilesList footer must honestly report shown-of-total",
);

assert.match(
  source,
  /setFileLimit\(\(n\) => n \+ FILE_PAGE\)/,
  "Show-more must grow the file render cap incrementally",
);

// Pagination resets when the result set changes underneath the user.
assert.match(
  source,
  /useEffect\(\(\) => \{ setFileLimit\(FILE_PAGE\); \}, \[q, sourceFilter, familiarFilter\]\);/,
  "File pagination must reset on query / filter / familiar change",
);

// ───────── Empty familiar column collapses ─────────

assert.match(
  source,
  /const hasFamiliar = visibleCoven\.length > 0;/,
  "Layout must know whether the active familiar has any memories",
);

// When there are no familiar memories and the drawer is closed, the grid drops
// to a single full-width track for the files list (no empty 1fr familiar column).
assert.match(
  source,
  /: selectedRowId\s*\n\s*\? "grid gap-4 overflow-y-auto p-4 xl:grid-cols-\[minmax\(0,1fr\)_minmax\(280px,360px\)\]"\s*\n\s*: "grid gap-4 overflow-y-auto p-4";/,
  "Empty familiar layout must collapse to files-only (and files+drawer) tracks",
);

assert.match(
  source,
  /xl:col-\[1\/-1\]/,
  "The empty-familiar banner must span the full content width",
);

console.log("agents-memory-view-filter-paginate.test.ts: ok");
