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

// cave-u5lq7 put the earlier-turns fold ahead of the cap: a CLOSED fold mounts
// even less than the cap would, so it wins outright and the cap decision below
// is what runs whenever the fold is open or absent.
assert.match(
  src,
  /const renderGroups = folded\s*\n\s*\? groupedTurns\.slice\(fold\.startIndex\)/,
  "a closed fold mounts its tail instead of the capped tail",
);
assert.match(
  src,
  /historyExpanded \|\| groupedTurns\.length <= TRANSCRIPT_RENDER_CAP\s*\?\s*groupedTurns\s*:\s*groupedTurns\.slice\(-TRANSCRIPT_RENDER_CAP\)/,
  "the transcript renders the capped tail unless expanded or already short",
);
// The fold's own count must never be computed off the capped slice, or a long
// thread's pill reports the render budget instead of the conversation.
assert.match(
  src,
  /const fold = chatTranscriptFold\(groupedTurns\);/,
  "the fold measures the whole transcript, not the capped slice",
);

assert.match(
  src,
  /const rows = renderGroups\.map\(\(g, groupIndex\) =>/,
  "the render loop maps the capped renderGroups (not the full groupedTurns)",
);

// The first rendered row's `prev` turn is by definition one the reader cannot
// see — folded away, or below the cap — so a time-gap rule there measures a
// pause against nothing, and under a fold it stacks a second hairline directly
// beneath the pill.
assert.match(
  src,
  /const gapLabel = groupIndex === 0 \? null : chatTurnGapLabel\(prev\?\.createdAt, t\.createdAt\);/,
  "no time-gap divider on the first rendered row",
);

// Leaving the bottom (updateFollowing(false)) must mount the full transcript so
// scroll-up / find-jump never land on an unmounted row.
assert.match(
  src,
  /else if \(!historyExpandedRef\.current\)\s*\{[\s\S]*?setHistoryExpanded\(true\)/,
  "updateFollowing(false) expands the transcript (covers wheel/touch/keys/find-jump)",
);

// Find must clear BOTH limiters (cave-u5lq7). Clearing only the cap left a
// long thread reporting hits inside folded turns and then jumping nowhere,
// because jumpToFindMatch resolves its target through querySelector and the
// row it looks for was never rendered.
assert.match(
  src,
  /if \(findOpen\) \{\s*\n\s*setHistoryExpanded\(true\);\s*\n\s*setFoldOpen\(true\);/,
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
