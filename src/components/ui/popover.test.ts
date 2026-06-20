// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./popover.tsx", import.meta.url), "utf8");

// The popover must consume its own Escape: a capture-phase keydown listener that
// stopPropagation()s before the event reaches a parent dialog's bubble-phase
// handler (e.g. Settings, which closes itself on Escape). Without this, one Esc
// closes both the popover AND the surrounding Settings panel.
assert.match(src, /if \(e\.key === "Escape"\)/, "popover handles Escape");
assert.match(src, /e\.stopPropagation\(\)/, "popover stops Escape from propagating to parent handlers");
assert.match(src, /addEventListener\("keydown", onKey, true\)/, "popover keydown listens in the capture phase");
assert.match(src, /removeEventListener\("keydown", onKey, true\)/, "popover keydown cleanup matches the capture phase");

// Viewport-aware positioning: auto-flip to the opposite side when the preferred
// side can't fit the popover, clamp horizontally, and cap height so it never
// overflows the viewport (the color picker overflowed at laptop height before).
assert.match(src, /scrollHeight/, "measures the popover's natural content height for fit checks");
assert.match(src, /spaceBelow|spaceAbove/, "compares room below vs above the anchor to decide flip");
assert.match(src, /Math\.min\(r\.left/, "clamps the left edge within the viewport");
assert.match(src, /maxHeight/, "caps height (with overflowY:auto) so neither side overflows");

// Visual-viewport awareness: the on-screen keyboard (iOS) shrinks the visible band
// without changing window.innerHeight. The popover must measure against
// window.visualViewport so it clamps inside the visible area instead of hiding
// under the keyboard, and must recompute when the keyboard opens/closes.
assert.match(src, /window\.visualViewport/, "measures against the visual viewport (keyboard-aware)");
assert.match(src, /vv\?\.height|visualViewport\b[\s\S]*?\.height/, "uses the visual viewport height for fit checks");
assert.match(
  src,
  /vv\?\.addEventListener\("resize"|visualViewport[\s\S]*?addEventListener\("resize"/,
  "recomputes when the visual viewport resizes (keyboard show/hide)",
);

// role="dialog" requires an accessible name. The popover takes an optional ariaLabel
// prop and wires it onto the dialog; without it screen readers announce the popover
// with no title.
assert.match(src, /ariaLabel\?: string/, "popover accepts an ariaLabel prop");
assert.match(src, /aria-label=\{ariaLabel\}/, "popover wires aria-label onto the dialog");

// On close the popover returns focus to the trigger when focus would otherwise be
// lost to document.body (Escape, item-select, outside-click on empty space), so
// keyboard users aren't stranded — but leaves focus alone if moved to another control.
assert.match(
  src,
  /active === document\.body[\s\S]{0,40}?anchor\?\.focus/,
  "popover restores focus to the anchor when it would otherwise land on body",
);

console.log("popover.test.ts: ok");
