// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./canvas-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const mode = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");

// ── Canvas is a registered workspace mode end-to-end ───────────────────────

assert.match(mode, /\|\s*"canvas"/, 'workspace-mode union must include "canvas"');
assert.match(workspace, /canvas:\s*"Canvas"/, "workspace must title the canvas mode (also feeds VALID_MODES)");
assert.match(workspace, /mode === "canvas" \?\s*\(\s*<CanvasView/, "workspace must render CanvasView for the canvas mode");
assert.match(workspace, /import \{ CanvasView \} from "@\/components\/canvas-view"/, "workspace must import CanvasView");

// Sidebar entry so the surface is reachable.
assert.match(sidebar, /id: "canvas"/, "sidebar must list a canvas destination");
assert.match(sidebar, /\|\s*"canvas"/, "FolderMode union must include canvas");

// ── The triage gesture: drag across a band → PATCH the card's status ───────

assert.match(view, /onNodeDragStop/, "canvas must react to drag completion");
assert.match(view, /bandForX\(centerX\)/, "drop position must map to a status band");
assert.match(
  view,
  /fetch\(`\/api\/board\/\$\{id\}`,\s*\{\s*method:\s*"PATCH"/,
  "a band change must PATCH the card status on the board",
);
// Optimistic mutation must revert on failure (board-view lesson: review the failure path).
assert.match(view, /status:\s*prevStatus/, "a failed status PATCH must revert to the previous status");
assert.match(view, /setActionError/, "a failed mutation must surface an error to the user");

// ── Positions persist to the dedicated canvas store, not the board ─────────

assert.match(view, /fetch\("\/api\/canvas",\s*\{\s*method:\s*"PUT"/, "moved nodes must persist to /api/canvas");
assert.match(view, /resolvePositions/, "nodes must be built from resolved (saved + auto-placed) positions");

// ── Familiar scoping mirrors the Board ─────────────────────────────────────

assert.match(
  view,
  /activeFamiliarId === null \|\| c\.familiarId === activeFamiliarId/,
  "canvas must scope cards to the active familiar the same way the board does",
);

// ── Sketch layer: generate UIs ad hoc, render in a sandboxed iframe ────────

const artifactNode = await readFile(new URL("./canvas-artifact-node.tsx", import.meta.url), "utf8");

// Layer toggle is persisted and gates the bands (triage-only).
assert.match(view, /cave:canvas:layer/, "the Triage/Sketch layer choice must persist");
assert.match(view, /isSketch \? null : <BandGuides/, "status bands must only render in the triage layer");

// Generation routes through the chat bridge (Cave has no server LLM).
assert.match(view, /generateArtifactCode/, "Sketch must generate via the chat-bridge helper");
assert.match(
  artifactNode + view,
  /buildSketchPrompt|buildRefinePrompt/,
  "generation must wrap the user's ask in the one-document sketch/refine prompt",
);

// The preview MUST be a sandboxed iframe WITHOUT allow-same-origin, so
// generated (untrusted) code can't reach Cave's origin.
assert.match(artifactNode, /<iframe/, "artifacts render in an iframe");
assert.match(artifactNode, /srcDoc=\{buildPreviewSrcDoc/, "the iframe is fed a framed srcDoc");
assert.match(artifactNode, /sandbox="allow-scripts/, "the preview iframe must be sandboxed (scripts allowed)");
assert.doesNotMatch(
  artifactNode,
  /sandbox="[^"]*allow-same-origin/,
  "the preview must NOT grant allow-same-origin — that would break isolation",
);

// Artifacts persist to the canvas store via POST and delete via DELETE.
assert.match(view, /method:\s*"POST"[\s\S]{0,120}artifact/, "artifacts upsert to /api/canvas via POST");
assert.match(view, /method:\s*"DELETE"/, "deleting an artifact calls DELETE /api/canvas");

console.log("canvas-view.test.ts ✓");
