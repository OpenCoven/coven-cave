// @ts-nocheck
import assert from "node:assert/strict";
import { buildMemoryRows } from "./memory-rows.ts";

const NOW = Date.parse("2026-06-13T12:00:00Z");

const coven = [
  { id: "c1", familiar_id: "echo", title: "Daily note", excerpt: "hello",
    path: "/Users/x/.coven/echo/memory/2026-06-13.md", updated_at: "2026-06-13T11:00:00Z", source_context: "" },
];
const files = [
  { fullPath: "/Users/x/.coven/echo/memory/old.md", relPath: "old.md", rootLabel: "echo",
    sourceKind: "coven-origin", sourceKindLabel: "Coven origin", size: 2048,
    modified: "2026-01-01T00:00:00Z" },
  { fullPath: "/Users/x/.coven/echo/memory/new.md", relPath: "new.md", rootLabel: "echo",
    sourceKind: "runtime", sourceKindLabel: "Runtime memory", size: 100,
    modified: "2026-06-13T11:30:00Z" },
];

// Merges both sources, defaults to recency-desc.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.equal(rows.length, 3, "all three entries present");
  assert.deepEqual(rows.map((r) => r.kind), ["file", "agent", "file"], "newest file, then coven, then old file");
  assert.equal(rows[0].rowId, "file:/Users/x/.coven/echo/memory/new.md");
  assert.equal(rows[1].rowId, "coven:c1");
  assert.ok(rows.every((r) => typeof r.title === "string" && r.title.length > 0));
}

// Agent rows carry an excerpt; file rows carry a size.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.equal(rows.find((r) => r.kind === "agent").excerpt, "hello");
  assert.equal(rows.find((r) => r.kind === "file").size, 100);
}

// Coven rows are scoped to the active familiar; files are not.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "other", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.equal(rows.filter((r) => r.kind === "agent").length, 0, "coven filtered out for other familiar");
  assert.equal(rows.filter((r) => r.kind === "file").length, 2, "files unaffected by familiar filter");
}

// sourceFilter narrows files only (coven is not a file source, so it survives).
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "runtime", sortMode: "recent", staleOnly: false, now: NOW });
  assert.deepEqual(rows.map((r) => r.rowId), ["file:/Users/x/.coven/echo/memory/new.md", "coven:c1"]);
}

// query matches title across both kinds.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "daily",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.deepEqual(rows.map((r) => r.rowId), ["coven:c1"], "query matches the coven title only");
}

// every row exposes a boolean `stale`; staleOnly keeps only stale rows.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.ok(rows.every((r) => typeof r.stale === "boolean"), "every row has a boolean stale flag");
  const staleRows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: true, now: NOW });
  assert.ok(staleRows.every((r) => r.stale === true), "staleOnly yields only stale rows");
}

// name sort is alpha by title.
{
  const byName = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "name", staleOnly: false, now: NOW });
  assert.deepEqual(byName.map((r) => r.title), ["Daily note", "new.md", "old.md"]);
}

// protection is derived from the path (normal for these test paths).
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.ok(rows.every((r) => ["structural", "bulk-protected", "normal"].includes(r.protection)));
}

console.log("memory-rows: all assertions passed");
