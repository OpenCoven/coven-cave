// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const source = read("./chat-view.tsx");
const styles = read("../styles/cave-chat/session-chrome.css");
const railStyles = read("../styles/cave-chat/auxiliary-surfaces.css");
const transcriptStyles = read("../styles/cave-chat/transcript.css");

const foldStart = source.indexOf('<div key="__chat-fold" className="cave-chat-fold">');
const foldEnd = source.indexOf("</div>", foldStart);
const fold = source.slice(foldStart, foldEnd);

assert.ok(foldStart > -1, "the transcript fold should render");
assert.match(fold, /className="cave-chat-fold__trigger focus-ring"/);
assert.match(fold, /aria-label=\{chatFoldAriaLabel\(fold\.hiddenTurns, foldOpen\)\}/);
assert.match(fold, /title=\{chatFoldLabel\(fold\.hiddenTurns, foldOpen\)\}/);
assert.match(fold, /<Icon name="ph:caret-up"/);
assert.doesNotMatch(fold, /cave-chat-fold__rule/, "the full-width seam should not render separate rule nodes");
assert.equal(fold.match(/chatFoldLabel\(/g)?.length, 1, "the fold label should appear only in the native title, not as visible chrome");

assert.match(
  styles,
  /\.cave-chat-fold__trigger \{[\s\S]{0,900}?display:\s*grid;[\s\S]{0,300}?grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/,
  "the minimal trigger spans the reading width with the arrow centered between hairlines",
);
assert.match(styles, /\.cave-chat-fold__trigger::before,[\s\S]*?\.cave-chat-fold__trigger::after/);
assert.doesNotMatch(styles, /\.cave-chat-fold__pill|\.cave-chat-fold__rule/, "the oversized pill treatment stays removed");
assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.cave-chat-fold__trigger,[\s\S]*?\.cave-chat-fold__trigger::before,[\s\S]*?\.cave-chat-fold__trigger::after[\s\S]*?transition:\s*none;/,
  "the fold seam disables every hover and caret transition for reduced motion",
);
assert.match(
  railStyles,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.workspace-rail-reopen__tab[\s\S]*?transition:\s*none;/,
  "the Code pull tab does not expand with animation for reduced motion",
);
assert.match(
  transcriptStyles,
  /@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*?\.cave-chat-linear \.cave-composer-panel[\s\S]*?background:\s*var\(--bg-raised\);[\s\S]*?backdrop-filter:\s*none;/,
  "the chat composer becomes opaque and drops blur for reduced transparency",
);

console.log("chat-continuation-controls.test.ts OK");

// ── Prose-dimming hint (cave-4akqc): the first visible turns below a closed
//    fold sit slightly dimmed, suggesting the transcript continues above. The
//    hint must be driven by the FOLD state (never the render cap), must stay
//    purely visual, and must restore full contrast on hover/focus and under
//    reduced-transparency — a dim that blocks reading is not an affordance.

assert.match(
  source,
  /const fadedGroups = chatFoldFadedGroupIndexes\(renderGroups, folded\);/,
  "the fade is computed over the rendered slice and only while the fold is closed",
);
assert.match(
  source,
  /foldFaded=\{fadedGroups\.has\(groupIndex\)\}/,
  "every TurnRow (single and voice-call) receives the per-group fade flag",
);
assert.match(
  source,
  /\$\{foldFaded \? " cave-linear-turn--fold-faded" : ""\}/,
  "the fade is a class on the turn row, not a wrapper or a text mutation",
);
assert.match(
  source,
  /prev\.foldFaded === next\.foldFaded/,
  "the memo comparator includes the fade flag so opening the fold re-renders dimmed rows",
);
assert.match(
  styles,
  /\.cave-linear-turn--fold-faded \{[\s\S]{0,400}?opacity: 0\.72;/,
  "a closed fold renders its first visible turns at reduced opacity",
);
assert.match(
  styles,
  /\.cave-linear-turn--fold-faded:hover,[\s\S]*?\.cave-linear-turn--fold-faded:focus-within \{[\s\S]*?opacity: 1;/,
  "hover or focus restores full contrast so the hint never blocks reading",
);
assert.match(
  styles,
  /@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*?\.cave-linear-turn--fold-faded \{[\s\S]*?opacity: 1;/,
  "reduced-transparency disables the dim entirely",
);
assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.cave-linear-turn--fold-faded \{[\s\S]*?transition: none;/,
  "reduced-motion kills the fade transition",
);

console.log("chat-continuation-controls.test.ts OK");
