import assert from "node:assert/strict";
import { MAX_OPEN_TABS, parseStoredTabs, selectionKey } from "./grimoire-nav-state.ts";

assert.equal(selectionKey({ kind: "knowledge", id: "entry", collection: "field-notes" }), "knowledge:field-notes/entry");
assert.equal(selectionKey({ kind: "memory", path: "/tmp/MEMORY.md" }), "memory:/tmp/MEMORY.md");
assert.equal(selectionKey({ kind: "stitch-new" }), "stitch-new");
// Journal keys match docRefKey: a familiar's own entry carries its id, a legacy
// coven-wide day file does not — so graph backlinks resolve to the open tab.
assert.equal(selectionKey({ kind: "journal", date: "2026-07-19" }), "journal:2026-07-19");
assert.equal(selectionKey({ kind: "journal", date: "2026-07-19", familiar: "nova" }), "journal:nova:2026-07-19");
{
  const { docRefKey } = await import("../lib/wiki-link-resolve.ts");
  for (const ref of [
    { kind: "journal", date: "2026-07-19" },
    { kind: "journal", date: "2026-07-19", familiar: "nova" },
    { kind: "knowledge", id: "entry", collection: "field-notes" },
    { kind: "memory", path: "/tmp/MEMORY.md" },
  ] as const) {
    assert.equal(selectionKey(ref), docRefKey(ref), `selectionKey matches docRefKey for ${JSON.stringify(ref)}`);
  }
}

const restored = parseStoredTabs(JSON.stringify([
  { kind: "knowledge", id: "entry", collection: "field-notes" },
  { kind: "memory", path: "/tmp/MEMORY.md" },
  { kind: "journal", date: "2026-07-19" },
  { kind: "journal", date: "2026-07-19", familiar: "nova" },
  { kind: "knowledge-new" },
  { kind: "memory" },
]));
assert.deepEqual(restored, [
  { kind: "knowledge", id: "entry", collection: "field-notes" },
  { kind: "memory", path: "/tmp/MEMORY.md" },
  { kind: "journal", date: "2026-07-19" },
  { kind: "journal", date: "2026-07-19", familiar: "nova" },
]);
assert.equal(parseStoredTabs(JSON.stringify(Array.from({ length: MAX_OPEN_TABS + 3 }, (_, i) => ({ kind: "journal", date: `2026-01-${i}` })))).length, MAX_OPEN_TABS);
assert.deepEqual(parseStoredTabs("not-json"), []);
