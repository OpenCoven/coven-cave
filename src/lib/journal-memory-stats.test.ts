// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildJournalMemoryContext,
  buildJournalMemoryStats,
  journalMemoryEntriesForFamiliar,
} from "./journal-memory-stats.ts";

const entries = [
  { sourceKind: "coven-origin", familiarId: "sage", relPath: "sage.md" },
  { sourceKind: "external-harness", familiarId: "sage", relPath: "MEMORY.md" },
  { sourceKind: "runtime", familiarId: "sage", runtimeId: "codex", relPath: "memory_summary.md" },
  { sourceKind: "runtime", runtimeId: "codex", relPath: "shared.md" },
  { sourceKind: "coven-origin", familiarId: "nova", relPath: "nova.md" },
];

const scoped = journalMemoryEntriesForFamiliar(entries, "sage");
assert.deepEqual(
  scoped.map((entry) => entry.relPath),
  ["sage.md", "MEMORY.md", "memory_summary.md"],
  "selected familiar memory includes only files attributed to that familiar",
);

assert.deepEqual(
  buildJournalMemoryStats(entries, "sage"),
  { covenOrigin: 1, externalRuntimes: 1, runtimeMemory: 1 },
  "journal memory stats count every selected-familiar memory source family",
);

assert.match(
  buildJournalMemoryContext("2026-06-20", "sage", buildJournalMemoryStats(entries, "sage")),
  /sage memory spans 1 Coven origin file, 1 external runtime file, and 1 runtime memory file/,
  "journal reflection context summarizes selected familiar memory coverage",
);
assert.match(
  buildJournalMemoryContext("2026-06-20", "sage", buildJournalMemoryStats(entries, "sage")),
  /ignore shared, global, or unattributed memory files/,
  "journal reflection context excludes unattributed memory from selected-familiar reflections",
);

console.log("journal-memory-stats.test.ts: ok");
