// @ts-nocheck
/**
 * Source pins for the memoized transcript subtree (cave-likl).
 *
 * ChatView holds 60+ pieces of state whose updates have nothing to do with
 * the transcript (composer input, caret, menus, poll ticks). Before this
 * optimization, every such update re-ran the transcript row loop inline in
 * ChatView's JSX: per-row closures, sibling lookups, action-presence
 * recomputation and the TurnRow memo comparator × up to
 * TRANSCRIPT_RENDER_CAP rows — per keystroke.
 *
 * The loop now lives in `TranscriptRows`, a React.memo component whose props
 * are all referentially stable across keystroke renders; per-row actions are
 * routed through a latest-ref so they are read at CALL time (never stale,
 * never memo-defeating). These pins keep the load-bearing pieces in place.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── 1. The transcript subtree is a memo component ───────────────────────────
assert.match(
  src,
  /const TranscriptRows = memo\(function TranscriptRows\(/,
  "TranscriptRows must be wrapped in React.memo — the whole point is bailing out of keystroke re-renders",
);

// ── 2. ChatView renders it (the row loop is NOT inline in ChatView JSX) ─────
assert.match(
  src,
  /<TranscriptRows\s[\s\S]*?handlersRef=\{transcriptHandlersRef\}/,
  "ChatView renders TranscriptRows and hands it the latest-ref for row actions",
);

// ── 3. Latest-ref pattern: reassigned every render, all six actions ─────────
assert.match(
  src,
  /transcriptHandlersRef\.current = \{\s*siblingsFor,\s*switchBranch,\s*editTurnInComposer,\s*regenerateFor,\s*replyFor,\s*send,\s*\};/,
  "the handlers ref must be reassigned in the render body so closures never go stale",
);

// The reassignment must NOT be wrapped in a hook (an effect would lag a
// render behind and reintroduce the stale-closure hazard the ref exists to
// prevent).
const refAssign = src.indexOf("transcriptHandlersRef.current = {");
const before = src.slice(Math.max(0, refAssign - 250), refAssign);
assert.ok(
  !/useEffect\(|useLayoutEffect\(|useMemo\(|useCallback\(/.test(before),
  "the handlers-ref reassignment must run directly in the render body, not inside a hook",
);

// ── 4. Handlers are read at call time inside the rows ───────────────────────
for (const pattern of [
  /handlers\(\)\.regenerateFor\(t\)/,
  /handlers\(\)\.replyFor\(t\)/,
  /handlers\(\)\.editTurnInComposer\(t\)/,
  /handlers\(\)\.send\(sug\)/,
  /handlers\(\)\.switchBranch\(t\.id, -1\)/,
  /handlers\(\)\.siblingsFor\(t\.id\)/,
]) {
  assert.match(
    src,
    pattern,
    `row actions must dereference the ref at call time (${pattern}) — capturing handlers at render time would go stale behind the memo`,
  );
}

// ── 5. Presence semantics: busy stays a data prop ────────────────────────────
// regenerateFor hides the Regenerate action while busy. The handler is read
// through the ref, so the memo would never re-render for the flip unless
// `busy` itself is a compared prop.
assert.match(
  src,
  /const TranscriptRows = memo\(function TranscriptRows\(\{[\s\S]*?\}: \{[\s\S]*?busy: boolean;[\s\S]*?\}\)/,
  "busy must be a TranscriptRows prop so action-presence flips re-render the rows",
);
assert.match(
  src,
  /<TranscriptRows[\s\S]*?busy=\{busy\}/,
  "ChatView must pass busy through",
);

// ── 6. The row loop and render cap live inside TranscriptRows ────────────────
const transcriptRowsStart = src.indexOf("const TranscriptRows = memo(");
assert.ok(transcriptRowsStart > 0, "TranscriptRows component exists");
const transcriptRowsBody = src.slice(transcriptRowsStart, transcriptRowsStart + 9000);
assert.match(
  transcriptRowsBody,
  /historyExpanded \|\| groupedTurns\.length <= TRANSCRIPT_RENDER_CAP/,
  "the render cap decision moved with the loop",
);
assert.match(
  transcriptRowsBody,
  /return renderGroups\.map\(\(g\) => \{/,
  "the row loop lives inside the memo component",
);
// The pre-extraction inline IIFE form must not come back to ChatView's JSX.
assert.doesNotMatch(
  src,
  /\{\(\(\) => \{[\s\S]{0,400}renderGroups/,
  "the transcript loop must not be inlined back into ChatView's JSX as an IIFE",
);

console.log("chat-view-transcript-memo.test.ts: ok");
