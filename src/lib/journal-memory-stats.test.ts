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

// ── journalDaySources — the entry pane's Sources chips ───────────────────────
// Files whose mtime lands on the entry's LOCAL day, scoped like the stats,
// newest-first, capped. Local-noon based ISO strings keep the test TZ-proof.
{
  const iso = (day, hour) => new Date(2026, 5, day, hour).toISOString(); // June = 5
  const { journalDaySources } = await import("./journal-memory-stats.ts");
  const dayEntries = [
    { sourceKind: "coven-origin", familiarId: "sage", relPath: "notes/a.md", fullPath: "/m/notes/a.md", rootLabel: "Coven", modified: iso(20, 9) },
    { sourceKind: "coven-origin", familiarId: "sage", relPath: "notes/b.md", fullPath: "/m/notes/b.md", rootLabel: "Coven", modified: iso(20, 15) },
    { sourceKind: "runtime", familiarId: "sage", runtimeId: "codex", relPath: "mem.md", fullPath: "/r/mem.md", rootLabel: "Codex", modified: iso(20, 11) },
    { sourceKind: "coven-origin", familiarId: "nova", relPath: "nova.md", fullPath: "/m/nova.md", rootLabel: "Coven", modified: iso(20, 12) },
    { sourceKind: "coven-origin", familiarId: "sage", relPath: "old.md", fullPath: "/m/old.md", rootLabel: "Coven", modified: iso(19, 12) },
    { sourceKind: "coven-origin", familiarId: "sage", relPath: "broken.md", fullPath: "/m/broken.md", rootLabel: "Coven", modified: "not a date" },
  ];
  assert.deepEqual(
    journalDaySources(dayEntries, "2026-06-20", "sage").map((s) => s.relPath),
    ["notes/b.md", "mem.md", "notes/a.md"],
    "sources are the familiar's files touched that local day, newest first",
  );
  assert.deepEqual(
    journalDaySources(dayEntries, "2026-06-20", "sage", 2).map((s) => s.relPath),
    ["notes/b.md", "mem.md"],
    "the source list caps at the limit",
  );
  assert.ok(
    journalDaySources(dayEntries, "2026-06-20", null).some((s) => s.relPath === "nova.md"),
    "an unscoped day (no single familiar) draws from every familiar's files",
  );
  assert.deepEqual(
    journalDaySources(dayEntries, "2026-06-18", "sage"),
    [],
    "a day nothing was touched has no sources",
  );
  assert.deepEqual(
    journalDaySources(dayEntries, "2026-06-20", "sage")[0],
    { relPath: "notes/b.md", fullPath: "/m/notes/b.md", rootLabel: "Coven" },
    "each source carries the reader deep-link fields (relPath, fullPath, rootLabel)",
  );
}

console.log("journal-memory-stats.test.ts: ok");
