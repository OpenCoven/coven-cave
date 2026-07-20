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
const viewer = readFileSync(new URL("./chat-artifact-viewer.tsx", import.meta.url), "utf8");
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
assert.match(view, /artifact=\{opened\}/, "reopened persisted sketches opt into comment mode");
assert.match(
  view,
  /onArtifactUpdated=\{handleArtifactUpdated\}/,
  "same-artifact updates flow back into the sorted gallery",
);
assert.match(
  view,
  /setArtifacts\(sortArtifactsForGallery\(next\)\)/,
  "artifact update callbacks preserve gallery ordering",
);
assert.doesNotMatch(
  view,
  /handleArtifactUpdated[\s\S]{0,200}?setOpenId/,
  "background annotation flushes never reopen or replace the active modal",
);

// ── Persisted component comments ─────────────────────────────────────────────
assert.match(viewer, /artifact\?: CanvasArtifact/, "viewer accepts an optional persisted artifact identity");
assert.match(viewer, /onArtifactUpdated\?: \(artifact: CanvasArtifact, artifacts: CanvasArtifact\[\]\) => void/, "viewer reports same-artifact updates");
assert.doesNotMatch(
  viewer,
  /isCanvasComponentSelectedMessage\(e\.data\)/,
  "window messages are never trusted for component selection",
);
assert.match(
  viewer,
  /useLayoutEffect\(\(\) => \{[\s\S]{0,1200}?CANVAS_INSPECTOR_READY_MESSAGE_TYPE[\s\S]{0,300}?event\.ports\?\.\[0\]/,
  "the parent receives the child-created MessageChannel bootstrap in a layout effect",
);
assert.match(
  viewer,
  /event\.source !== frameRef\.current\?\.contentWindow/,
  "the bootstrap is accepted only from the exact preview frame",
);
assert.match(
  viewer,
  /event\.data\?\.generation !== inspectorGeneration/,
  "stale bootstraps cannot cross srcDoc generations",
);
assert.match(
  viewer,
  /handleFrameLoad\(\)[\s\S]{0,1000}?commentModeRef\.current = false[\s\S]{0,500}?reload or reopen/i,
  "artifact-initiated iframe navigation closes the channel, disables comments, and instructs recovery",
);
assert.match(
  viewer,
  /disabled=\{applyingComments \|\| !inspectorLoaded\}/,
  "comment mode remains disabled until the retained port authenticates window load",
);
assert.match(viewer, /onLoad=\{handlePreviewLoad\}/, "iframe loads pass through the expected-navigation guard");
assert.match(viewer, /channel\.dispose\(\)/, "stale inspector ports are closed on generation cleanup");
assert.match(
  viewer,
  /onSelection: acceptInspectorSelection/,
  "selection is accepted only from the current owned port",
);
assert.match(
  viewer,
  /const acceptInspectorSelection[\s\S]{0,400}?isCanvasComponentSelectedMessage\(value\)/,
  "owned-port selection payloads pass the shared message guard",
);
assert.match(viewer, /mountedRef\.current = true/, "strict-mode effect setup restores mounted response guards");
assert.match(
  viewer,
  /method: "PATCH"[\s\S]{0,200}?body: JSON\.stringify\(operation\)/,
  "annotation persistence sends one incremental PATCH operation",
);
assert.doesNotMatch(viewer, /annotations: snapshot/, "annotation autosave never posts a full stale annotation snapshot");
assert.doesNotMatch(
  viewer,
  /keepalive\s*:/,
  "unmount performs no network keepalive requests",
);
assert.match(viewer, /CanvasAnnotationOperationQueue/, "annotation persistence uses the lossless operation queue");
assert.doesNotMatch(viewer, /persistedAnnotationRevisionRef/, "successful revisions no longer suppress older failed operations");
assert.match(
  viewer,
  /writeCanvasAnnotationOperations\(\s*annotationStorage,\s*artifact\?\.id,\s*annotationQueueRef\.current!\.pending\(\),?\s*\)/,
  "unmount synchronously persists the complete coalesced pending queue locally",
);
assert.match(viewer, /readCanvasAnnotationOperations\(annotationStorage, artifact\?\.id\)/, "mount hydrates the artifact-scoped pending queue");
assert.match(viewer, /if \(annotationQueueRef\.current!\.size > 0\) void drainAnnotationWrites\(\)/, "mount retries hydrated pending operations");
assert.match(
  viewer,
  /retryAnnotationWrites[\s\S]{0,500}?annotationQueueRef\.current!\.retry/,
  "the viewer exposes an explicit retry path that resumes the blocked queue",
);
assert.match(viewer, /Retry saving comments/, "the save failure exposes an actionable retry control");
assert.match(
  viewer,
  /commentsSaveError[\s\S]{0,250}?role="alert"[\s\S]{0,500}?Retry saving comments/,
  "the persistent save error and retry action stay together",
);
assert.match(
  viewer,
  /artifact && \(commentMode \|\| annotations\.length > 0 \|\| commentsSaveError\)/,
  "a failed last-annotation removal keeps the comments region and retry action mounted",
);
assert.match(viewer, /if \(!ask \|\| !familiarId \|\| generatingRef\.current \|\| applyingCommentsRef\.current\) return;/, "freeform refine cannot race comment application");
assert.match(viewer, /if \(!artifact \|\| generatingRef\.current \|\| applyingCommentsRef\.current\) return;/, "comment application cannot race another generation");
assert.match(
  viewer,
  /await flushAnnotationWrites\(\);[\s\S]{0,100}?if \(!mountedRef\.current\)/,
  "navigation during the persistence flush does not start comment generation",
);
assert.match(
  viewer,
  /annotationQueueRef\.current!\.size > 0[\s\S]{0,300}?incomingUpdatedAt <= acceptedArtifactUpdatedAtRef\.current/,
  "prop hydration is suppressed while any annotation operation remains unpersisted",
);
assert.match(viewer, /className="chat-artifact__code-edit"[\s\S]{0,250}?disabled=\{generating \|\| applyingComments\}/, "code editing is locked while either generation workflow runs");
assert.match(
  viewer,
  /annotationFocusRef\.current === annotation\.id[\s\S]{0,100}?annotationFocusRef\.current = null/,
  "newly selected targets receive one-shot focus without stealing later edits",
);
assert.match(
  viewer,
  /const focused = next\.find\([\s\S]{0,180}?sanitizeCanvasComponentTarget\(annotation\.target\)\?\.selector === target\.selector[\s\S]{0,120}?annotationFocusRef\.current = focused\?\.id \?\? null/,
  "selection focus resolves only from the sanitized selected target after upsert",
);
assert.match(
  viewer,
  /if \(next !== annotationsRef\.current && focused\)[\s\S]{0,160}?updateAnnotations\(next,/,
  "an annotation rejected at the cap does not enqueue a redundant persistence write",
);
assert.match(
  viewer,
  /const acceptedArtifactUpdatedAtRef = useRef\(artifact\?\.updatedAt \?\? ""\)/,
  "annotation prop synchronization tracks the newest accepted artifact revision",
);
assert.match(
  viewer,
  /annotationQueueRef\.current!\.size > 0[\s\S]*?incomingUpdatedAt <= acceptedArtifactUpdatedAtRef\.current[\s\S]*?reconcileCanvasAnnotationSnapshot\([\s\S]*?contentConflict: contentConflictRef\.current[\s\S]*?setContentConflict\(reconciliation\.contentConflict\)/,
  "newer artifact props use the same clean-adopt and dirty-conflict reconciliation contract",
);
assert.match(
  viewer,
  /reconcileCanvasAnnotationSnapshot[\s\S]*?artifactRef\.current = reconciliation\.acceptedArtifact[\s\S]*?onArtifactUpdatedRef\.current\?\.\(reconciliation\.reportedArtifact/,
  "a successful annotation write reconciles local content before reporting the real server snapshot",
);
assert.doesNotMatch(
  viewer,
  /incomingAnnotations[\s\S]{0,200}?updateAnnotations\(incomingAnnotations\)/,
  "prop hydration never routes through autosave or writes the stale initial snapshot back",
);
assert.match(
  viewer,
  /const result = await generateArtifactCode\([\s\S]{0,500}?if \(!mountedRef\.current \|\| ctrl\.signal\.aborted \|\| result\.error === "cancelled"\) return;/,
  "aborted or unmounted comment generation never persists partial output",
);
assert.match(viewer, /aria-label="Comment mode"/, "persisted previews expose an accessible comment mode toggle");
assert.match(
  viewer,
  /Click a component, or focus one in the preview and press Enter or Space\./,
  "comment mode includes concise keyboard guidance",
);
assert.match(
  viewer,
  /aria-live="polite"[\s\S]{0,120}?selectionAnnouncement/,
  "selected component targets are announced through the live region",
);
assert.match(viewer, /"Apply comments"/, "comment drafts expose an Apply comments action");
assert.match(viewer, /aria-label=\{`Comment on \$\{annotation\.target\.label/, "each comment has a labelled note textarea");
assert.match(viewer, /aria-label=\{`Remove comment on \$\{annotation\.target\.label/, "each comment has a labelled remove action");
assert.match(
  viewer,
  /const \{ prompt: commentsPrompt, resolvedAnnotations \} = buildCanvasCommentsRequest\(annotationsRef\.current\)/,
  "comment application captures its exact prompt and resolution tokens from one annotation snapshot",
);
assert.match(
  viewer,
  /const expectedUpdatedAt = persistedArtifact\.updatedAt[\s\S]{0,1800}?body: JSON\.stringify\(\{ artifact: revisedArtifact, expectedUpdatedAt, resolvedAnnotations \}\)/,
  "comment application sends the content revision and pre-generation resolution tokens",
);
assert.match(
  viewer,
  /res\.status === 404 \|\| res\.status === 409/,
  "comment application handles deletion and conflict before the generic error path",
);
assert.match(
  viewer,
  /res\.status === 404[\s\S]{0,500}?deleted[\s\S]{0,350}?reopen[\s\S]{0,100}?retry/i,
  "delete-during-generation keeps the viewer intact and gives actionable reopen/retry feedback",
);
assert.match(
  viewer,
  /: "This artifact changed[\s\S]{0,350}?Reopen[\s\S]{0,100}?retry/i,
  "stale comment application gives actionable conflict feedback",
);
assert.match(
  viewer,
  /nextCode !== codeSnapshot[\s\S]{0,180}?setCommentsRecovery\(\{ code: nextCode, kind: nextKind \}\)/,
  "a useful generated draft is preserved separately after a rejected update",
);
assert.match(
  viewer,
  /commentsRecovery[\s\S]{0,500}?Generated draft wasn&apos;t saved[\s\S]{0,500}?Copy generated code/,
  "rejected generated output is clearly separated from the visible artifact",
);
assert.match(
  viewer,
  /const savedArtifact = data\.artifact[\s\S]*?synchronizeArtifactSnapshot\(savedArtifact, data\.artifacts \?\? \[\], \[\], "content-save"\)/,
  "successful comment application adopts server-returned content and marks it clean",
);
assert.match(
  viewer,
  /onArtifactUpdatedRef\.current\?\.\(reconciliation\.reportedArtifact, synchronizedArtifacts\)/,
  "successful comment application reports the server-authoritative artifact",
);
assert.doesNotMatch(
  viewer,
  /art-\$\{crypto\.randomUUID\(\)\}[\s\S]{0,1000}?Apply comments/,
  "comment application never mints a new artifact",
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
// the empty state), expanding in-place into the describe-first composer.
const addTile = readFileSync(new URL("./canvas-add-tile.tsx", import.meta.url), "utf8");

assert.match(
  view,
  /<CanvasAddTile[\s\S]{0,300}?hero=\{galleryArtifacts\.length === 0\}[\s\S]{0,300}?onArtifactsChanged=\{handleSaved\}/,
  "ONE stable tile mount leads the grid — hero-styled when empty, so crossing zero never remounts the composer",
);
assert.doesNotMatch(view, /<CanvasAddTile hero familiarId/, "no second, remount-prone hero mount remains");
assert.doesNotMatch(view, /No saved sketches yet/, "the old leave-for-chat empty state is gone");
assert.match(view, /chat-canvas-card--new/, "a kept sketch settles in with a one-shot highlight");

assert.match(addTile, /aria-expanded=\{false\}/, "the ghost tile reports its expansion state");
assert.match(addTile, /generateArtifactCode\(\{/, "describe streams through the existing chat bridge");
assert.match(addTile, /What would you like to create\?/, "default path asks for intent, not an implementation mode");
assert.match(addTile, /Create preview/, "primary action creates a preview");
assert.match(addTile, /buildSketchPrompt\(state\.prompt\)/, "prompts are wrapped with the shared sketch contract");
assert.match(addTile, /buildRefinePrompt\(state\.result\.code, ask, state\.result\.kind\)/, "refine reuses the shared refine contract");
assert.match(addTile, /buildArtifactRepairPrompt/, "format recovery uses the bounded repair prompt");
assert.match(addTile, /sessionId: result\.sessionId/, "repair resumes the same hidden Canvas session");
assert.match(addTile, /abortRef\.current\?\.abort\(\)/, "collapse/unmount aborts an in-flight generation");
assert.match(addTile, /sandbox="allow-scripts"/, "the in-tile preview keeps the opaque-origin sandbox");
assert.doesNotMatch(addTile, /allow-same-origin/, "preview remains opaque-origin");
assert.match(addTile, /detectPastedKind\(state\.pastedCode\)/, "pasted code kind is detected, not asked");
assert.match(addTile, /useAnnouncer/, "completion and saves are announced to AT");
assert.match(addTile, /aria-haspopup="menu"/, "Start from code is an accessible secondary menu");
assert.match(addTile, /Blank HTML/, "explicit blank HTML remains available");
assert.match(addTile, /Blank React component/, "explicit blank React remains available");
assert.doesNotMatch(addTile, /const MODES/, "equal-weight implementation mode switcher is removed");
assert.match(
  addTile,
  /method: "POST",[\s\S]{0,200}?body: JSON\.stringify\(\{ artifact \}\)/,
  "autosave posts one artifact to the existing canvas store route",
);
assert.doesNotMatch(addTile, />\s*Keep\s*</, "generated previews no longer require an ambiguous Keep action");
assert.match(view, /artifact\.id !== activeComposerId/, "the active autosaved artifact is hidden from gallery cards to prevent duplicates");

console.log("chat canvas tab wiring: ok");
