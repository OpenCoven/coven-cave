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
assert.match(view, /change\.type !== "dimensions"[\s\S]*?const \{ width,\s*height \} = change\.dimensions/, "artifact resize changes must capture dimensions");
assert.match(view, /savePosition\(change\.id,\s*\{[\s\S]*?width,[\s\S]*?height[\s\S]*?\}\)/, "resized artifacts must persist width/height");
assert.match(view, /const resizingNodeIds = useRef<Set<string>>\(new Set\(\)\)/, "canvas must track user-initiated artifact resizes");
assert.match(view, /change\.type === "dimensions" && change\.resizing[\s\S]*?resizingNodeIds\.current\.add\(change\.id\)/, "active resize changes mark the artifact as user-resized");
assert.match(view, /change\.type !== "dimensions" \|\| change\.resizing \|\| !change\.dimensions \|\| !resizingNodeIds\.current\.has\(change\.id\)/, "ResizeObserver dimension measurements must not persist to /api/canvas");
assert.match(view, /width:\s*saved\.width \?\? ARTIFACT_W/, "artifact nodes must restore saved width");
assert.match(view, /height:\s*saved\.height \?\? ARTIFACT_H/, "artifact nodes must restore saved height");

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
assert.match(artifactNode, /srcDoc=\{srcDoc\}/, "the iframe is fed the framed srcDoc");
assert.match(artifactNode, /sandbox="allow-scripts/, "the preview iframe must be sandboxed (scripts allowed)");
assert.doesNotMatch(
  artifactNode,
  /sandbox="[^"]*allow-same-origin/,
  "the preview must NOT grant allow-same-origin — that would break isolation",
);

// React artifacts use the offline-runtime harness; HTML artifacts the plain doc.
assert.match(artifactNode, /buildReactSrcDoc\(artifact\.code\)/, "react artifacts build the runtime harness srcDoc");
assert.match(artifactNode, /buildPreviewSrcDoc\(artifact\.code\)/, "html artifacts build the plain srcDoc");
assert.match(artifactNode, /artifact\.kind === "react"/, "the node branches the preview on artifact kind");

// Runtime errors from the sandbox surface in the node (not a blank frame),
// matched to THIS frame by comparing the postMessage source.
assert.match(artifactNode, /addEventListener\("message"/, "the node listens for sandbox postMessage errors");
assert.match(artifactNode, /e\.source !== frameRef\.current\?\.contentWindow/, "errors are matched to this node's iframe");
assert.match(artifactNode, /sandbox-error/, "the node handles the runtime's sandbox-error message");
assert.match(artifactNode, /canvas-artifact__error/, "a runtime error renders an overlay");
assert.match(artifactNode, /canvas-artifact-resizer/, "artifact resize controls must use canvas-scoped handle classes");
assert.match(
  artifactNode,
  /handleClassName="canvas-artifact-resizer__handle"/,
  "artifact resize handles must be targetable for larger hit areas",
);

// Generated kind is plumbed through to the stored artifact.
assert.match(view, /kind\s*=\s*result\.kind/, "generation records the extracted artifact kind");

// Refining generated artifacts must stay inside Cave's UI instead of using a
// blocking browser prompt.
assert.doesNotMatch(view, /window\.prompt/, "artifact refine must not use a native browser prompt");
assert.match(view, /transformArtifactId,\s*setTransformArtifactId/, "artifact refine opens an in-app transform panel");
assert.match(view, /Transform \{transformArtifact\?\.title \?\? "artifact"\}/, "transform panel names the target artifact");
assert.match(view, /Apply change/, "transform panel uses a concrete action label");
assert.match(view, /Cmd\+Enter/, "transform panel advertises the keyboard submit path");
assert.match(view, /TRANSFORM_SUGGESTIONS\.map/, "transform panel offers quick transform chips");
assert.match(view, /onClick=\{\(\) => setTransformAsk\(suggestion\.prompt\)\}/, "quick chips fill the transform textarea");
assert.match(view, /submitTransform\(\)/, "transform panel submits through the refine generation path");

// Artifacts persist to the canvas store via POST and delete via DELETE.
assert.match(view, /method:\s*"POST"[\s\S]{0,120}artifact/, "artifacts upsert to /api/canvas via POST");
assert.match(view, /method:\s*"DELETE"/, "deleting an artifact calls DELETE /api/canvas");

// Deleting a sketch is destructive + not undoable, so the trash control must
// confirm before calling onDelete.
assert.match(
  artifactNode,
  /window\.confirm\([\s\S]{0,80}\)\s*\)\s*\{\s*data\.onDelete\(artifact\.id\)/,
  "the artifact delete button must confirm before deleting",
);

// Chrome: the MiniMap is gated on having nodes (an empty canvas would render a
// blank box), and React Flow's MiniMap/Controls are themed to the dark surface
// (they default to white, which the workflow canvas only fixes under its own
// scope).
assert.match(view, /nodes\.length > 0 \? <MiniMap/, "MiniMap only renders when there are nodes");
const canvasCss = await readFile(new URL("../styles/canvas.css", import.meta.url), "utf8");
assert.match(canvasCss, /\.canvas-view \.react-flow__minimap\s*\{/, "canvas themes the React Flow minimap");
assert.match(canvasCss, /\.canvas-view \.react-flow__controls-button\s*\{/, "canvas themes the React Flow controls");
assert.match(
  canvasCss,
  /\.canvas-artifact-resizer__handle\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/,
  "artifact resize handles must expose a forgiving 28px hit target",
);
assert.match(
  canvasCss,
  /\.canvas-artifact-resizer__line\s*\{[\s\S]*?border-width:\s*8px;/,
  "artifact resize edges must expose a forgiving edge hit target",
);

console.log("canvas-view.test.ts ✓");
