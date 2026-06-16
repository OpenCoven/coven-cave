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

// While expanded, the shell's right edge-rail float is hidden (via a root data
// attribute + CSS) so it can't intercept clicks on the top-right Close button.
assert.match(src, /data-right-panel-expanded/, "flags expanded state on the document root");

// The expand affordance is a floating toggle pinned just left of the side-panel
// trigger in the shell, not an in-header button. ChatSurface bridges it via a
// window event and flags right-panel-open on the root so the float can show only
// when there is a panel to expand.
assert.match(
  src,
  /addEventListener\("cave:right-panel-expand"/,
  "ChatSurface listens for the shell float's expand event",
);
assert.match(
  src,
  /data-right-panel-open/,
  "ChatSurface flags right-panel-open on the root for the shell float's visibility",
);

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
assert.match(
  shell,
  /shell-panel-float--expand/,
  "shell renders the floating expand toggle",
);
assert.match(
  shell,
  /dispatchEvent\(new CustomEvent\("cave:right-panel-expand"\)\)/,
  "the expand float dispatches the bridge event",
);

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(
  css,
  /\[data-right-panel-open\]\s*\.shell-panel-float--expand/,
  "expand float is shown only when a right panel is open",
);
assert.match(
  css,
  /\[data-right-panel-expanded\]\s*\.shell-panel-float--expand[\s\S]*?display:\s*none/,
  "expand float is hidden again while the panel is expanded",
);

// The floats track the live side-panel header position via a measured CSS var so
// they stay aligned through the post-load layout settle (no fixed-offset flash).
assert.match(
  css,
  /\.shell-panel-float\s*\{[\s\S]*?top:\s*var\(--shell-float-top,\s*50px\)/,
  "floats consume the measured --shell-float-top (with a 50px fallback)",
);
assert.match(
  src,
  /setProperty\("--shell-float-top"/,
  "ChatSurface publishes the live header center to --shell-float-top",
);
assert.match(
  src,
  /querySelector\("\.right-panel-tabs"\)[\s\S]*getBoundingClientRect/,
  "the float position is derived from the measured side-panel header rect",
);

console.log("right-panel-expand.test.ts: ok");
