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

console.log("chat-artifact-viewer source contract: ok");
