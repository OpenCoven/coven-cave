// @ts-nocheck
import assert from "node:assert/strict";
import { buildMemoryRows, groupMemoryRows } from "./memory-rows.ts";

const NOW = Date.parse("2026-06-13T12:00:00Z");

const coven = [
  { id: "c1", familiar_id: "echo", title: "Daily note", excerpt: "hello",
    path: "echo/2026-06-13.md", fullPath: "/Users/x/.coven/workspaces/familiars/echo/memory/2026-06-13.md",
    updated_at: "2026-06-13T11:00:00Z", source_context: "" },
];
const files = [
  { fullPath: "/Users/x/.coven/echo/memory/old.md", relPath: "old.md", rootLabel: "echo",
    sourceKind: "coven-origin", sourceKindLabel: "Coven origin", size: 2048,
    modified: "2026-01-01T00:00:00Z" },
  { fullPath: "/Users/x/.coven/echo/memory/new.md", relPath: "new.md", rootLabel: "echo",
    sourceKind: "runtime", sourceKindLabel: "Runtime memory", size: 100,
    modified: "2026-06-13T11:30:00Z" },
];

// Merges both sources, defaults to recency-desc. Owned (coven) rows come before shared (file) rows.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.equal(rows.length, 3, "all three entries present");
  assert.deepEqual(rows.map((r) => r.kind), ["agent", "file", "file"], "coven (owned) first, then files (shared) by recency");
  assert.equal(rows[0].rowId, "coven:c1");
  assert.equal(rows[1].rowId, "file:/Users/x/.coven/echo/memory/new.md");
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

// sourceFilter narrows files only (coven is not a file source, so it survives). Owned (coven) before shared (file).
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "runtime", sortMode: "recent", staleOnly: false, now: NOW });
  assert.deepEqual(rows.map((r) => r.rowId), ["coven:c1", "file:/Users/x/.coven/echo/memory/new.md"]);
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

// contentPath: files use their fullPath; agent rows carry the resolved fullPath.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  const agent = rows.find((r) => r.kind === "agent");
  const file = rows.find((r) => r.kind === "file");
  assert.equal(agent.contentPath, "/Users/x/.coven/workspaces/familiars/echo/memory/2026-06-13.md",
    "agent contentPath comes from the resolved fullPath");
  assert.equal(agent.path, "echo/2026-06-13.md", "agent identity path stays the relative daemon path");
  assert.equal(file.contentPath, file.path, "file contentPath equals its fullPath");
}

// Agent entry WITHOUT a resolved fullPath has no contentPath (reader falls back to excerpt).
{
  const rows = buildMemoryRows({
    coven: [{ id: "c2", familiar_id: "echo", title: "No path", excerpt: "x", path: "echo/x.md", updated_at: "2026-06-13T09:00:00Z" }],
    files: [], familiarFilter: "echo", query: "", sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.equal(rows[0].contentPath, undefined, "no fullPath → no contentPath");
}

// ── groupMemoryRows ──
const GNOW = Date.parse("2026-06-13T12:00:00Z");
const grows = [
  { rowId: "coven:c1", kind: "agent", title: "Note", path: "sage/x.md", sortTime: "2026-06-13T11:00:00Z", sourceLabel: "Sage", stale: false, protection: "normal" },
  { rowId: "file:f1", kind: "file", title: "new.md", path: "/x/new.md", size: 10, sortTime: "2026-06-13T10:00:00Z", sourceLabel: "Runtime memory", stale: false, protection: "normal" },
  { rowId: "file:f2", kind: "file", title: "old.md", path: "/x/old.md", size: 20, sortTime: "2026-01-01T00:00:00Z", sourceLabel: "Coven origin", stale: false, protection: "normal" },
];

// none → single "All" group preserving order
{
  const g = groupMemoryRows(grows, "none");
  assert.equal(g.length, 1);
  assert.equal(g[0].key, "all");
  assert.equal(g[0].rows.length, 3);
}

// type → Agent memories first, then Files; counts correct
{
  const g = groupMemoryRows(grows, "type");
  assert.deepEqual(g.map((x) => x.label), ["Familiar memories", "Files"]);
  assert.equal(g[0].rows.length, 1);
  assert.equal(g[1].rows.length, 2);
}

// source → one group per sourceLabel
{
  const g = groupMemoryRows(grows, "source");
  assert.deepEqual(g.map((x) => x.label).sort(), ["Coven origin", "Runtime memory", "Sage"]);
}

// date → time buckets; Today before Older
{
  const g = groupMemoryRows(grows, "date", GNOW);
  const today = g.find((x) => x.label === "Today");
  const older = g.find((x) => x.label === "Older");
  assert.equal(today.rows.length, 2, "the two June-13 rows bucket into Today");
  assert.equal(older.rows.length, 1, "the Jan row buckets into Older");
  assert.ok(g[0].key < g[g.length - 1].key, "buckets are key-ordered (Today→Older)");
}

console.log("memory-rows: all assertions passed");

// ── Familiar isolation: file rows partition into owned / shared ──────────────
{
  const coven = [
    { id: "c1", familiar_id: "salem", title: "Salem note", updated_at: "2026-06-10T00:00:00.000Z", excerpt: "x", path: "p", protection: "none" },
  ];
  const files = [
    { fullPath: "/g/coven.md", relPath: "coven.md", modified: "2026-06-12T00:00:00.000Z", size: 1, sourceKind: "coven-origin", sourceKindLabel: "Coven origin" },
    { fullPath: "/w/salem/a.md", relPath: "memory/a.md", modified: "2026-06-13T00:00:00.000Z", size: 1, sourceKind: "external-harness", sourceKindLabel: "External runtime", familiarId: "salem" },
    { fullPath: "/w/echo/b.md", relPath: "memory/b.md", modified: "2026-06-14T00:00:00.000Z", size: 1, sourceKind: "external-harness", sourceKindLabel: "External runtime", familiarId: "echo" },
  ];
  const rows = buildMemoryRows({ coven, files, familiarFilter: "salem", query: "", sourceFilter: "all", sortMode: "recent", staleOnly: false });
  const ids = rows.map((r) => r.rowId);
  assert.ok(!ids.includes("file:/w/echo/b.md"), "other-familiar file is dropped");
  assert.ok(ids.includes("file:/w/salem/a.md"), "owned file is kept");
  assert.ok(ids.includes("file:/g/coven.md"), "shared (no-familiarId) file is kept");
  const owned = rows.filter((r) => r.ownership === "owned").map((r) => r.rowId);
  const shared = rows.filter((r) => r.ownership === "shared").map((r) => r.rowId);
  assert.deepEqual(shared, ["file:/g/coven.md"], "no-familiarId file is shared");
  assert.ok(owned.includes("coven:c1") && owned.includes("file:/w/salem/a.md"), "coven + matching-familiar file are owned");
  const firstSharedIdx = rows.findIndex((r) => r.ownership === "shared");
  const lastOwnedIdx = rows.map((r) => r.ownership).lastIndexOf("owned");
  assert.ok(lastOwnedIdx < firstSharedIdx, "owned rows ordered before shared rows");
  console.log("memory-rows familiar-isolation: ok");
}
