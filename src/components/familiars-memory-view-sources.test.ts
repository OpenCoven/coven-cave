// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /sourceKind:\s*"coven-origin"\s*\|\s*"external-harness"\s*\|\s*"runtime"/,
  "FamiliarsMemoryView should accept memory API source-kind metadata",
);

assert.match(
  source,
  /sourceKindLabel/,
  "FamiliarsMemoryView should render a human label for native, harness, and runtime memory sources",
);

assert.match(
  source,
  /External runtimes/,
  "FamiliarsMemoryView should separately count external runtime memory files",
);

assert.match(
  source,
  /Runtime memory/,
  "FamiliarsMemoryView should separately count runtime memory files",
);

assert.match(
  source,
  /entry\.familiarId == null \|\| entry\.familiarId === effectiveFamiliarFilter/,
  "Memory files list should show only the selected familiar's files plus shared files",
);

assert.match(
  source,
  /familiarFilter:\s*effectiveFamiliarFilter/,
  "Unified memory rows should use the same selected familiar filter as the compact file list",
);

console.log("familiars-memory-view-sources.test.ts: ok");
