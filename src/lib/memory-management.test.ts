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

console.log("memory-management.test: ok");
