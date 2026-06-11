// @ts-nocheck
// Chat responses must render as formatted markdown — including GFM tables
// with inline markdown inside cells — not as the plain-text fallback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");

// StrictMode regression guard: a ref-based "same text" check poisons itself
// when the first (dev double-invoke) effect run is cancelled — run 2 then
// early-returns and the bubble is stuck on raw markdown forever.
assert.doesNotMatch(
  source,
  /lastTextRef/,
  "MarkdownContent must not gate the async markdown render on a same-text ref guard",
);

// @create-markdown/preview emits table cells as escaped plain text, so
// **bold**/`code`/[links] inside cells show literally unless each cell is
// re-rendered through the inline path.
assert.match(
  source,
  /async function renderTableBlock\(/,
  "Tables are rebuilt with per-cell inline markdown rendering",
);
assert.match(
  source,
  /async function renderInlineMd\(/,
  "Cell content renders through the inline (paragraph) markdown path",
);
assert.match(
  source,
  /text-align: \$\{alignments\[i\]\}/,
  "Rebuilt tables preserve GFM column alignments",
);
assert.match(
  source,
  /const tableRe = \/<table\[\^>\]\*>\[\\s\\S\]\*\?<\\\/table>\/g/,
  "Rendered tables substitute positionally for the renderer's own <table> output",
);

// ── CHAT-D6-04: per-message actions must be keyboard/touch reachable ──────
// The Copy/Expand bubble actions must be mounted unconditionally (when not
// pending) and revealed by CSS — never mount-gated on a JS `hovered` state,
// which keeps them out of the DOM (and the accessibility tree) until
// onMouseEnter fires.
assert.doesNotMatch(
  source,
  /\bhovered\b/,
  "Bubble actions must not be gated on a JS hovered state — render always, reveal with CSS",
);
assert.match(
  source,
  /\{!pending && <CopyBubble/,
  "User-bubble Copy action renders whenever the message is not pending",
);
assert.match(
  source,
  /\{!pending && content \? \(\s*<div className="cave-bubble-actions">/,
  "Assistant bubble actions render whenever there is settled content",
);

const css = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
assert.match(
  css,
  /\.cave-copy-btn:focus-visible \{ opacity: 1; \}/,
  "Focused action buttons must be visible (focus-visible reveal)",
);
assert.match(
  css,
  /\.group:focus-within \.cave-copy-btn \{ opacity: 1; \}/,
  "Tabbing into a bubble's actions must reveal them (focus-within reveal)",
);
assert.match(
  css,
  /@media \(pointer: coarse\) \{\s*\.cave-copy-btn-bubble \{\s*opacity: 1;/,
  "Coarse pointers have no hover — bubble actions must be always visible there",
);

console.log("message-bubble-markdown.test.ts: ok");
