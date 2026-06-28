// @ts-nocheck
// Transcript render cap (perf): while the reader is pinned to the newest
// content, only the last TRANSCRIPT_RENDER_CAP grouped turns mount, so opening a
// long transcript doesn't build hundreds of DOM nodes up front. The cap must
// dissolve the instant the reader leaves the bottom or opens find, so seeking
// and find are never limited by it. These source-text assertions guard that
// wiring (the behavior is exercised live; this catches accidental removal).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(src, /const TRANSCRIPT_RENDER_CAP = \d+;/, "a numeric render cap constant exists");

assert.match(
  src,
  /historyExpanded \|\| groupedTurns\.length <= TRANSCRIPT_RENDER_CAP\s*\?\s*groupedTurns\s*:\s*groupedTurns\.slice\(-TRANSCRIPT_RENDER_CAP\)/,
  "the transcript renders the capped tail unless expanded or already short",
);

assert.match(
  src,
  /return renderGroups\.map\(\(g\) =>/,
  "the render loop maps the capped renderGroups (not the full groupedTurns)",
);

// Leaving the bottom (updateFollowing(false)) must mount the full transcript so
// scroll-up / find-jump never land on an unmounted row.
assert.match(
  src,
  /else if \(!historyExpandedRef\.current\)\s*\{[\s\S]*?setHistoryExpanded\(true\)/,
  "updateFollowing(false) expands the transcript (covers wheel/touch/keys/find-jump)",
);

assert.match(
  src,
  /if \(findOpen\) setHistoryExpanded\(true\)/,
  "opening find mounts the whole transcript so jumps resolve via data-turn-id",
);

// Switching sessions resets the cap so a long previous transcript is released.
assert.match(
  src,
  /updateFollowing\(true\);\s*setHistoryExpanded\(false\);/,
  "a session switch resets the render cap",
);

// The reveal must not jolt the viewport: distance-from-bottom is restored.
assert.match(
  src,
  /useLayoutEffect\(\(\) => \{[\s\S]*?el\.scrollTop = Math\.max\(0, el\.scrollHeight - anchor\)/,
  "expanding restores the pre-expansion scroll anchor in a layout effect",
);

console.log("chat-view-render-cap.test.ts: ok");
