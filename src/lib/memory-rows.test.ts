import assert from "node:assert/strict";
import type { CanonicalMemorySummary } from "./canonical-memory.ts";
import * as memoryRowsModule from "./memory-rows.ts";
import { buildMemoryRows, groupMemoryRows, type MemoryRow } from "./memory-rows.ts";

const NOW = Date.parse("2026-06-13T12:00:00Z");

function canonical(
  overrides: Partial<CanonicalMemorySummary> = {},
): CanonicalMemorySummary {
  return {
    id: "c1",
    familiarId: "echo",
    title: "Daily note",
    updatedAt: "2026-06-13T11:00:00Z",
    relativeUpdatedAt: "1h ago",
    excerpt: "Remember the garden gate.",
    source: { kind: "distilled", label: "Coven index" },
    privacy: { classification: "private", revealRequired: true },
    verification: { state: "verified" },
    ...overrides,
  };
}

const files = [
  {
    fullPath: "/Users/x/.coven/echo/memory/old.md",
    relPath: "old.md",
    rootLabel: "echo",
    sourceKind: "coven-origin",
    sourceKindLabel: "Coven origin",
    size: 2048,
    modified: "2026-01-01T00:00:00Z",
    familiarId: "echo",
  },
  {
    fullPath: "/Users/x/.coven/echo/memory/new.md",
    relPath: "new.md",
    rootLabel: "echo",
    sourceKind: "runtime",
    sourceKindLabel: "Runtime memory",
    size: 100,
    modified: "2026-06-13T11:30:00Z",
    familiarId: "echo",
  },
];

function rows(
  overrides: Partial<Parameters<typeof buildMemoryRows>[0]> = {},
): MemoryRow[] {
  return buildMemoryRows({
    canonical: [canonical()],
    files,
    familiarFilter: "echo",
    query: "",
    sourceFilter: "all",
    sortMode: "recent",
    staleOnly: false,
    familiarLabel: (id) => (id === "echo" ? "Echo" : id),
    now: NOW,
    ...overrides,
  });
}

{
  const result = rows();
  assert.deepEqual(
    result.map((row) => row.rowId),
    [
      "file:/Users/x/.coven/echo/memory/new.md",
      "coven:c1",
      "file:/Users/x/.coven/echo/memory/old.md",
    ],
    "canonical and file rows interleave by recency",
  );
}

{
  const result = rows();
  const canonicalRow = result.find((row) => row.kind === "canonical");
  const fileRow = result.find((row) => row.kind === "file");
  assert.deepEqual(canonicalRow, {
    kind: "canonical",
    rowId: "coven:c1",
    memoryId: "c1",
    title: "Daily note",
    sortTime: "2026-06-13T11:00:00Z",
    sourceLabel: "Echo",
    excerpt: "Remember the garden gate.",
    privacy: { classification: "private", revealRequired: true },
    verification: { state: "verified" },
    stale: false,
  });
  assert.deepEqual(fileRow, {
    kind: "file",
    rowId: "file:/Users/x/.coven/echo/memory/new.md",
    title: "new.md",
    path: "/Users/x/.coven/echo/memory/new.md",
    contentPath: "/Users/x/.coven/echo/memory/new.md",
    sortTime: "2026-06-13T11:30:00Z",
    size: 100,
    sourceLabel: "Runtime memory",
    stale: false,
    protection: "normal",
  });
  for (const forbidden of ["path", "contentPath", "protection", "size"]) {
    assert.equal(
      Object.hasOwn(canonicalRow ?? {}, forbidden),
      false,
      `canonical rows do not expose ${forbidden}`,
    );
  }
}

{
  const result = rows({ familiarFilter: "other" });
  assert.equal(
    result.filter((row) => row.kind === "canonical").length,
    0,
    "canonical summaries are familiar-scoped",
  );
  assert.equal(
    result.filter((row) => row.kind === "file").length,
    0,
    "file rows are familiar-scoped",
  );
}

