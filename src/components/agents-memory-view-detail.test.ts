// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// ───────── #5 Selected-file inline preview ─────────

assert.match(source, /function MemoryFilePreview\(\{ path \}/, "A MemoryFilePreview component must exist");
assert.match(
  source,
  /\/api\/memory\/file\?path=\$\{encodeURIComponent\(path\)\}/,
  "Preview must fetch the redaction-safe memory/file endpoint",
);
assert.match(source, /<MemoryFilePreview path=\{entry\.fullPath\} \/>/, "The file drawer must render the inline preview");
assert.match(source, /Showing first \{MAX_LINES\} lines/, "Preview must disclose when it clips long files");

// ───────── #6 basename-prominent rows + file size ─────────

assert.match(source, /function fileBase\(/, "fileBase helper must exist");
assert.match(source, /function fileDir\(/, "fileDir helper must exist");
assert.match(source, /function formatBytes\(/, "formatBytes helper must exist");
assert.match(
  source,
  /const base = fileBase\(entry\.relPath\);/,
  "Each file row must derive a prominent basename",
);
assert.match(
  source,
  /<span className="block truncate text-\[12px\] font-medium text-\[var\(--text-primary\)\]" title=\{entry\.relPath\}>\{base\}<\/span>/,
  "Row title must show the basename (full relPath on hover)",
);

// formatBytes is sane (extract + eval the body as plain JS).
{
  const m = source.match(/function formatBytes\(n[^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(m, "formatBytes body must be extractable");
  const body = m[1].replace(/: number \| undefined/g, "").replace(/: string/g, "");
  const formatBytes = new Function("n", body);
  assert.equal(formatBytes(0), "", "0/undefined size renders nothing");
  assert.equal(formatBytes(512), "512 B", "bytes under 1KB show as B");
  assert.equal(formatBytes(2048), "2.0 KB", "KB formatting");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB", "MB formatting");
}

// ───────── #8 sort control ─────────

assert.match(
  source,
  /const \[sortMode, setSortMode\] = useState<"recent" \| "oldest" \| "name" \| "size" \| "staleFirst">\("recent"\);/,
  "Files must default to recency sort with the extended sort alternatives",
);
// Sort now lives in the management controls bar (group/sort/stale-only).
assert.match(source, /value=\{sortMode\}/, "Sort control must be bound to sortMode");
for (const opt of ["recent", "name", "size"]) {
  assert.ok(source.includes(`value="${opt}"`), `Sort option ${opt} must be offered`);
}
assert.match(source, /\.sort\(cmp\[sortMode\]\)/, "visibleFiles must sort by the active mode");

// ───────── #9 search a11y + clear ─────────

assert.match(source, /aria-label="Clear search"/, "Search must offer a labelled clear button");
assert.match(source, /aria-label="Filter memory by familiar"/, "Familiar select must be labelled");
assert.match(
  source,
  /event\.key === "Escape" && query/,
  "Escape in the search field must clear the query",
);

// ───────── #10 last-refreshed indicator ─────────

assert.match(
  source,
  /const \[lastLoadedAt, setLastLoadedAt\] = useState<string \| null>\(null\);/,
  "Component must track the last refresh time",
);
assert.match(source, /setLastLoadedAt\(new Date\(\)\.toISOString\(\)\);/, "load() must stamp the refresh time");
assert.match(source, /Updated \{age\(lastLoadedAt\)\}/, "Header must surface a human 'Updated …' indicator");

console.log("agents-memory-view-detail.test.ts: ok");
