// @ts-nocheck
// Source-text checks for the in-chat artifact viewer. We can't mount React
// here, so assert the contract: tabs default to Canvas, the iframe is
// sandboxed without same-origin, refine/save wiring is present.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-artifact-viewer.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/chat-artifact.css", import.meta.url), "utf8");

assert.match(src, /useState[^\n]*"canvas"/, "default tab is canvas");
assert.match(src, /buildReactSrcDoc|buildPreviewSrcDoc/, "uses the canvas srcDoc builders");
assert.match(src, /sandbox="allow-scripts allow-popups allow-modals"/, "iframe sandboxed");
assert.doesNotMatch(src, /allow-same-origin/, "iframe must NOT allow same-origin");
assert.match(src, /sandbox-error/, "listens for sandbox runtime errors");
assert.match(src, /generateArtifactCode/, "refine calls the generator");
assert.match(src, /buildRefinePrompt/, "refine wraps with the refine prompt");
assert.match(src, /buildCanvasCommentsRequest/, "comment application derives prompt and exact resolution tokens together");
assert.match(src, /resolvedAnnotations/, "comment resolution tokens are sent with the guarded revision");
assert.match(src, /reconcileCanvasAnnotationSnapshot/, "annotation PATCH responses use content-aware reconciliation");
assert.match(src, /adoptCanvasContentSnapshot/, "successful Apply comments saves explicitly adopt and clean content");
assert.match(src, /contentConflictRef\.current/, "the viewer tracks an explicit persisted-content conflict");
assert.match(
  src,
  /Saved artifact changed; reopen it, or save your work as a copy before applying comments\./,
  "content conflicts provide actionable reopen-or-copy feedback",
);
assert.match(
  src,
  /if \(contentConflictRef\.current\)[\s\S]{0,250}?setCommentsError\(CONTENT_CONFLICT_MESSAGE\)/,
  "Apply comments is blocked before generation when persisted content conflicted",
);
assert.match(
  src,
  /const annotationsSaved = await flushAnnotationWrites\(\);[\s\S]{0,500}?if \(contentConflictRef\.current\)[\s\S]{0,250}?setCommentsError\(CONTENT_CONFLICT_MESSAGE\)/,
  "a conflict revealed by the Apply-time annotation flush blocks generation",
);
assert.match(
  src,
  /disabled=\{contentConflict \|\| applyingComments \|\| generating/,
  "the Apply comments control remains disabled while the saved content conflict is unresolved",
);
assert.match(src, /markLocalContentChanged/, "manual edits and ordinary Refine update local dirty tracking");
assert.match(src, /data\.artifact/, "the viewer adopts the server-authoritative artifact after comment application");
assert.match(
  src,
  /const savedArtifact = data\.artifact;[\s\S]{0,400}?synchronizeArtifactSnapshot\(savedArtifact,/,
  "the viewer adopts the server-returned revision rather than its submitted revision",
);
assert.match(src, /\/api\/canvas/, "save posts to the canvas store");
assert.match(src, /readCanvasAnnotationOperations\([^)]*artifact\?\.id/, "viewer hydrates pending annotation operations from artifact-scoped storage");
assert.match(src, /overlayCanvasAnnotationOperations/, "viewer overlays navigation-durable pending operations on server annotations");
assert.match(src, /writeCanvasAnnotationOperations/, "queue changes synchronously persist pending annotation operations");
assert.match(src, /void drainAnnotationWrites\(\)/, "viewer retries stored pending operations on mount/return");
assert.doesNotMatch(src, /keepalive\s*:/, "viewer teardown sends no keepalive annotation requests");
assert.doesNotMatch(src, /sendPendingAnnotationKeepalives/, "viewer teardown only persists locally");
assert.match(
  src,
  /const annotationsSaved = await flushAnnotationWrites\(\);[\s\S]*?const persistedArtifact = artifactRef\.current;[\s\S]*?const codeSnapshot = codeRef\.current;[\s\S]*?const kindSnapshot = kindRef\.current;[\s\S]*?const expectedUpdatedAt = persistedArtifact\.updatedAt;/,
  "Apply flushes annotations before reading the synchronized code, kind, and revision snapshot",
);
assert.match(
  src,
  /const reconciliation = reconcileCanvasAnnotationSnapshot[\s\S]*?artifactRef\.current = reconciliation\.acceptedArtifact[\s\S]*?contentDirtyRef\.current = reconciliation\.contentDirty[\s\S]*?contentConflictRef\.current = reconciliation\.contentConflict/,
  "PATCH responses reconcile persisted, dirty, and conflict state atomically",
);
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
assert.match(
  css,
  /\.chat-artifact--fullscreen \.chat-artifact__comments\s*\{[^}]*max-height:[^;}]+;[^}]*min-height:\s*0;[^}]*\}/s,
  "fullscreen bounds the comments region without changing the non-fullscreen panel",
);
assert.match(
  css,
  /\.chat-artifact--fullscreen \.chat-artifact__comments-list\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*\}/s,
  "fullscreen makes only the annotation list vertically scrollable",
);
assert.doesNotMatch(
  css,
  /(?:^|\n)\.chat-artifact__comments\s*\{[^}]*max-height:/s,
  "the ordinary comments layout remains unbounded",
);

// ── Sandbox postMessage validation invariant (cave-mnz1) ────────────────────
// The iframe is sandboxed WITHOUT allow-same-origin, so its origin is opaque
// and its messages arrive with e.origin === "null". The e.source identity
// check is the correct (and stronger) validation; adding an e.origin
// equality check would silently break the error overlay. Audits keep
// flagging this — it is deliberate.
assert.match(src, /if \(e\.source !== frameRef\.current\?\.contentWindow\) return;/, "sandbox messages are authenticated by frame identity");
assert.doesNotMatch(src, /e\.origin !== window\.location\.origin/, "no origin-equality check (opaque-origin messages carry origin 'null')");
assert.match(src, /useLayoutEffect\(\(\) => \{[\s\S]*CANVAS_INSPECTOR_READY_MESSAGE_TYPE/, "bootstrap listener is installed in layout effect");
assert.match(src, /createCanvasInspectorChannel/, "viewer delegates first-port and loaded-handshake lifecycle to the channel controller");
assert.match(
  src,
  /useLayoutEffect\(\(\) => \{[\s\S]{0,300}?if \(tab !== "canvas"\) return;[\s\S]{0,1600}?\}, \[acceptInspectorSelection, inspectorGeneration, tab\]\)/,
  "leaving Canvas disposes its inspector effect and returning creates a channel for the replacement iframe",
);
assert.doesNotMatch(src, /new MessageChannel\(\)/, "the parent no longer creates the inspector channel");
assert.doesNotMatch(src, /CANVAS_INSPECTOR_CONNECT_MESSAGE_TYPE/, "the parent no longer transfers a port into the child");
assert.match(src, /disabled=\{applyingComments \|\| !inspectorLoaded\}/, "comment mode stays disabled until authenticated load");
{
  const runtime = readFileSync(new URL("../sandbox/runtime-entry.ts", import.meta.url), "utf8");
  assert.match(runtime, /targetOrigin "\*" is correct here \(cave-mnz1\)/, "the runtime documents why it posts to '*'");
}

console.log("chat-artifact-viewer source contract: ok");
