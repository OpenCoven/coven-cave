// @ts-nocheck
// Chat → Canvas tab: the saved-sketch gallery. "Save to Canvas" in the inline
// artifact viewer persists to /api/canvas, but after the standalone Canvas
// page retired those saves had no surface. The tab closes the loop: the chat
// scope tabs gain Canvas, backed by ChatCanvasView (fetch, sandboxed
// thumbnails, reopen-in-viewer, delete).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { formatArtifactWhen, sortArtifactsForGallery } from "../lib/canvas-gallery.ts";

const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./chat-canvas-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/chat-canvas.css", import.meta.url), "utf8");

// ── Tab wiring in the chat surface ──────────────────────────────────────────
assert.match(
  surface,
  /"conversation" \| "projects" \| "coven" \| "familiar" \| "settings" \| "canvas"/,
  "FamiliarsScope includes the canvas scope",
);
assert.match(
  surface,
  /\{ id: "projects", label: "Projects" \},\s*\{ id: "canvas", label: "Canvas" \},\s*\{ id: "familiar", label: "Familiar" \}/,
  "Canvas is a first-class scope tab between Projects and Familiar",
);
assert.match(
  surface,
  /scope === "canvas"[\s\S]{0,400}?<ChatCanvasView familiarId=\{activeFamiliarId\}/,
  "canvas scope renders ChatCanvasView with the active familiar (for Refine)",
);

// ── Gallery behavior ────────────────────────────────────────────────────────
assert.match(view, /fetch\("\/api\/canvas"/, "gallery loads artifacts from the canvas store");
assert.match(view, /method: "DELETE"/, "delete goes through the canvas store API");
assert.match(
  view,
  /confirm\(\{\s*title: "Delete sketch\?"/,
  "delete is guarded by the in-app confirm dialog",
);
assert.match(
  view,
  /sandbox="allow-scripts"/,
  "thumbnails render in an opaque-origin sandbox without popups/modals",
);
assert.match(view, /<ChatArtifactViewer/, "opening a card reuses the full inline artifact viewer");
assert.match(
  view,
  /key=\{opened\.id\}/,
  "viewer remounts per artifact so state never leaks between sketches",
);
assert.match(
  view,
  /sourcePrompt=\{opened\.prompt\}/,
  "reopened sketches keep their original prompt for refine/save",
);

// The thumbnail's pointer-events guard lives in the stylesheet — the iframe
// must never capture clicks meant for the card's open button.
assert.match(
  css,
  /\.chat-canvas-card__frame[\s\S]{0,300}?pointer-events: none/,
  "thumbnail iframe never captures pointer input",
);

// ── Pure helpers ────────────────────────────────────────────────────────────
const sorted = sortArtifactsForGallery([
  { id: "a", title: "old", prompt: "", code: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  { id: "b", title: "new", prompt: "", code: "", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
  { id: "c", title: "none", prompt: "", code: "", createdAt: "", updatedAt: "" },
]);
assert.deepEqual(sorted.map((a) => a.id), ["b", "a", "c"], "gallery sorts newest-first with blank timestamps last");

assert.equal(formatArtifactWhen("not-a-date"), "", "unparseable timestamps render as empty, not 'Invalid Date'");
assert.notEqual(formatArtifactWhen("2026-07-12T00:00:00Z"), "", "real timestamps produce a short date");

console.log("chat canvas tab wiring: ok");
