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
assert.doesNotMatch(src, /cave:navigate-mode/, "artifact viewer no longer deep-links the retired Canvas page");
assert.match(src, /Saved to Canvas/, "after save, confirms inline instead of navigating");
assert.doesNotMatch(src, /new\s+Blob\s*\(\s*\[\s*srcDoc\b/, "open-in-browser must not create same-origin blob URLs from untrusted artifacts");
assert.doesNotMatch(src, /URL\s*\.\s*createObjectURL\s*\(/, "open-in-browser must not use same-origin object URLs for untrusted artifacts");
// Top-level data: URLs are silently blocked as navigations by every engine
// (window.open returns null without throwing) — the mechanism shipped dead
// once (cave-e3ia) and must not come back.
assert.doesNotMatch(src, /data:text\/html/, "open-in-browser must not rely on blocked top-level data: navigations");
assert.match(src, /openArtifactInTab\s*\(\s*srcDoc\s*\)/, "open-in-browser routes through the sandboxed carrier (artifact-open.ts)");
assert.match(src, /Pop-up blocked/, "popup blocking is surfaced to the user instead of failing silently");

// Expand-to-fullscreen: a toggle action enters a fullscreen overlay, Escape
// exits, and — critically — the overlay is PORTALED to document.body so it
// escapes the chat turn's content-visibility containing block. Without the
// portal the fixed overlay would be clipped to the turn row and "expand"
// wouldn't visibly expand.
assert.match(src, /fullscreen,\s*setFullscreen/, "tracks fullscreen artifact state");
assert.match(src, /aria-label=\{fullscreen \? "Exit fullscreen" : "Expand artifact fullscreen"\}/, "renders a fullscreen toggle action");
assert.match(src, /Icon name=\{fullscreen \? "ph:arrows-in-simple" : "ph:arrows-out-simple"\}/, "fullscreen toggle uses expand/collapse icons");
assert.match(src, /useFocusTrap\(fullscreen, shellRef, \{ onEscape: \(\) => setFullscreen\(false\) \}\)/, "Escape exits fullscreen via the shared focus-trap hook");
assert.match(src, /chat-artifact--fullscreen/, "fullscreen state applies the overlay class");
assert.match(src, /import \{ createPortal \} from "react-dom"/, "imports createPortal");
assert.match(src, /createPortal\(shell, document\.body\)/, "fullscreen overlay is portaled to document.body to escape the turn's containing block");


// ── 2026-07-03: fullscreen artifact overlay is a proper modal dialog ─────────
assert.match(src, /useFocusTrap\(fullscreen, shellRef, \{ onEscape: \(\) => setFullscreen\(false\) \}\)/, "fullscreen traps focus + closes on Escape + returns focus via the shared hook");
assert.match(src, /role: "dialog" as const, "aria-modal": true/, "fullscreen overlay is a labelled modal dialog");
assert.doesNotMatch(src, /addEventListener\("keydown"/, "the hand-rolled Escape listener is gone (the focus trap owns it)");

// ── Sandbox postMessage validation invariant (cave-mnz1) ────────────────────
// The iframe is sandboxed WITHOUT allow-same-origin, so its origin is opaque
// and its messages arrive with e.origin === "null". The e.source identity
// check is the correct (and stronger) validation; adding an e.origin
// equality check would silently break the error overlay. Audits keep
// flagging this — it is deliberate.
assert.match(src, /if \(e\.source !== frameRef\.current\?\.contentWindow\) return;/, "sandbox messages are authenticated by frame identity");
assert.doesNotMatch(src, /e\.origin !== window\.location\.origin/, "no origin-equality check (opaque-origin messages carry origin 'null')");
{
  const runtime = readFileSync(new URL("../sandbox/runtime-entry.ts", import.meta.url), "utf8");
  assert.match(runtime, /targetOrigin "\*" is correct here \(cave-mnz1\)/, "the runtime documents why it posts to '*'");
}

console.log("chat-artifact-viewer source contract: ok");
