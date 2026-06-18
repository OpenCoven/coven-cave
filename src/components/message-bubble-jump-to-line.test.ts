// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Jump-to-line: a Projects search match opens the file preview scrolled to and
// highlighting the matched line. Wiring spans message-bubble (data-line anchors
// + SyntaxBlock.highlightLine), comux-view (thread the line through), and CSS.

const bubble = await readFile(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const comux = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

// ── renderCodeBlock emits a 1-based data-line on every line row ───────────────
assert.match(
  bubble,
  /<span class="cave-line\$\{gutterClass\}" data-line="\$\{i \+ 1\}">/,
  "renderCodeBlock must stamp each .cave-line with a 1-based data-line anchor",
);

// ── SyntaxBlock accepts highlightLine and scrolls/marks the row ──────────────
assert.match(bubble, /highlightLine\?:\s*number/, "SyntaxBlock must accept an optional highlightLine prop");
assert.match(
  bubble,
  /\.cave-line\[data-line="\$\{highlightLine\}"\]/,
  "SyntaxBlock must query the row by its data-line anchor",
);
assert.match(bubble, /classList\.add\("cave-line--active"\)/, "the target row must get the active class");
assert.match(bubble, /scrollIntoView\(\{\s*block:\s*"center"\s*\}\)/, "the target row must be scrolled into view");
// Re-opening without a line must clear a stale highlight.
assert.match(
  bubble,
  /querySelectorAll\("\.cave-line--active"\)[\s\S]*remove\("cave-line--active"\)/,
  "a prior active highlight must be cleared before applying a new one",
);

// ── comux-view threads the matched line through to the preview ───────────────
assert.match(
  comux,
  /openSearchMatch\(file\.path,\s*match\.line\)/,
  "clicking a search match must pass the matched line",
);
assert.match(
  comux,
  /openFilePreview\(`\$\{searchRoot\.replace\([^)]*\)\}\/\$\{relPath\}`,\s*line\)/,
  "openSearchMatch must forward the line to openFilePreview",
);
assert.match(comux, /highlightLine=\{previewLine\}/, "the preview SyntaxBlock must receive previewLine");
assert.match(comux, /setPreviewLine\(line\)/, "opening a file must record the target line (cleared when opened from the tree)");

// ── CSS for the active line exists ───────────────────────────────────────────
assert.match(css, /\.cave-line--active\s*\{/, "active-line style must exist");
assert.match(css, /@keyframes cave-line-flash/, "active line should flash on landing");

console.log("message-bubble-jump-to-line.test.ts: all assertions passed");
