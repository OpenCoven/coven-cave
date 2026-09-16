import assert from "node:assert/strict";
import * as memoryRowsModule from "./memory-rows.ts";
import { buildMemoryRows, groupMemoryRows, type MemoryRow } from "./memory-rows.ts";

// Memory rows are files. The canonical-vault variant went with the vault
// itself, which lives in the dedicated memory application now, so the cases
// below that proved canonical/file INTERLEAVING, canonical scoping, the safe
// search-field allowlist and the missing-summary reconciliation went with it.
//
// Every case that was really about FILE behaviour is kept, including the ones
// that happened to be written as "files survive a canonical failure" — those
// assert that one feed's state does not decide the list's, which still holds
// with one feed.

const NOW = Date.parse("2026-06-13T12:00:00Z");

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

// ── Ordering ─────────────────────────────────────────────────────────────────
{
  const result = rows();
  assert.deepEqual(
    result.map((row) => row.rowId),
    [
      "file:/Users/x/.coven/echo/memory/new.md",
      "file:/Users/x/.coven/echo/memory/old.md",
    ],
    "rows sort by recency, newest first",
  );
  assert.ok(
    result.every((row) => row.kind === "file"),
    "every row is a file row",
  );
}

// ── Scoping ──────────────────────────────────────────────────────────────────
{
  const result = rows({ familiarFilter: "other" });
  assert.equal(result.length, 0, "file rows are familiar-scoped");
}

{
  assert.deepEqual(
    rows({ sourceFilter: "runtime" }).map((row) => row.rowId),
    ["file:/Users/x/.coven/echo/memory/new.md"],
    "source filters narrow the file list",
  );
}

// ── Search ───────────────────────────────────────────────────────────────────
{
  assert.deepEqual(
    rows({ query: "/Users/x/.coven/echo/memory/new.md" }).map((row) => row.rowId),
    ["file:/Users/x/.coven/echo/memory/new.md"],
    "file search retains path matching",
  );
  assert.deepEqual(
    rows({ query: "runtime memory" }).map((row) => row.rowId),
    ["file:/Users/x/.coven/echo/memory/new.md"],
    "file search matches the source label",
  );
}

// ── Sorting ──────────────────────────────────────────────────────────────────
{
  assert.deepEqual(
    rows({ sortMode: "name" }).map((row) => row.title),
    ["new.md", "old.md"],
    "name sort is alphabetical",
  );
  assert.deepEqual(
    rows({ sortMode: "size" }).map((row) => row.title),
    ["old.md", "new.md"],
    "size sort is largest first",
  );
}

// ── Grouping ─────────────────────────────────────────────────────────────────
const groupedRows: MemoryRow[] = [
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
    ["Files"],
    "type grouping has one label now that files are the only kind",
  );
}

{
  const groups = groupMemoryRows(groupedRows, "source");
  assert.deepEqual(
    groups.map((group) => group.label).sort(),
    ["Coven origin", "Runtime memory"],
    "source grouping splits by the file's own source label",
  );
}

{
  const groups = groupMemoryRows(groupedRows, "date", NOW);
  assert.equal(groups.find((group) => group.label === "Today")?.rows.length, 1);
  assert.equal(groups.find((group) => group.label === "Older")?.rows.length, 1);
}

// ── Presentation ─────────────────────────────────────────────────────────────
// The distinction these cases defend is unchanged: an EMPTY list means
// something different depending on whether the feed settled. A failed feed with
// no rows must never render as true-empty, because "nothing here" and "we could
// not look" are different claims.
{
  const presentation = (
    memoryRowsModule as typeof memoryRowsModule & {
      memoryListPresentation(input: {
        filesState: "loading" | "ready" | "error";
        rowCount: number;
      }): "loading" | "rows" | "empty" | "unavailable";
    }
  ).memoryListPresentation;
  assert.equal(typeof presentation, "function", "memory list presentation is exported");
  assert.equal(
    presentation({ filesState: "error", rowCount: 1 }),
    "rows",
    "rows already loaded stay visible through a later failure",
  );
  assert.equal(
    presentation({ filesState: "error", rowCount: 0 }),
    "unavailable",
    "a failed empty feed never masquerades as true-empty",
  );
  assert.equal(
    presentation({ filesState: "ready", rowCount: 0 }),
    "empty",
    "true-empty requires the feed to be ready",
  );
  assert.equal(
    presentation({ filesState: "loading", rowCount: 0 }),
    "loading",
    "an unsettled feed reads as loading, not empty",
  );
}

// ── Selection reconciliation ─────────────────────────────────────────────────
{
  const reconcile = (
    memoryRowsModule as typeof memoryRowsModule & {
      reconcileMemorySelection(input: {
        selectedRowId: string | null;
        rowIds: readonly string[];
        filesState: "loading" | "ready" | "error";
      }): string | null;
    }
  ).reconcileMemorySelection;
  assert.equal(typeof reconcile, "function", "selection reconciliation is exported");
  assert.equal(
    reconcile({
      selectedRowId: "file:/x/new.md",
      rowIds: ["file:/x/new.md"],
      filesState: "ready",
    }),
    "file:/x/new.md",
    "a visible selection stays selected",
  );
  assert.equal(
    reconcile({
      selectedRowId: "file:/x/new.md",
      rowIds: [],
      filesState: "loading",
    }),
    "file:/x/new.md",
    "a selection survives while its feed is still settling",
  );
  assert.equal(
    reconcile({
      selectedRowId: "file:/x/new.md",
      rowIds: [],
      filesState: "ready",
    }),
    null,
    "a removed or query-filtered row returns to the list once settled",
  );
  assert.equal(
    reconcile({
      selectedRowId: "file:/x/new.md",
      rowIds: [],
      filesState: "error",
    }),
    null,
    "a failed feed also releases a selection that is no longer present",
  );
}
