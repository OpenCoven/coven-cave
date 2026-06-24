// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./board-card-stack.tsx", import.meta.url), "utf8");

// The card body is a role=button element (not a real <button>) so it can hold
// flow content + focusable action buttons without invalid nesting — mirroring
// KanbanCard. Was: a <button> wrapping <div>/<p> and a tabIndex=-1 role=link.
assert.match(
  src,
  /className="board-card-stack__row-main"\s+role="button"\s+tabIndex=\{0\}\s+aria-pressed=\{isSelected\}/,
  "the card body is a keyboard-focusable role=button (not a <button> wrapping flow content)",
);
assert.match(
  src,
  /onKeyDown=\{\(e\) => \{\s*if \(e\.key === "Enter" \|\| e\.key === " "\) \{ e\.preventDefault\(\); onSelect\(\); \}/,
  "the card body activates on Enter/Space",
);

// The Open / Start actions are real, focusable <button>s — keyboard and screen
// reader users can trigger them (they were tabIndex=-1 spans before).
assert.doesNotMatch(
  src,
  /role="link"\s+tabIndex=\{-1\}/,
  "no keyboard-unreachable role=link spans remain for the row actions",
);
assert.match(
  src,
  /<button\s+type="button"\s+className="board-card-stack__row-action board-card-stack__row-action--chat"\s+aria-label=\{`Open linked session/,
  "the Open-session action is a real labelled button",
);
assert.match(
  src,
  /<button\s+type="button"\s+className="board-card-stack__row-action board-card-stack__row-action--chat"\s+disabled=\{chatLinking\}[\s\S]*?aria-label=\{`Start a chat/,
  "the Start-chat action is a real labelled button that disables while linking",
);

console.log("board-card-stack-a11y.test.ts: ok");
