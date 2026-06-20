// @ts-nocheck
// Source-text checks for the in-chat artifact viewer. We can't mount React
// here, so assert the contract: tabs default to Canvas, the iframe is
// sandboxed without same-origin, refine/save wiring is present.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-artifact-viewer.tsx", import.meta.url), "utf8");

assert.match(src, /useState[^\n]*"canvas"/, "default tab is canvas");
assert.match(src, /buildReactSrcDoc|buildPreviewSrcDoc/, "uses the canvas srcDoc builders");
assert.match(src, /sandbox="allow-scripts allow-popups allow-modals"/, "iframe sandboxed");
assert.doesNotMatch(src, /allow-same-origin/, "iframe must NOT allow same-origin");
assert.match(src, /sandbox-error/, "listens for sandbox runtime errors");
assert.match(src, /generateArtifactCode/, "refine calls the generator");
assert.match(src, /buildRefinePrompt/, "refine wraps with the refine prompt");
assert.match(src, /\/api\/canvas/, "save posts to the canvas store");
assert.match(src, /cave:navigate-mode/, "open-in-canvas navigates to the canvas page");

// Expand-to-fullscreen: a toggle action enters a fullscreen overlay, Escape
// exits, and — critically — the overlay is PORTALED to document.body so it
// escapes the chat turn's content-visibility containing block. Without the
// portal the fixed overlay would be clipped to the turn row and "expand"
// wouldn't visibly expand.
assert.match(src, /fullscreen,\s*setFullscreen/, "tracks fullscreen artifact state");
assert.match(src, /aria-label=\{fullscreen \? "Exit fullscreen" : "Expand artifact fullscreen"\}/, "renders a fullscreen toggle action");
assert.match(src, /Icon name=\{fullscreen \? "ph:arrows-in-simple" : "ph:arrows-out-simple"\}/, "fullscreen toggle uses expand/collapse icons");
assert.match(src, /e\.key === "Escape"[\s\S]*?setFullscreen\(false\)/, "Escape exits fullscreen mode");
assert.match(src, /chat-artifact--fullscreen/, "fullscreen state applies the overlay class");
assert.match(src, /import \{ createPortal \} from "react-dom"/, "imports createPortal");
assert.match(src, /createPortal\(shell, document\.body\)/, "fullscreen overlay is portaled to document.body to escape the turn's containing block");

console.log("chat-artifact-viewer source contract: ok");
