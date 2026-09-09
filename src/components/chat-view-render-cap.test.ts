// @ts-nocheck
// Browsing and find keep a hard group mounting budget. Pure range behavior
// lives in chat-transcript-window.test.ts; these pins cover React/DOM wiring.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(
  src,
  /const renderGroups = folded\s*\n\s*\? groupedTurns\.slice\(fold\.startIndex\)/,
  "a closed fold mounts its tail instead of the capped tail",
);
assert.match(
  src,
  /: groupedTurns\.slice\(window\.start, window\.end\);/,
  "every open-fold/find path renders only its bounded window",
);
assert.doesNotMatch(src, /historyExpanded|setHistoryExpanded/, "no unlimited expansion escape hatch remains");
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

assert.match(
  src,
  /setTranscriptWindowStart\(\(start\) => start \?\? chatTranscriptWindow\(transcriptGroupCountRef\.current, null\)\.start\)/,
  "leaving the bottom freezes the current window rather than mounting earlier history",
);

// Search is over the whole active branch, never just the rendered page or
// inactive siblings, and resolving its DOM node waits for the target commit.
assert.match(
  src,
  /findTranscriptHits\(\s*activePath\.map\(/,
  "find searches the whole active transcript",
);
assert.match(
  src,
  /chatTranscriptWindowForTurn\(groupedTurns, id, transcriptWindowStartRef\.current\)/,
  "a search target selects its containing bounded group window",
);
assert.match(
  src,
  /setFoldOpen\(true\);\s*setTranscriptWindowStart\(targetWindow\.start\);\s*setPendingFindJump\(\{ turnId: id, sessionId \}\)/,
  "find schedules a target page, then a post-commit jump",
);
assert.match(
  src,
  /useLayoutEffect\(\(\) => \{\s*if \(!pendingFindJump\) return;[\s\S]*?querySelector<HTMLElement>[\s\S]*?scrollIntoView\(\{ block: "center", behavior: "auto" \}\);[\s\S]*?captureReleasedScrollAnchor\(\)/,
  "the DOM jump runs after mounting and refreshes the released reader anchor",
);

assert.match(
  src,
  /if \(next\) \{\s*setTranscriptWindowStart\(null\);/,
  "every jump-to-latest resets the window to the live tail",
);
assert.match(
  src,
  /updateFollowing\(true\);[\s\S]{0,250}setFoldOpen\(false\);[\s\S]{0,200}\[sessionId, updateFollowing\]/,
  "a session switch resets both tail following and the fold without remounting ChatView",
);

assert.match(
  src,
  /el\.scrollTop \+= node\.getBoundingClientRect\(\)\.top - released\.top/,
  "paging preserves a surviving overlapping turn's viewport position",
);
assert.match(src, /el\.scrollTop = Math\.max\(0, el\.scrollHeight - anchor\)/, "fold fallback keeps bottom distance");
assert.match(src, /\[captureReleasedScrollAnchor, transcriptWindowStart, foldOpen\]/, "opening, closing and paging restore anchors");
for (const label of ["Show earlier turns", "Show newer turns"]) {
  assert.ok(src.includes(label), `${label} remains reachable by an explicit control`);
}
assert.match(src, /<Button[\s\S]{0,160}className="focus-ring"[\s\S]{0,80}aria-disabled=\{window\.start === 0\}/);
assert.match(src, /aria-disabled=\{window\.end === groupedTurns\.length\}/, "boundary controls retain keyboard focus instead of unmounting");

console.log("chat-view-render-cap.test.ts: ok");
