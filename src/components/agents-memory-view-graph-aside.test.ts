// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// ───────── G1: Unified Recent-in-view (files + coven) ─────────

assert.match(
  source,
  /const recentInView = useMemo<RecentItem\[\]>\(/,
  "Graph aside must compute a unified recentInView list (RecentItem[])",
);

assert.match(
  source,
  /visibleCoven\.map\(\(entry\) => \(\{[\s\S]*?kind: "coven"/,
  "recentInView must include coven entries with kind: 'coven'",
);

assert.match(
  source,
  /visibleFiles\.map\(\(entry\) => \(\{[\s\S]*?kind: "file"/,
  "recentInView must include file entries with kind: 'file'",
);

assert.match(
  source,
  /data-testid="graph-recent-list"/,
  "Graph aside must mark the recent list with data-testid='graph-recent-list'",
);

// ───────── G2: Lighter empty states ─────────

// When nothing selected, render an inline <p> hint, not a dashed box.
assert.match(
  source,
  /Click any card in the map to inspect it/,
  "Empty-selection hint must use the friendlier copy",
);

assert.doesNotMatch(
  source,
  /Select a memory card in the graph\./,
  "Old 'Select a memory card in the graph.' copy must be removed",
);

// The Recent-in-view dashed empty state must be gone (we hide the section instead).
assert.doesNotMatch(
  source,
  /No memories match this agent view\./,
  "Old 'No memories match this agent view.' empty state must be removed",
);

// Recent section is only rendered when recentInView has items.
assert.match(
  source,
  /\{recentInView\.length\s*>\s*0\s*\?\s*\(/,
  "Recent in view must only render when recentInView is non-empty",
);

console.log("agents-memory-view-graph-aside.test.ts: ok");
