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

console.log("popover.test.ts: ok");
