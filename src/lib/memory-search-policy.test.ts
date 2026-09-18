import assert from "node:assert/strict";
import {
  fileMemoryMatches,
  fileSearchFields,
} from "./memory-search-policy.ts";

// The canonical half of this policy was a PRIVACY boundary: a safe-field
// allowlist, with a proxy test recording every property canonical search read,
// so a summary could never leak its storage path or unredacted body. It was
// deleted with the vault it guarded — the store lives in the dedicated memory
// application now, and an allowlist protecting nothing is worse than none,
// because it reads as a live guarantee.
//
// The per-field matching semantics it also pinned still apply to files below:
// a query may not span two adjacent fields, which is the drift the shared
// policy retired.

// ── files: the unified union keeps every historically-findable entry ────────

const fileEntry = {
  relPath: "memory/notes.md",
  fullPath: "/home/x/.coven/workspaces/familiars/opal/memory/notes.md",
  sourceKind: "coven-origin",
  sourceKindLabel: "Coven workspace files",
  rootLabel: "Opal workspace",
  title: "Standup notes",
  excerpt: "Discussed the release",
  familiarId: "opal",
  harnessId: "openclaw",
  runtimeId: "codex",
  origin: "coven",
  sourceContext: "workspace scan",
};

assert.equal(fileSearchFields(fileEntry).length, 12, "file search unions both views' historical field sets");
assert.equal(
  fileMemoryMatches(fileEntry, "release coven-origin"),
  false,
  "queries cannot span field boundaries",
);
// Master-detail historically matched these; the compact view must too now:
assert.equal(fileMemoryMatches(fileEntry, "standup"), true, "title stays searchable");
assert.equal(fileMemoryMatches(fileEntry, "discussed"), true, "excerpt stays searchable");
assert.equal(fileMemoryMatches(fileEntry, "coven-origin"), true, "sourceKind stays searchable");
// The compact view historically matched these; master-detail must too now:
assert.equal(fileMemoryMatches(fileEntry, "openclaw"), true, "harnessId stays searchable");
assert.equal(fileMemoryMatches(fileEntry, "workspace scan"), true, "sourceContext stays searchable");
// Paths are fair game for local files (unlike canonical summaries).
assert.equal(fileMemoryMatches(fileEntry, "familiars/opal"), true, "file paths stay searchable");
// Optional fields absent → no crash, no phantom match.
assert.equal(
  fileMemoryMatches({ ...fileEntry, title: undefined, excerpt: undefined, harnessId: undefined }, "standup"),
  false,
);

console.log("memory-search-policy.test.ts: ok");
