// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-lifecycle-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioLifecycleTab/);
assert.match(source, /archiveFamiliar/);
assert.match(source, /unarchiveFamiliar/);
assert.match(source, /clearAllFamiliarOverrides/);
assert.match(source, /clearGlyphOverride/);
assert.match(source, /clearFamiliarImage/);
// The roster (Active/Archived reorder + archive) renders here unconditionally —
// it's the manager the standalone "Manage familiars" page used to host, now part
// of Settings → Familiars (no more listView gate).
assert.match(source, /<h3 className="familiar-studio-lifecycle__heading">Active<\/h3>/, "the Lifecycle tab shows the active roster");
assert.match(source, /Archived/, "and the archived roster");
assert.match(source, /setFamiliarOrder/, "reordering the roster persists familiar order");
assert.match(source, /canMoveUp/, "Rows expose canMoveUp prop for disabled-edge state");
assert.match(source, /canMoveDown/, "Rows expose canMoveDown prop for disabled-edge state");
assert.match(source, /ph:arrow-up-bold/, "Move-up icon is wired");
assert.match(source, /ph:arrow-down-bold/, "Move-down icon is wired");

// The roster order here is distinct from the avatar-strip pin order in
// Appearance — the hint cross-links so users find both (2026-07-06).
assert.match(source, /avatar strip's pinned order/, "lifecycle hint disambiguates roster order from pin order");
assert.match(source, /window\.location\.hash = "appearance"/, "lifecycle hint links to Appearance");

console.log("familiar-studio-lifecycle-tab.test.ts: ok");
