// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");

assert.match(src, /allowExpand\??:\s*boolean/, "RightPanel takes allowExpand");
assert.match(src, /expanded\??:\s*boolean/, "RightPanel takes expanded");
assert.match(src, /onToggleExpand\??:\s*\(\)\s*=>\s*void/, "RightPanel takes onToggleExpand");
assert.match(src, /ph:arrows-out-simple/, "maximize icon present");
assert.match(src, /ph:arrows-in-simple/, "restore icon present");
assert.match(src, /aria-label="Expand panel"/, "maximize labelled");
assert.match(src, /aria-label="Restore panel"/, "restore labelled");
assert.match(src, /right-panel--expanded/, "expanded overlay class on the aside");
assert.match(src, /onSetPanel\("changes"\)/, "Changes is selectable as a tab when expanded");
assert.match(src, /rightExpanded/, "ChatSurface tracks rightExpanded");
assert.match(src, /chat-right-expanded/, "expanded overlay container");

// While expanded, the shell's top-bar side-panel toggle is hidden (via a root
// data attribute + CSS) since it's redundant under a full-surface panel.
assert.match(src, /data-right-panel-expanded/, "flags expanded state on the document root");

// The expand affordance is a top-bar toggle in the shell, not an in-header
// button. ChatSurface bridges it via a window event and flags right-panel-open
// on the root so the toggle can show only when there is a panel to expand.
assert.match(
  src,
  /addEventListener\("cave:right-panel-expand"/,
  "ChatSurface listens for the shell toggle's expand event",
);
assert.match(
  src,
  /data-right-panel-open/,
  "ChatSurface flags right-panel-open on the root for the expand toggle's visibility",
);

// The shell's top-bar expand toggle and the companion-rail collapsed-YouTube
// peek strip were removed with the right companion panel. The chat-surface
// inspector above keeps its own expand plumbing (its dormant listener is
// harmless — nothing dispatches cave:right-panel-expand anymore).

console.log("right-panel-expand.test.ts: ok");
