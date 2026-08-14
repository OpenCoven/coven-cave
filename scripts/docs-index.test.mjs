import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// docs/README.md classifies every document in docs/ as living, program,
// historical, or tombstone. That classification is only worth trusting if it
// stays complete, so this pins it: a doc added, renamed, or removed without
// touching the index fails here instead of rotting silently.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(repoRoot, "docs");
const indexPath = path.join(docsDir, "README.md");
const index = readFileSync(indexPath, "utf8");

// Markdown link targets, minus anchors and any title suffix.
const linkTargets = [...index.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(
  ([, target]) => target.split("#")[0],
);

// 1. Every path the index cites exists. Catches a rename that updated the
//    prose but not the link, and a deletion that left the entry behind.
for (const target of linkTargets) {
  if (!target || /^[a-z]+:/i.test(target)) continue; // skip external URLs
  const resolved = path.resolve(docsDir, target);
  assert.ok(
    existsSync(resolved),
    `docs/README.md links ${target}, but ${path.relative(repoRoot, resolved)} does not exist — update the link`,
  );
}

// 2. The set of top-level docs the index lists matches the set on disk.
const onDisk = readdirSync(docsDir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort();

const listed = linkTargets.filter((target) => /^[^/]+\.md$/.test(target) && target !== "README.md");
const listedSet = new Set(listed);

const missing = onDisk.filter((name) => !listedSet.has(name));
assert.deepEqual(
  missing,
  [],
  `docs/*.md missing from the docs/README.md index: ${missing.join(", ")} — add each under Living, Program, Historical, or Tombstone`,
);

const stale = [...listedSet].filter((name) => !onDisk.includes(name)).sort();
assert.deepEqual(
  stale,
  [],
  `docs/README.md indexes files that no longer exist: ${stale.join(", ")} — remove or repoint the entry`,
);

// 3. Each document is listed once. Two entries mean two classifications, and
//    the second one is the one nobody updates.
const duplicated = [...listedSet]
  .filter((name) => listed.filter((entry) => entry === name).length > 1)
  .sort();
assert.deepEqual(
  duplicated,
  [],
  `docs/README.md lists these more than once: ${duplicated.join(", ")} — a document has exactly one state`,
);

// 4. The four states the index promises are all still present as headings.
//    Renaming one silently strands every document filed beneath it.
for (const state of ["## Living", "## Program", "## Historical", "## Tombstone"]) {
  assert.ok(
    index.includes(state),
    `docs/README.md no longer has a "${state}" section — the index contract names four states`,
  );
}

console.log(
  `docs-index.test.mjs: index ok (${onDisk.length} documents classified, ${linkTargets.length} links resolved)`,
);
