import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = [
  await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./familiars-memory-files.tsx", import.meta.url), "utf8"),
].join("\n");

// ───────── Source-kind filter popover ─────────

assert.match(
  source,
  /const \[sourceFilter, setSourceFilter\] = useSurfacePreference\(\s*surfacePreferenceSpecs\.familiarMemory\.source,\s*\);/,
  "FamiliarsMemoryView must persist its source-kind filter through the Workspace registry",
);

assert.match(
  source,
  /storedFamiliarFilter &&\s*familiarIds\.has\(storedFamiliarFilter\)[\s\S]{0,240}return;/,
  "a valid restored familiar filter must not be overwritten by the active workspace familiar",
);
assert.match(
  source,
  /const next =\s*activeFamiliar\?\.id && familiarIds\.has\(activeFamiliar\.id\)/,
  "the active familiar remains a fallback when no valid Memory preference exists",
);

assert.match(
  source,
  /sourceFilter === "all" \|\| entry\.sourceKind === sourceFilter/,
  "Memory files must be filtered by the active source-kind filter",
);

assert.match(source, /ariaLabel="Memory filters"/, "filters use the shared focus-return popover");
assert.match(source, /id=\{sourceSummaryId\}[\s\S]*Sources: \{memorySourceSummary\}[\s\S]*aria-describedby=\{sourceSummaryId\}/, "the compact trigger describes all source counts for assistive technology");
assert.match(source, /label="Source"[\s\S]*?value=\{sourceFilter\}[\s\S]*?onChange=\{setSourceFilter\}/, "source is selected inside the filter popover");
for (const wired of ["coven-origin", "external-harness", "runtime"]) {
  assert.ok(source.includes(`{ value: "${wired}",`), `${wired} remains an explicit source option`);
}
assert.match(source, /activeFilterSummary/, "the trigger summarizes active filters");

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
  /setFileLimit\(\(current\) => current \+ FILE_PAGE\)/,
  "Show-more must grow the file render cap incrementally",
);

// Pagination resets when the result set changes underneath the user.
assert.match(
  source,
  /useEffect\(\(\) => \{\s*setFileLimit\(FILE_PAGE\);\s*\}, \[\s*effectiveFamiliarFilter,\s*normalizedQuery,\s*sortMode,\s*sourceFilter,\s*staleOnly,\s*\]\);/,
  "File pagination must reset on query / filter / familiar change",
);

console.log("familiars-memory-view-filter-paginate.test.ts: ok");
