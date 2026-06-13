// src/lib/memory-management.test.ts
import assert from "node:assert/strict";
import { parseRelativeTime } from "./memory-management.ts";

// Anchor "now" so the test is deterministic.
const NOW = 1_000_000_000_000;

assert.equal(parseRelativeTime("5m ago", NOW), NOW - 5 * 60_000, "5m ago");
assert.equal(parseRelativeTime("2h ago", NOW), NOW - 2 * 3_600_000, "2h ago");
assert.equal(parseRelativeTime("3d ago", NOW), NOW - 3 * 86_400_000, "3d ago");
assert.equal(parseRelativeTime("just now", NOW), NOW, "just now");
assert.equal(parseRelativeTime("garbage", NOW), 0, "unparseable -> 0");

import { normalizeCovenEntry, normalizeFileEntry } from "./memory-management.ts";

const coven = normalizeCovenEntry(
  { id: "kitty-2026-06-09", familiar_id: "kitty", title: "2026-06-09", path: "/home/u/.coven/memory/kitty/2026-06-09.md", updated_at: "5m ago", excerpt: "hello" },
  NOW,
);
assert.equal(coven.source, "coven");
assert.equal(coven.familiarId, "kitty");
assert.equal(coven.path, "/home/u/.coven/memory/kitty/2026-06-09.md");
assert.equal(coven.updatedAt, NOW - 5 * 60_000);
assert.equal(coven.bodyHint, "hello");

const file = normalizeFileEntry({
  fullPath: "/home/u/.coven/memory/x.md", relPath: "x.md", title: "x",
  sourceKind: "coven-origin", sourceKindLabel: "Coven origin", rootLabel: "Coven", size: 12,
  modified: "2001-09-09T01:46:40.000Z", familiarId: null,
});
assert.equal(file.source, "file");
assert.equal(file.size, 12);
assert.equal(file.kind, "coven-origin");
assert.equal(file.updatedAt, Date.parse("2001-09-09T01:46:40.000Z"));

import { classifyProtection, isStructuralMemoryPath, detectStale, ruleBasedStaleScorer } from "./memory-management.ts";
import type { StaleScorer, ManagedMemoryEntry } from "./memory-management.ts";

assert.equal(classifyProtection("/h/.coven/memory/kitty/MEMORY.md"), "structural");
assert.equal(classifyProtection("/h/.openclaw/workspace/kitty/memory/.dreams/phase-signals.json"), "structural");
assert.equal(classifyProtection("/h/.coven/workspaces/familiars/kitty/memory/dreaming/light/2026-04-26.md"), "bulk-protected");
assert.equal(classifyProtection("/h/.coven/workspaces/familiars/kitty/memory/dreaming/deep/2026-04-26.md"), "bulk-protected");
assert.equal(classifyProtection("/h/.coven/memory/kitty/note.md"), "normal");
assert.equal(isStructuralMemoryPath("/h/x/MEMORY.md"), true);
assert.equal(isStructuralMemoryPath("/h/x/note.md"), false);

const mk = (over: Partial<ManagedMemoryEntry>): ManagedMemoryEntry => ({
  key: "k", path: "/p", source: "coven", familiarId: null, title: "t",
  kind: "coven", updatedAt: 0, updatedAtLabel: "", size: null, bodyHint: "",
  protection: "normal", ...over,
});

assert.equal(detectStale(mk({ bodyHint: "# Light Sleep\n- No notable updates." })).stale, true, "dream placeholder is stale");
assert.equal(detectStale(mk({ bodyHint: "   " })).stale, true, "empty is stale");
assert.equal(detectStale(mk({ bodyHint: "real content here that is substantive and long enough" })).stale, false, "substantive not stale");
assert.equal(detectStale(mk({ protection: "structural", bodyHint: "" })).stale, false, "structural never stale");
const always: StaleScorer = { score: () => ({ stale: true, reason: "x", confidence: 1 }) };
assert.equal(detectStale(mk({}), always).stale, true, "scorer is pluggable");

import { groupMemories, sortMemories, filterMemories } from "./memory-management.ts";

const a = mk({ key: "a", title: "alpha", familiarId: "kitty", kind: "coven", updatedAt: 100, source: "coven", bodyHint: "No notable updates" });
const b = mk({ key: "b", title: "beta", familiarId: "sage", kind: "coven-origin", updatedAt: 300, source: "file", size: 50 });
const c = mk({ key: "c", title: "gamma", familiarId: "kitty", kind: "runtime", updatedAt: 200, source: "file", size: 10 });
const all = [a, b, c];

// sort
assert.deepEqual(sortMemories(all, "recent").map((e) => e.key), ["b", "c", "a"], "recent = newest first");
assert.deepEqual(sortMemories(all, "oldest").map((e) => e.key), ["a", "c", "b"], "oldest first");
assert.deepEqual(sortMemories(all, "name").map((e) => e.key), ["a", "b", "c"], "name asc");
assert.deepEqual(sortMemories(all, "size").map((e) => e.key), ["b", "c", "a"], "size desc (null last)");
assert.equal(sortMemories(all, "staleFirst")[0].key, "a", "stale first");

// group
const g = groupMemories(all, "familiar");
assert.deepEqual(g.map((x) => x.key), ["kitty", "sage"], "groups by familiar");
assert.deepEqual(g[0].entries.map((e) => e.key), ["a", "c"], "kitty group members");
assert.equal(groupMemories(all, "none").length, 1, "none = single group");
assert.deepEqual(groupMemories(all, "source").map((x) => x.key).sort(), ["coven", "file"]);

// filter
assert.deepEqual(filterMemories(all, "alpha", {}).map((e) => e.key), ["a"], "text filter");
assert.deepEqual(filterMemories(all, "", { familiarId: "kitty" }).map((e) => e.key), ["a", "c"], "facet familiar");
assert.deepEqual(filterMemories(all, "", { source: "file" }).map((e) => e.key), ["b", "c"], "facet source");
assert.deepEqual(filterMemories(all, "", { staleOnly: true }).map((e) => e.key), ["a"], "stale only");

const dreamFile = normalizeFileEntry({
  fullPath: "/h/.coven/workspaces/familiars/kitty/memory/dreaming/light/2026-04-26.md",
  relPath: "dreaming/light/2026-04-26.md", title: "2026-04-26",
  sourceKind: "coven-origin", sourceKindLabel: "Coven origin", rootLabel: "Kitty memory",
  size: 30, modified: "2026-04-26T00:00:00.000Z", familiarId: "kitty",
  excerpt: "# Light Sleep\n- No notable updates.",
});
assert.equal(dreamFile.bodyHint, "# Light Sleep\n- No notable updates.", "excerpt maps to bodyHint");
assert.equal(dreamFile.protection, "bulk-protected", "dream file is bulk-protected");
assert.equal(detectStale(dreamFile).stale, true, "dream placeholder flagged stale even as a file entry");

console.log("memory-management.test: ok");
