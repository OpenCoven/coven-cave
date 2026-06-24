// @ts-nocheck
import assert from "node:assert/strict";
import { sortLibraryDocs, DOC_SORT_OPTIONS } from "./library-doc-sort.ts";

const doc = (title, modifiedAt) => ({ id: title, title, familiar: "sage", collection: "all", modifiedAt, tags: [], excerpt: "" });

const docs = [
  doc("Banana", "2026-06-20T10:00:00Z"),
  doc("apple", "2026-06-24T10:00:00Z"),
  doc("Cherry", "2026-06-22T10:00:00Z"),
];

// ── modified desc (newest first) ──
assert.deepEqual(
  sortLibraryDocs(docs, "modified", "desc").map((d) => d.title),
  ["apple", "Cherry", "Banana"],
  "recently modified first",
);

// ── modified asc (oldest first) ──
assert.deepEqual(
  sortLibraryDocs(docs, "modified", "asc").map((d) => d.title),
  ["Banana", "Cherry", "apple"],
  "oldest first",
);

// ── title asc, case-insensitive ──
assert.deepEqual(
  sortLibraryDocs(docs, "title", "asc").map((d) => d.title),
  ["apple", "Banana", "Cherry"],
  "title A–Z is case-insensitive",
);

// ── title desc ──
assert.deepEqual(
  sortLibraryDocs(docs, "title", "desc").map((d) => d.title),
  ["Cherry", "Banana", "apple"],
  "title Z–A",
);

// ── ties break title-ascending regardless of direction ──
{
  const same = [doc("Zed", "2026-06-20T10:00:00Z"), doc("Ann", "2026-06-20T10:00:00Z")];
  assert.deepEqual(
    sortLibraryDocs(same, "modified", "desc").map((d) => d.title),
    ["Ann", "Zed"],
    "equal modified times tie-break by title ascending",
  );
}

// ── pure: does not mutate input ──
{
  const input = [doc("b", "2026-06-20T10:00:00Z"), doc("a", "2026-06-21T10:00:00Z")];
  const copy = input.slice();
  sortLibraryDocs(input, "title", "asc");
  assert.deepEqual(input, copy, "input array is not mutated");
}

// ── option ids are unique + well-formed ──
{
  const ids = DOC_SORT_OPTIONS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "sort option ids are unique");
  for (const o of DOC_SORT_OPTIONS) assert.equal(o.id, `${o.key}:${o.dir}`, "id is key:dir");
}

console.log("library-doc-sort.test.ts: ok");
