// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// DetailSplitHost hosts the drag-to-split secondary pages beside the primary
// surface. Both the 2-pane and the 3+-pane cases must be RESIZABLE — every
// divider between panes drags freely (min-size clamped), never a fixed grid.
const src = await readFile(new URL("./detail-split-host.tsx", import.meta.url), "utf8");

// The single-secondary (2-pane) case keeps its snap-assisted resizable group.
assert.match(
  src,
  /secondaryTiles\.length === 1 \?[\s\S]*<Group className="split-host__group"/,
  "2-pane split renders a resizable Group",
);

// 2+ secondary pages (3+ panes) render a resizable Group — one Panel per tile
// with a Separator between — NOT the old fixed equal-width grid.
assert.doesNotMatch(src, /split-host__grid/, "multi-pane split no longer uses the fixed grid layout");
assert.match(
  src,
  /tiles\.map\(\(tile, i\) =>[\s\S]*<Separator[\s\S]*<Panel[\s\S]*minSize="300px"[\s\S]*renderGridTile\(tile\)/,
  "3+ panes render each tile in a resizable Panel with a draggable Separator between them (px floor per cave-hivd)",
);
// Adding a tile to a live group must remount it — RRP squeezes ADDED panels
// below their pixel min otherwise (fresh mounts lay out evenly).
assert.match(
  src,
  /key=\{tiles\.map\(\(tile\) => tile\.id\)\.join\("\|"\)\}/,
  "the multi-tile Group is keyed by the tile set",
);

console.log("detail-split-host ok");
