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

// ── Add tile (cave-fema): in-grid sketch creation ────────────────────────────
// The gallery owns its add affordance: a ghost tile leads the grid (and IS
// the empty state), expanding in-place into the Describe/Paste/Blank
// composer. Save is explicit; nothing hits /api/canvas mid-stream.
const addTile = readFileSync(new URL("./canvas-add-tile.tsx", import.meta.url), "utf8");

assert.match(
  view,
  /<CanvasAddTile hero=\{artifacts\.length === 0\} familiarId=\{familiarId\} onSaved=\{handleSaved\} \/>/,
  "ONE stable tile mount leads the grid — hero-styled when empty, so crossing zero never remounts the composer",
);
assert.doesNotMatch(view, /<CanvasAddTile hero familiarId/, "no second, remount-prone hero mount remains");
assert.doesNotMatch(view, /No saved sketches yet/, "the old leave-for-chat empty state is gone");
assert.match(view, /chat-canvas-card--new/, "a kept sketch settles in with a one-shot highlight");

assert.match(addTile, /aria-expanded=\{false\}/, "the ghost tile reports its expansion state");
assert.match(addTile, /generateArtifactCode\(\{/, "describe streams through the existing chat bridge");
assert.match(addTile, /buildSketchPrompt\(state\.prompt\)/, "prompts are wrapped with the shared sketch contract");
assert.match(addTile, /buildRefinePrompt\(state\.result\.code, ask, state\.result\.kind\)/, "refine reuses the shared refine contract");
assert.match(addTile, /abortRef\.current\?\.abort\(\)/, "collapse/unmount aborts an in-flight generation");
assert.match(addTile, /sandbox="allow-scripts"/, "the in-tile preview keeps the opaque-origin sandbox");
assert.match(addTile, /detectPastedKind\(state\.pastedCode\)/, "pasted code kind is detected, not asked");
assert.match(addTile, /useAnnouncer/, "completion and saves are announced to AT");
assert.match(
  addTile,
  /method: "POST",[\s\S]{0,200}?body: JSON\.stringify\(\{ artifact \}\)/,
  "saving posts one artifact to the existing canvas store route",
);
assert.doesNotMatch(addTile, /fetch\("\/api\/canvas"[\s\S]{0,80}?onText/, "no save happens mid-stream — explicit Keep only");

console.log("chat canvas tab wiring: ok");
