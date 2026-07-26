// @ts-nocheck
// Canvas sketch editor (design-handoff redesign): the full-surface editor with
// Select / Comment / Edit modes, persisted component comments, live inspector
// style overrides, and the design chat that refines + persists the sketch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as inspector from "../lib/canvas-inspector.ts";
import { resolveEscapeAction } from "../lib/canvas-editor-escape.ts";
import {
  CANVAS_VIEWPORT_PRESETS,
  canvasViewportPreset,
  describeViewport,
  resolveViewportScale,
} from "../lib/canvas-viewport.ts";

const {
  buildCanvasInspectorScript,
  CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE,
  CANVAS_STYLE_OVERRIDE_MESSAGE_TYPE,
  createCanvasInspectorChannel,
  isCanvasStyleOverrideMessage,
} = inspector;

// ── Inspector style-override channel command ────────────────────────────────
assert.equal(
  CANVAS_STYLE_OVERRIDE_MESSAGE_TYPE,
  "cave-canvas-style-override",
  "the style-override command type is exported and stable",
);
assert.equal(
  isCanvasStyleOverrideMessage({
    type: CANVAS_STYLE_OVERRIDE_MESSAGE_TYPE,
    selector: "#a",
    styles: { color: "#111" },
  }),
  true,
  "well-formed style-override messages pass the guard",
);
assert.equal(
  isCanvasStyleOverrideMessage({ type: CANVAS_STYLE_OVERRIDE_MESSAGE_TYPE, selector: "#a" }),
  false,
  "style-override messages without a styles map are rejected",
);

class FakePort {
  onmessage = null;
  posted = [];
  closed = false;
  started = false;

  postMessage(message) {
    if (!this.closed) this.posted.push(message);
  }

  start() {
    this.started = true;
  }

  close() {
    this.closed = true;
  }

  receive(data) {
    if (!this.closed) this.onmessage?.({ data });
  }
}

{
  const channel = createCanvasInspectorChannel({
    onLoaded: () => {},
    onSelection: () => {},
  });
  const port = new FakePort();
  assert.equal(channel.acceptBootstrap(port), true, "bootstrap accepted");
  assert.equal(typeof channel.applyStyleOverride, "function", "channel exposes applyStyleOverride");

  channel.applyStyleOverride("#hero", { "font-size": "18px" });
  assert.deepEqual(
    port.posted,
    [],
    "style overrides are NOT posted before the authenticated load handshake",
  );

  port.receive({ type: CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE });
  channel.applyStyleOverride("#hero", { "font-size": "18px", "font-weight": "600" });
  assert.deepEqual(
    port.posted,
    [{
      type: CANVAS_STYLE_OVERRIDE_MESSAGE_TYPE,
      selector: "#hero",
      styles: { "font-size": "18px", "font-weight": "600" },
    }],
    "authenticated channels post the exact override command",
  );

  channel.dispose();
  channel.applyStyleOverride("#hero", { color: "#111" });
  assert.equal(port.posted.length, 1, "a disposed channel posts nothing");
}

// ── Injected inspector script handles the override command ─────────────────
const scriptTag = buildCanvasInspectorScript();
assert.match(
  scriptTag,
  new RegExp(CANVAS_STYLE_OVERRIDE_MESSAGE_TYPE),
  "the injected script knows the style-override command type",
);
assert.match(
  scriptTag,
  /document\.querySelector\(selector\)/,
  "overrides resolve their target with a guarded querySelector",
);
assert.match(
  scriptTag,
  /element\.style\.setProperty\(property, value\)/,
  "overrides assign inline style properties on the matched element",
);
assert.match(
  scriptTag,
  /typeof value !== "string"\) continue;/,
  "non-string override values are ignored",
);

// ── Editor source pins ──────────────────────────────────────────────────────
const editor = readFileSync(new URL("./canvas-editor.tsx", import.meta.url), "utf8");