{
  assert.deepEqual(
    rows({ sourceFilter: "runtime" }).map((row) => row.rowId),
    ["file:/Users/x/.coven/echo/memory/new.md", "coven:c1"],
    "file source filters never suppress canonical summaries",
  );
}

{
  const safeQueries = [
    "daily",
    "garden",
    "echo",
    "distilled",
    "coven index",
    "private",
    "verified",
  ];
  for (const query of safeQueries) {
    assert.ok(
      rows({ query }).some((row) => row.rowId === "coven:c1"),
      `canonical search includes safe summary field: ${query}`,
    );
  }
  assert.deepEqual(
    rows({
      canonical: [canonical({ id: "secret-id-only" })],
      query: "secret-id-only",
    }),
    [],
    "opaque canonical IDs are not searchable",
  );
  assert.deepEqual(
    rows({ query: "/Users/x/.coven/echo/memory/new.md" }).map((row) => row.rowId),
    ["file:/Users/x/.coven/echo/memory/new.md"],
    "file search retains path matching",
  );
}

{
  const staleRows = rows({
    canonical: [
      canonical({
        title: "2026-06-13",
        excerpt: "No notable updates.",
      }),
    ],
    staleOnly: true,
  });
  assert.ok(
    staleRows.every((row) => row.kind === "file"),
    "canonical rows are never stale or cleanup candidates",
  );
}

{
  assert.deepEqual(
    rows({ sortMode: "name" }).map((row) => row.title),
    ["Daily note", "new.md", "old.md"],
    "name sort is alphabetical",
  );
}

const groupedRows: MemoryRow[] = [
  {
    kind: "canonical",
    rowId: "coven:c1",
    memoryId: "c1",
    title: "Note",
    sortTime: "2026-06-13T11:00:00Z",
    sourceLabel: "Sage",
    excerpt: "Private note",
    privacy: { classification: "private", revealRequired: true },
    verification: { state: "verified" },
    stale: false,
  },
  {
    kind: "file",
    rowId: "file:/x/new.md",
    title: "new.md",
    path: "/x/new.md",
    contentPath: "/x/new.md",
    size: 10,
    sortTime: "2026-06-13T10:00:00Z",
    sourceLabel: "Runtime memory",
    stale: false,
    protection: "normal",
  },
  {
    kind: "file",
    rowId: "file:/x/old.md",
    title: "old.md",
    path: "/x/old.md",
    contentPath: "/x/old.md",
    size: 20,
    sortTime: "2026-01-01T00:00:00Z",
    sourceLabel: "Coven origin",
    stale: false,
    protection: "normal",
  },
];

{
  const groups = groupMemoryRows(groupedRows, "type");
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Familiar memories", "Files"],
    "canonical type grouping label is exact",
  );
}

{
  const groups = groupMemoryRows(groupedRows, "familiar");
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Sage", "Files"],
    "canonical rows group under the familiar and file rows remain together",
  );
}

{
  const groups = groupMemoryRows(groupedRows, "date", NOW);
  assert.equal(groups.find((group) => group.label === "Today")?.rows.length, 2);
  assert.equal(groups.find((group) => group.label === "Older")?.rows.length, 1);
}

{
  const presentation = (
    memoryRowsModule as typeof memoryRowsModule & {
      memoryListPresentation(input: {
        canonicalState: "loading" | "ready" | "error";
        filesState: "loading" | "ready" | "error";
        rowCount: number;
      }): "loading" | "rows" | "empty" | "unavailable";
    }
  ).memoryListPresentation;
  assert.equal(typeof presentation, "function", "memory list presentation is exported");
  assert.equal(
    presentation({ canonicalState: "error", filesState: "ready", rowCount: 1 }),
    "rows",
    "a canonical failure keeps usable file rows visible",
  );
  assert.equal(
    presentation({ canonicalState: "ready", filesState: "error", rowCount: 1 }),
    "rows",
    "a file failure keeps canonical rows visible",
  );
  assert.equal(
    presentation({ canonicalState: "error", filesState: "error", rowCount: 0 }),
    "unavailable",
    "two failed empty feeds never masquerade as true-empty",
  );
  assert.equal(
    presentation({ canonicalState: "ready", filesState: "ready", rowCount: 0 }),
    "empty",
    "true-empty requires both feeds to be ready",
  );
}

