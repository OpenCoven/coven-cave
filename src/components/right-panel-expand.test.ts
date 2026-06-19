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

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
assert.match(
  shell,
  /shell-top-toggle--expand/,
  "shell renders the top-bar expand toggle",
);
assert.match(
  shell,
  /dispatchEvent\(new CustomEvent\("cave:right-panel-expand"\)\)/,
  "the expand toggle dispatches the bridge event",
);

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(
  css,
  /\[data-right-panel-open\]\s*\.shell-top-toggle--expand/,
  "expand toggle is shown only when a right panel is open",
);
assert.match(
  css,
  /\[data-right-panel-expanded\]\s*\.shell-top-toggle--expand[\s\S]*?display:\s*none/,
  "expand toggle is hidden again while the panel is expanded",
);

console.log("right-panel-expand.test.ts: ok");
