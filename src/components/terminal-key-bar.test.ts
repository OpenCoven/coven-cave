// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bar = readFileSync(new URL("./terminal-key-bar.tsx", import.meta.url), "utf8");
const term = readFileSync(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");

// The bar emits the escape sequences a soft keyboard can't: Esc, Tab, and the
// CSI cursor sequences for arrows.
assert.match(bar, /esc:\s*"\\x1b"/, "Esc sends the escape byte");
assert.match(bar, /tab:\s*"\\t"/, "Tab sends a literal tab");
assert.match(bar, /up:\s*"\\x1b\[A"[\s\S]*down:\s*"\\x1b\[B"[\s\S]*left:\s*"\\x1b\[D"[\s\S]*right:\s*"\\x1b\[C"/,
  "arrows send the standard CSI cursor sequences");
assert.match(bar, /min-h-\[var\(--touch-target\)\][\s\S]*min-w-\[var\(--touch-target\)\]/,
  "keys meet the shared touch target");
assert.match(bar, /role="toolbar"/, "the bar is a labelled toolbar");
assert.match(bar, /var\(--sai-bottom\)/, "the bar clears the home-indicator safe area");

// The terminal only shows the bar on coarse pointers, and folds the next char
// into a control code while Ctrl is sticky.
assert.match(term, /useIsCoarsePointer\(\)/, "terminal gates the key bar on coarse pointers");
assert.match(term, /isCoarse \?\s*\(\s*<TerminalKeyBar/, "key bar renders only on touch devices");
assert.match(term, /term\.input\(seq\)/, "injected keys route through xterm.input → onData → pty");
assert.match(
  term,
  /ctrlStickyRef\.current && data\.length === 1[\s\S]*code & 0x1f/,
  "sticky Ctrl folds the next character into its C0 control code",
);

console.log("terminal-key-bar.test.ts: ok");
