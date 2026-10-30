// @ts-nocheck
// The chat mermaid previewer must offer the same fullscreen zoom/pan reading
// experience as the doc reader: an Expand affordance on each rendered diagram
// that opens a fullscreen overlay you can wheel-zoom, drag-pan, and Esc-close.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./mermaid-viewer.ts", import.meta.url), "utf8");
const viewer = readFileSync(new URL("./markdown-viewer.tsx", import.meta.url), "utf8");
const domWiring = readFileSync(new URL("./message-dom-wiring.ts", import.meta.url), "utf8");

// The rendered diagram is injected HTML (no React node), so the viewer must be
// wired into the shared post-render hook alongside the copy/link wiring.
assert.match(
  domWiring,
  /import \{ wireMermaidDiagrams \} from "\.\/mermaid-viewer"/,
  "message DOM wiring imports the mermaid viewer",
);
assert.match(
  domWiring,
  /wireMermaidDiagrams\(el, \(source\) => openViewer\(\{ kind: "diagram", source \}\)\)/,
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
assert.match(viewer, /<Modal open onClose=\{onClose\} title="Diagram viewer" presentation="fullscreen"/, "the viewer delegates fullscreen dialog semantics to Modal");

// Zoom: wheel (anchored at cursor), buttons, and keyboard.
assert.match(source, /addEventListener\("wheel", onWheel/, "wheel zoom is wired");
assert.match(
  source,
  /tx = px - \(px - tx\) \* \(next \/ scale\)/,
  "wheel/button zoom keeps the point under the cursor anchored",
);
assert.match(viewer, /"Zoom in"/, "viewer exposes a zoom-in control");
assert.match(viewer, /"Zoom out"/, "viewer exposes a zoom-out control");
assert.match(viewer, /"Fit to screen"/, "viewer exposes a fit-to-screen control");

// Pan: pointer drag.
assert.match(source, /addEventListener\("pointerdown", onPointerDown/, "drag-to-pan is wired");

// Close: Escape, close button, and a non-drag backdrop tap.
assert.doesNotMatch(source, /event\.key === "Escape"|event\.key === "Tab"/, "Modal owns Escape and Tab without a competing imperative handler");
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
assert.match(viewer, /if \(activeClose && activeClose !== close\) flushSync\(activeClose\)/, "reopening replaces any existing viewer");

// Regression guard: mermaid scopes its embedded theme CSS to the svg id
// (`#diagram-N .cluster rect { fill }`), so the clone MUST keep its id or the
// diagram renders as a black-on-black silhouette with no fills/borders.
assert.doesNotMatch(
  source,
  /removeAttribute\("id"\)/,
  "the cloned svg must keep its id, or mermaid's id-scoped theme styles drop out",
);

console.log("mermaid-viewer.test.ts: ok");
