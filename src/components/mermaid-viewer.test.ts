// @ts-nocheck
// The chat mermaid previewer must offer the same fullscreen zoom/pan reading
// experience as the doc reader: an Expand affordance on each rendered diagram
// that opens a fullscreen overlay you can wheel-zoom, drag-pan, and Esc-close.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./mermaid-viewer.ts", import.meta.url), "utf8");
const bubble = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");

// The rendered diagram is injected HTML (no React node), so the viewer must be
// wired into the shared post-render hook alongside the copy/link wiring.
assert.match(
  bubble,
  /import \{ wireMermaidDiagrams \} from "\.\/mermaid-viewer"/,
  "message-bubble imports the mermaid viewer",
);
assert.match(
  bubble,
  /wireMermaidDiagrams\(el\)/,
  "wireMermaidDiagrams runs in the shared useWireCopyButtons post-render hook",
);

// Wiring targets the postProcess output container and is idempotent per element.
assert.match(source, /\.cm-mermaid-diagram/, "viewer wires the .cm-mermaid-diagram nodes");
assert.match(source, /_mermaidWired/, "wiring is idempotent per DOM element");
assert.match(
  source,
  /const svg = diagram\.querySelector\("svg"\);\s*\n\s*\/\/[\s\S]*?if \(!svg\) continue;/,
  "placeholder / render-failure diagrams (no <svg>) are skipped",
);

// Fullscreen overlay with the zoom/pan reading surface.
assert.match(source, /class.*=.*"cm-mermaid-viewer"/, "opens a fullscreen viewer overlay");
assert.match(source, /aria-modal/, "viewer overlay is a modal dialog");

// Zoom: wheel (anchored at cursor), buttons, and keyboard.
assert.match(source, /addEventListener\("wheel", onWheel/, "wheel zoom is wired");
assert.match(
  source,
  /tx = px - \(px - tx\) \* \(next \/ scale\)/,
  "wheel/button zoom keeps the point under the cursor anchored",
);
assert.match(source, /"Zoom in"/, "viewer exposes a zoom-in control");
assert.match(source, /"Zoom out"/, "viewer exposes a zoom-out control");
assert.match(source, /"Fit to screen"/, "viewer exposes a fit-to-screen control");

// Pan: pointer drag.
assert.match(source, /addEventListener\("pointerdown", onPointerDown/, "drag-to-pan is wired");

// Close: Escape, close button, and a non-drag backdrop tap.
assert.match(source, /event\.key === "Escape"/, "Escape closes the viewer");
assert.match(
  source,
  /if \(downOnBackdrop && moved < 5\) close\(\)/,
  "a clean backdrop tap (not a pan) closes the viewer",
);

// Cleanup: every window-level listener is removed on close.
for (const ev of ["pointermove", "pointerup", "keydown"]) {
  assert.match(
    source,
    new RegExp(`window\\.removeEventListener\\("${ev}"`),
    `close() removes the window ${ev} listener`,
  );
}

// Only one viewer at a time.
assert.match(source, /activeViewer\?\.close\(\)/, "reopening replaces any existing viewer");

// Regression guard: mermaid scopes its embedded theme CSS to the svg id
// (`#diagram-N .cluster rect { fill }`), so the clone MUST keep its id or the
// diagram renders as a black-on-black silhouette with no fills/borders.
assert.doesNotMatch(
  source,
  /removeAttribute\("id"\)/,
  "the cloned svg must keep its id, or mermaid's id-scoped theme styles drop out",
);

console.log("mermaid-viewer.test.ts: ok");