{
  const reconcile = (
    memoryRowsModule as typeof memoryRowsModule & {
      reconcileMemorySelection(input: {
        selectedRowId: string | null;
        rowIds: readonly string[];
        canonicalState: "loading" | "ready" | "error";
        filesState: "loading" | "ready" | "error";
      }): string | null;
    }
  ).reconcileMemorySelection;
  assert.equal(typeof reconcile, "function", "selection reconciliation is exported");
  assert.equal(
    reconcile({
      selectedRowId: "coven:c1",
      rowIds: ["coven:c1"],
      canonicalState: "ready",
      filesState: "ready",
    }),
    "coven:c1",
    "a visible canonical selection stays selected",
  );
  assert.equal(
    reconcile({
      selectedRowId: "coven:c1",
      rowIds: [],
      canonicalState: "loading",
      filesState: "ready",
    }),
    "coven:c1",
    "a canonical selection survives only while its feed is settling",
  );
  assert.equal(
    reconcile({
      selectedRowId: "coven:c1",
      rowIds: [],
      canonicalState: "ready",
      filesState: "ready",
    }),
    null,
    "a removed or query-filtered canonical row returns to the list",
  );
  assert.equal(
    reconcile({
      selectedRowId: "file:/x/new.md",
      rowIds: [],
      canonicalState: "ready",
      filesState: "error",
    }),
    null,
    "a removed or source-filtered file row returns to the list after settlement",
  );
}

{
  const excludeMissing = (
    memoryRowsModule as typeof memoryRowsModule & {
      excludeMissingCanonicalMemory<T extends { id: string }>(
        entries: readonly T[],
        memoryId: string | null,
      ): T[];
    }
  ).excludeMissingCanonicalMemory;
  assert.equal(typeof excludeMissing, "function", "missing recovery is exported");
  assert.deepEqual(
    excludeMissing(
      [canonical({ id: "gone" }), canonical({ id: "kept", title: "Kept" })],
      "gone",
    ).map((entry) => entry.id),
    ["kept"],
    "a 404 removes the stale canonical summary while preserving usable rows",
  );
}

{
  const reconcileRefresh = (
    memoryRowsModule as typeof memoryRowsModule & {
      reconcileMissingCanonicalRefresh<T extends { id: string }>(input: {
        missingMemoryId: string | null;
        notice: string | null;
        refreshState: "ready" | "error";
        entries: readonly T[];
      }): { missingMemoryId: string | null; notice: string | null };
    }
  ).reconcileMissingCanonicalRefresh;
  assert.equal(typeof reconcileRefresh, "function", "missing refresh reconciliation is exported");
  assert.deepEqual(
    reconcileRefresh({
      missingMemoryId: "gone",
      notice: "Memory not found",
      refreshState: "ready",
      entries: [canonical({ id: "gone" }), canonical({ id: "kept" })],
    }),
    { missingMemoryId: "gone", notice: "Memory not found" },
    "a ready list that still advertises the missing ID preserves its exclusion and notice",
  );
  assert.deepEqual(
    reconcileRefresh({
      missingMemoryId: "gone",
      notice: "Memory not found",
      refreshState: "ready",
      entries: [canonical({ id: "kept" })],
    }),
    { missingMemoryId: null, notice: null },
    "a successful coordinated canonical refresh clears the notice and reconciled exclusion",
  );
  assert.deepEqual(
    reconcileRefresh({
      missingMemoryId: "gone",
      notice: "Memory not found",
      refreshState: "error",
      entries: [],
    }),
    { missingMemoryId: "gone", notice: "Memory not found" },
    "a failed coordinated refresh preserves the actionable missing notice",
  );
}

console.log("memory-rows: all assertions passed");
