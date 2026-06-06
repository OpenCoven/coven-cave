// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./library-github-list.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles/library.css", import.meta.url), "utf8");

assert.match(
  source,
  /const GITHUB_TABLE_COLUMN_COUNT = COLS\.length \+ 4;/,
  "GitHub table should define a single column-count constant for full-width rows",
);

assert.match(
  source,
  /className=\{`gh-row-action-strip-row/,
  "GitHub actions should render in their own bottom row",
);

assert.match(
  source,
  /<td colSpan=\{GITHUB_TABLE_COLUMN_COUNT\}>[\s\S]*gh-row-actions/,
  "GitHub action strip should span the full item row width",
);

assert.doesNotMatch(
  source,
  /<td onClick=\{\(e\) => e\.stopPropagation\(\)\}>[\s\S]*<div className="gh-row-actions">/,
  "GitHub actions should not occupy a tiny trailing table cell",
);

assert.match(
  styles,
  /\.gh-row-action-strip-row td/,
  "GitHub action strip row should have dedicated table-row spacing",
);

assert.match(
  styles,
  /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  "GitHub row actions should divide the full row width evenly",
);
