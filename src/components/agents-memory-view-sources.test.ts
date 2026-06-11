// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /sourceKind:\s*"coven-origin"\s*\|\s*"external-harness"\s*\|\s*"runtime"/,
  "AgentsMemoryView should accept memory API source-kind metadata",
);

assert.match(
  source,
  /sourceKindLabel/,
  "AgentsMemoryView should render a human label for native, harness, and runtime memory sources",
);

assert.match(
  source,
  /External harnesses/,
  "AgentsMemoryView should separately count external harness memory files",
);

assert.match(
  source,
  /Runtime memory/,
  "AgentsMemoryView should separately count runtime memory files",
);

assert.doesNotMatch(
  source,
  /fileEntries\s*\n\s*\.filter\(\(entry\) => entry\.familiarId === familiarFilter\)/,
  "Memory files list should include files across all harnesses and runtimes, not only the selected familiar",
);

console.log("agents-memory-view-sources.test.ts: ok");
