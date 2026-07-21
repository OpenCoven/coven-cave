// @ts-nocheck
// Canvas sketch editor (design-handoff redesign): the full-surface editor with
// Select / Comment / Edit modes, persisted component comments, live inspector
// style overrides, and the design chat that refines + persists the sketch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as inspector from "../lib/canvas-inspector.ts";
import { resolveEscapeAction } from "../lib/canvas-editor-escape.ts";

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

// Escape deselects, but never swallows Escape from a non-empty field.
assert.match(
  editor,
  /event\.key !== "Escape" \|\| !selectionRef\.current\) return;[\s\S]{0,400}?active\.value\.trim\(\)[\s\S]{0,120}?return;[\s\S]{0,200}?setSelection\(null\)/,
  "Escape clears the selection unless a field still holds content",
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

// ── Escape precedence: field → selection → in-app expand ────────────────────
assert.equal(
  resolveEscapeAction({ fieldHasContent: true, hasSelection: true, expanded: true }),
  "none",
  "a non-empty field owns Escape outright",
);
assert.equal(
  resolveEscapeAction({ fieldHasContent: false, hasSelection: true, expanded: true }),
  "clear-selection",
  "selection clears before expand exits",
);
assert.equal(
  resolveEscapeAction({ fieldHasContent: false, hasSelection: false, expanded: true }),
  "exit-expand",
  "with nothing selected, Escape exits the expanded sketch",
);
assert.equal(
  resolveEscapeAction({ fieldHasContent: false, hasSelection: false, expanded: false }),
  "none",
  "Escape is a no-op when there is nothing to dismiss",
);

console.log("canvas editor wiring: ok");