// Contract the gallery agent wires against.
assert.match(editor, /export function CanvasEditor\(props: \{/, "CanvasEditor is exported");
assert.match(editor, /artifact: CanvasArtifact;/, "editor takes the persisted artifact");
assert.match(editor, /familiarId: string \| null;/, "editor takes the active familiar");
assert.match(editor, /onClose: \(\) => void;/, "editor exposes onClose for ← Gallery / Done");
assert.match(
  editor,
  /onArtifactUpdated\?: \(artifact: CanvasArtifact, artifacts: CanvasArtifact\[\]\) => void;/,
  "editor reports server-accepted artifact updates",
);
assert.match(editor, /import "@\/styles\/canvas-editor\.css";/, "editor imports its stylesheet");

// Inspector wiring replicates the viewer's deliberate security boundary.
assert.match(
  editor,
  /event\.source !== frameRef\.current\?\.contentWindow/,
  "the bootstrap is accepted only from the exact sketch frame",
);
assert.match(
  editor,
  /cave-mnz1/,
  "the deliberate e.source-identity-not-origin invariant keeps its explanatory comment",
);
assert.match(
  editor,
  /event\.data\?\.generation !== inspectorGeneration/,
  "stale bootstraps cannot cross srcDoc generations",
);
assert.match(editor, /channel\.dispose\(\)/, "stale inspector ports are closed on cleanup");
assert.match(
  editor,
  /e\.source !== frameRef\.current\?\.contentWindow[\s\S]{0,200}?sandbox-error/,
  "sandbox runtime errors pass the same source-identity check",
);
assert.match(
  editor,
  /sandbox="allow-scripts allow-popups allow-modals"/,
  "the sketch keeps the opaque-origin sandbox",
);
assert.doesNotMatch(
  editor,
  /sandbox="[^"]*allow-same-origin/,
  "the sketch frame never gains the app origin",
);

// Modes: one segmented control, selection enabled in every mode.
assert.match(
  editor,
  /modeButton\("select", "Select", "Select components"\)[\s\S]{0,200}?modeButton\("comment", "Comment", "Pin comments to components"\)[\s\S]{0,200}?modeButton\("edit", "Edit", "Edit fonts, borders, padding"\)/,
  "the three modes render with the mock's tooltips",
);
assert.match(editor, /aria-pressed=\{mode === id\}/, "mode toggles expose pressed state");
assert.match(
  editor,
  /if \(!inspectorLoaded\) return;[\s\S]{0,120}?setEnabled\(true\)/,
  "selection is enabled in every mode once the inspector authenticates",
);

// Escape routes through the shared resolver: field → selection → expand.
assert.match(
  editor,
  /import \{ resolveEscapeAction \} from "@\/lib\/canvas-editor-escape";/,
  "the editor delegates Escape precedence to the shared resolver",
);
assert.match(
  editor,
  /event\.key !== "Escape"\) return;[\s\S]{0,500}?resolveEscapeAction\(\{/,
  "the keydown handler asks the resolver what Escape should do",
);
assert.match(
  editor,
  /action === "clear-selection"[\s\S]{0,300}?setSelection\(null\)[\s\S]{0,400}?action === "exit-expand"[\s\S]{0,200}?setExpanded\(false\)/,
  "selection clears before expand exits, matching the resolver order",
);

// Pinned comments persist as artifact annotations via PATCH.
assert.match(
  editor,
  /method: "PATCH"[\s\S]{0,200}?JSON\.stringify\(\{ id: artifactRef\.current\.id, annotation \}\)/,
  "Pin persists the annotation through PATCH /api/canvas",
);
assert.match(
  editor,
  /method: "PATCH"[\s\S]{0,200}?removeAnnotationId: annotation\.id/,
  "comment removal goes through the removeAnnotationId mutation",
);
assert.match(
  editor,
  /annotation-\$\{crypto\.randomUUID\(\)\}/,
  "annotations mint the shared annotation id shape",
);
assert.match(
  editor,
  /sanitizeCanvasComponentTarget/,
  "selection targets are sanitized before use",
);
assert.match(
  editor,
  /press Pin again/,
  "a failed pin keeps the draft and surfaces a retryable error",
);

// Design-chat persistence is conflict-guarded.
assert.match(
  editor,
  /const expectedUpdatedAt = persisted\.updatedAt;[\s\S]{0,900}?body: JSON\.stringify\(\{\s*artifact: revised,\s*expectedUpdatedAt,/,
  "revisions POST with the last accepted updatedAt precondition",
);
assert.match(
  editor,
  /res\.status === 409[\s\S]{0,900}?res\.status === 404/,
  "conflict and deletion get distinct user-facing outcomes",
);
assert.match(
  editor,
  /buildRefinePrompt\(codeRef\.current, ask, kindRef\.current\)/,
  "generation goes through the shared refine prompt contract",
);
assert.match(
  editor,
  /buildCanvasCommentsRequest\(annotationsRef\.current\)/,
  "Apply comments reuses the shared comments request builder",
);
assert.match(
  editor,
  /clearAnnotations: true,\s*resolvedAnnotations,/,
  "Apply comments clears annotations with resolution tokens on save",
);
assert.match(editor, /Pick a familiar to run design changes\./, "familiar-less sends reply in chat");
assert.match(editor, /abortRef\.current\?\.abort\(\)/, "unmount aborts in-flight generation");

// Style edits are preview-only until routed through the familiar.
assert.match(
  editor,
  /applyStyleOverride\(target\.selector, styleOverrideCss\(next, \[key\]\)\)/,
  "edit-mode controls send only the property that changed",
);
assert.match(
  editor,
  /Style edits preview live — ask the design chat to make them permanent\./,
  "edit mode explains that overrides are experiments",
);
assert.match(editor, /Apply via familiar/, "dirty style edits offer the familiar handoff");
assert.match(
  editor,
  /follows the gallery thumbnail\s*\/\/ precedent|precedent of a fixed `#fff` sketch ground/,
  "literal sketch-content colors carry their justification",
);

// A11y basics.
assert.match(editor, /aria-live="polite"/, "selection/save outcomes are announced");
assert.match(editor, /aria-label="Send design request"/, "the icon send button is labelled");
assert.match(editor, /aria-label=\{`Remove comment on \$\{annotation\.target\.label/, "comment removal is labelled per target");

// ── Pure helper: describeStyleEdits shape (mirrors the component's module) ──
// The component module imports CSS so it can't be imported here; pin the
// description grammar instead.
assert.match(
  editor,
  /Apply exactly these style changes to the listed components \(keep everything else untouched\):/,
  "the familiar handoff describes edits with an explicit preservation instruction",
);
assert.match(
  editor,
  /border": css\["border"\] = draft\.borderW > 0 \? `\$\{draft\.borderW\}px solid \$\{SKETCH_BORDER_COLOR\}` : "none";|draft\.borderW > 0 \? `\$\{draft\.borderW\}px solid \$\{SKETCH_BORDER_COLOR\}` : "none"/,
  "border width 0 maps to border: none",
);

// ── Full screen: in-app expand + native fullscreen ──────────────────────────
assert.match(
  editor,
  /className=\{`canvas-editor\$\{expanded \? " canvas-editor--expanded" : ""\}`\}/,
  "the expanded state drives the root modifier class",
);
assert.match(editor, /aria-pressed=\{expanded\}/, "the expand toggle exposes pressed state");
assert.match(
  editor,
  /doc\.fullscreenEnabled \|\| doc\.webkitFullscreenEnabled/,
  "availability covers standard and WebKit-prefixed Fullscreen APIs",
);
assert.match(
  editor,
  /\{fullscreenAvailable \? \(/,
  "the native full screen button renders only when the API is available",
);
assert.match(
  editor,
  /addEventListener\("fullscreenchange", onFullscreenChange\);[\s\S]{0,120}?addEventListener\("webkitfullscreenchange", onFullscreenChange\)/,
  "fullscreenchange (incl. webkit) keeps the button state in sync",
);
assert.match(
  editor,
  /ref=\{frameShellRef\}/,
  "the frame shell (iframe + error overlay) is the fullscreen element",
);
assert.match(
  editor,
  /nativeFullscreen: Boolean\(doc\.fullscreenElement \?\? doc\.webkitFullscreenElement\)/,
  "the keydown handler reads native fullscreen from the DOM at event time",
);

const editorCss = readFileSync(new URL("../styles/canvas-editor.css", import.meta.url), "utf8");
assert.match(
  editorCss,
  /\.canvas-editor--expanded \.canvas-editor__aside \{\s*display: none;/,
  "expanding hides the inspector/design-chat aside",
);
assert.match(
  editorCss,
  /\.canvas-editor--expanded \.canvas-editor__frame-shell \{[^}]*width: 100%;/,
  "expanding removes the 900px frame cap",
);
assert.match(
  editorCss,
  /\.canvas-editor__frame-shell:fullscreen \{[^}]*border: 0;/,
  "native fullscreen strips the frame chrome",
);

// ── Viewport presets (cave-ztbo) ────────────────────────────────────────────
// The design interface renders the sketch at preset device sizes: true CSS
// pixels inside the iframe (media queries fire), scaled to fit the stage.
assert.deepEqual(
  CANVAS_VIEWPORT_PRESETS.map((p) => p.id),
  ["fill", "desktop", "tablet", "phone"],
  "the preset vocabulary: fill + three device classes",
);
{
  const byId = Object.fromEntries(CANVAS_VIEWPORT_PRESETS.map((p) => [p.id, p]));
  assert.equal(byId.fill.width, undefined, "fill has no fixed size — it tracks the stage");
  assert.deepEqual([byId.desktop.width, byId.desktop.height], [1280, 800], "desktop preset is 1280×800");
  assert.deepEqual([byId.tablet.width, byId.tablet.height], [768, 1024], "tablet preset is portrait 768×1024");
  assert.deepEqual([byId.phone.width, byId.phone.height], [390, 844], "phone preset is 390×844");
}
assert.equal(canvasViewportPreset("tablet").id, "tablet", "presets resolve by id");
assert.equal(canvasViewportPreset("nope").id, "fill", "unknown ids fall back to fill");
assert.equal(resolveViewportScale(canvasViewportPreset("fill"), 500, 500), 1, "fill never scales");
assert.equal(
  resolveViewportScale(canvasViewportPreset("desktop"), 640, 400),
  0.5,
  "a sized preset scales down to fit the tighter axis",
);
assert.equal(
  resolveViewportScale(canvasViewportPreset("phone"), 4000, 4000),
  1,
  "presets never upscale — small devices render 1:1 on big stages",
);
assert.equal(
  resolveViewportScale(canvasViewportPreset("desktop"), 0, 0),
  1,
  "an unmeasured stage (pre-ResizeObserver) resolves to 1, never 0/NaN",
);
assert.equal(
  resolveViewportScale(canvasViewportPreset("desktop"), 1, 1),
  0.05,
  "scale floors at 0.05 so the frame can never collapse",
);
assert.equal(describeViewport(canvasViewportPreset("fill"), 1), null, "fill has no size caption");
assert.equal(
  describeViewport(canvasViewportPreset("desktop"), 0.5),
  "1280×800 · 50%",
  "scaled presets caption device size + zoom",
);
assert.equal(
  describeViewport(canvasViewportPreset("phone"), 1),
  "390×844",
  "1:1 presets caption the size alone",
);

// Editor wiring: a labelled preset group in the header, and the frame box
// stays mounted in BOTH modes so toggling presets never reloads the iframe.
assert.match(editor, /role="group" aria-label="Viewport size"/, "header exposes the viewport preset group");
assert.match(
  editor,
  /CANVAS_VIEWPORT_PRESETS\.map\(\(preset\) =>/,
  "preset buttons render from the shared preset table",
);
assert.match(
  editor,
  /aria-pressed=\{viewportId === preset\.id\}/,
  "the active preset is announced via aria-pressed",
);
assert.match(editor, /className="canvas-editor__frame-box"/, "the frame box wrapper is always mounted");
assert.match(
  editor,
  /transform: `scale\(\$\{viewportScale\}\)`,\s*transformOrigin: "top left",/,
  "the iframe renders at device pixels and scales to fit (devtools-style)",
);
assert.match(editor, /new ResizeObserver\(compute\)/, "scale tracks stage resizes");
assert.match(
  editor,
  /nativeFullscreen\s*\? \{ width: window\.innerWidth, height: window\.innerHeight \}/,
  "native fullscreen measures the screen — the UA forces the shell to 100%",
);
assert.match(
  editorCss,
  /\.canvas-editor__frame-shell--viewport \.canvas-editor__frame-box \{[^}]*transform: translate\(-50%, -50%\);/,
  "the device box centers via absolute positioning — its explicit device size stays out of intrinsic sizing, so a stale scale can never stretch the pane",
);
assert.match(
  editorCss,
  /\.canvas-editor__frame-shell--viewport \.canvas-editor__frame-box \{[^}]*outline: 1px solid/,
  "device chrome is an outline, not a border — no device pixels get clipped",
);

// ── Escape precedence: native fullscreen → field → selection → expand ───────
assert.equal(
  resolveEscapeAction({ nativeFullscreen: true, fieldHasContent: true, hasSelection: true, expanded: true }),
  "none",
  "native fullscreen owns Escape outright — the browser exits it",
);
assert.equal(
  resolveEscapeAction({ nativeFullscreen: false, fieldHasContent: true, hasSelection: true, expanded: true }),
  "none",
  "a non-empty field owns Escape outright",
);
assert.equal(
  resolveEscapeAction({ nativeFullscreen: false, fieldHasContent: false, hasSelection: true, expanded: true }),
  "clear-selection",
  "selection clears before expand exits",
);
assert.equal(
  resolveEscapeAction({ nativeFullscreen: false, fieldHasContent: false, hasSelection: false, expanded: true }),
  "exit-expand",
  "with nothing selected, Escape exits the expanded sketch",
);
assert.equal(
  resolveEscapeAction({ nativeFullscreen: false, fieldHasContent: false, hasSelection: false, expanded: false }),
  "none",
  "Escape is a no-op when there is nothing to dismiss",
);

console.log("canvas editor wiring: ok");
