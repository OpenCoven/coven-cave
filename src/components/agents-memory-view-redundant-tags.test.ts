// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// Prop on the type.
assert.match(
  source,
  /type MemoryFilesListProps = \{[\s\S]*?activeFamiliarId\?:\s*string\s*\|\s*null/,
  "MemoryFilesListProps must declare activeFamiliarId",
);

// Prop destructured in the component signature.
assert.match(
  source,
  /export function MemoryFilesList\(\{[\s\S]*?activeFamiliarId,?[\s\S]*?\}: MemoryFilesListProps\)/,
  "MemoryFilesList must destructure activeFamiliarId",
);

// Conditional render that hides the familiar badge when it matches the filter.
assert.match(
  source,
  /entry\.familiarId\s*&&\s*entry\.familiarId\s*!==\s*activeFamiliarId\s*\?\s*<span/,
  "MemoryFilesList must hide the familiar:<id> badge when it matches the active filter",
);

// The internal call site in AgentsMemoryView must thread the filter through.
assert.match(
  source,
  /<MemoryFilesList[\s\S]*?activeFamiliarId=\{familiarFilter\}/,
  "AgentsMemoryView must pass familiarFilter as activeFamiliarId to MemoryFilesList",
);

console.log("agents-memory-view-redundant-tags.test.ts: ok");
