// @ts-nocheck
import assert from "node:assert/strict";
const { resolveWikiLinkTarget, resolveOutgoingLinks, docRefKey } = await import("./wiki-link-resolve.ts");

const index = {
  knowledge: [
    { id: "api-style-guide", title: "API Style Guide" },
    { id: "no-title-entry", title: null },
  ],
  memory: [{ path: "personal/2024.md" }, { path: "/abs/root/notes.md" }],
  journal: [{ date: "2026-07-07" }],
};

// ── knowledge: by id and by title, case-insensitive ─────────────────────────
assert.deepEqual(resolveWikiLinkTarget("api-style-guide", index), { kind: "knowledge", id: "api-style-guide" }, "by slug id");
assert.deepEqual(resolveWikiLinkTarget("API Style Guide", index), { kind: "knowledge", id: "api-style-guide" }, "by title");
assert.deepEqual(resolveWikiLinkTarget("api style GUIDE".replace(" style", " Style"), index), { kind: "knowledge", id: "api-style-guide" }, "title is case-insensitive");
assert.deepEqual(resolveWikiLinkTarget("no-title-entry", index), { kind: "knowledge", id: "no-title-entry" }, "a titleless entry still resolves by id");

// ── memory: by basename, by relative path, extension optional ───────────────
assert.deepEqual(resolveWikiLinkTarget("2024", index), { kind: "memory", path: "personal/2024.md" }, "by file basename");
assert.deepEqual(resolveWikiLinkTarget("personal/2024", index), { kind: "memory", path: "personal/2024.md" }, "by relative path");
assert.deepEqual(resolveWikiLinkTarget("notes", index), { kind: "memory", path: "/abs/root/notes.md" }, "basename of an absolute path");
assert.deepEqual(resolveWikiLinkTarget("notes.md", index), { kind: "memory", path: "/abs/root/notes.md" }, ".md extension in the target is optional");

// ── journal: only an existing ISO date ──────────────────────────────────────
assert.deepEqual(resolveWikiLinkTarget("2026-07-07", index), { kind: "journal", date: "2026-07-07" }, "an existing journal day");
assert.equal(resolveWikiLinkTarget("2026-01-01", index), null, "an ISO date with no journal entry is unresolved");

// ── misses ──────────────────────────────────────────────────────────────────
assert.equal(resolveWikiLinkTarget("does-not-exist", index), null, "unknown target is unresolved");
assert.equal(resolveWikiLinkTarget("   ", index), null, "blank target is unresolved");

// ── resolveOutgoingLinks: parse + resolve a doc body ────────────────────────
const links = resolveOutgoingLinks("See [[API Style Guide]] and [[2024|last year]] and [[ghost]].", index);
assert.equal(links.length, 3, "every link in the body is returned");
assert.deepEqual(links[0].ref, { kind: "knowledge", id: "api-style-guide" }, "first link resolves to knowledge");
assert.equal(links[1].display, "last year", "the alias display is carried through resolution");
assert.deepEqual(links[1].ref, { kind: "memory", path: "personal/2024.md" }, "aliased link still resolves by target");
assert.equal(links[2].ref, null, "an unresolved link keeps ref=null");

// ── docRefKey ───────────────────────────────────────────────────────────────
assert.equal(docRefKey({ kind: "knowledge", id: "x" }), "knowledge:x");
assert.equal(docRefKey({ kind: "memory", path: "a/b.md" }), "memory:a/b.md");
assert.equal(docRefKey({ kind: "journal", date: "2026-07-07" }), "journal:2026-07-07");

console.log("wiki-link-resolve.test.ts: ok");
