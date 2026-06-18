// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Chat code blocks render in a container that is collapsible (fold to header),
// height-expandable ("Show more"), and max-height scrollable — with Shiki
// syntax highlighting. This pins the collapse affordance + the scroll/expand
// container so the presentation can't silently regress.

const bubble = await readFile(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

// ── renderCodeBlock chrome: collapse chevron + line count in the header ──────
assert.match(
  bubble,
  /class="cave-code-collapse-btn"[\s\S]*?aria-expanded="true"[\s\S]*?cave-code-chevron/,
  "the code header has a collapse toggle (chevron, expanded by default)",
);
assert.match(bubble, /class="cave-code-lines"[\s\S]*?\$\{lineCount\} lines/, "the header shows a line count");
// Header order: collapse chevron, then language, then the rest.
assert.match(
  bubble,
  /cave-code-header">\$\{collapseBtn\}\$\{labelHtml\}/,
  "the collapse toggle leads the header",
);

// ── wireCopyButtons wires the chevron to the (unit-tested) collapse toggle ───
assert.match(
  bubble,
  /querySelectorAll<HTMLButtonElement>\("\.cave-code-collapse-btn"\)[\s\S]*?addEventListener\("click"[\s\S]*?toggleCodeBlockCollapse\(wrap, btn\)/,
  "clicking the chevron calls toggleCodeBlockCollapse (collapse logic lives in @/lib/code-block-collapse, unit-tested)",
);

// ── CSS: collapsed hides the body; chevron rotates ───────────────────────────
assert.match(
  css,
  /\.cave-code-wrap--collapsed > pre,[\s\S]*?\.cave-code-wrap--collapsed > \.cave-code-expand \{[\s\S]*?display: none/,
  "collapsed state hides the code body and the Show-more footer",
);
assert.match(css, /\.cave-code-wrap--collapsed \.cave-code-chevron \{[\s\S]*?rotate\(-90deg\)/, "chevron rotates when collapsed");
assert.match(css, /\.cave-code-collapse-btn \{[\s\S]*?order: -1/, "collapse toggle is leftmost in the header");

// ── regression: the scrollable, height-expandable, highlighted container ─────
assert.match(
  css,
  /\.cave-code-wrap \{[\s\S]*?max-height: min\(60vh, 520px\)[\s\S]*?overflow-y: auto/,
  "code container keeps its max-height scroll cap",
);
assert.match(css, /\.cave-code-wrap--expanded \{[\s\S]*?max-height: none/, '"Show more" still lifts the height cap');
assert.match(bubble, /hl\.codeToHtml\(code, \{[\s\S]*?theme: "mood-c-dark"/, "Shiki syntax highlighting is applied");

console.log("message-bubble-code-collapse.test.ts: ok");
