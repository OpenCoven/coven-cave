// @ts-nocheck
// A familiar with no failure-distillation entries must not render the
// filter dropdowns or the empty list/detail placeholder panes — that
// scaffolding is noise when there is nothing to browse. The browser
// still renders in full for workspaces that have entries (e.g. echo).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./memory-inspector-panel.tsx", import.meta.url), "utf8");

assert.match(
  src,
  /failures\.length === 0 \? \(/,
  "panel branches on having zero failure entries",
);
assert.match(
  src,
  /failures\.length === 0 \? \([\s\S]{0,300}No failure distillations yet\./,
  "empty state is a single quiet line",
);
assert.match(
  src,
  /\) : \(\s*<>\s*<FilterBar/,
  "filter bar renders only in the non-empty branch",
);

console.log("memory-inspector-empty.test.ts OK");
