// @ts-nocheck
// Chat → Canvas tab: the saved-sketch gallery. "Save to Canvas" in the inline
// artifact viewer persists to /api/canvas, but after the standalone Canvas
// page retired those saves had no surface. The tab closes the loop: the chat
// scope tabs gain Canvas, backed by ChatCanvasView (fetch, toolbar search +
// kind filter, sandboxed thumbnails, preview modal → CanvasEditor, delete).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as canvasGallery from "../lib/canvas-gallery.ts";

const { formatArtifactWhen, mergeCanvasArtifactSnapshot, sortArtifactsForGallery } = canvasGallery;

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
  /\{ id: "projects", label: "Projects" \},\s*\{ id: "canvas", label: "Canvas" \},\s*\{ id: "familiar", label: "Skills" \}/,
  "Canvas is a first-class scope tab between Projects and Skills (familiar scope)",
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

{
  const existing = {
    id: "existing",
    title: "Existing",
    prompt: "",
    code: "new",
    kind: "html" as const,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
  };
  const generated = {
    ...existing,
    id: "generated",
    title: "Generated",
    createdAt: "2026-07-20T12:01:00.000Z",
    updatedAt: "2026-07-20T12:01:00.000Z",
  };
  const staleAnnotationSnapshot = [{ ...existing, code: "old", updatedAt: "2026-07-20T11:00:00.000Z" }];
  assert.deepEqual(
    mergeCanvasArtifactSnapshot([existing, generated], staleAnnotationSnapshot, {
      kind: "upsert",
      changedId: existing.id,
    }),
    [existing, generated],
    "an annotation response arriving after generation cannot regress or drop gallery artifacts",
  );
  const newerAnnotations = {
    ...existing,
    annotations: [{
      id: "annotation-new",
      target: { selector: "main", label: "Main", excerpt: "<main>" },
      note: "new",
      createdAt: existing.updatedAt,
      updatedAt: existing.updatedAt,
    }],
  };
  const staleEqualRevision = {
    ...existing,
    annotations: [{
      id: "annotation-old",
      target: { selector: "main", label: "Main", excerpt: "<main>" },
      note: "old",
      createdAt: existing.updatedAt,
      updatedAt: existing.updatedAt,
    }],
  };
  assert.deepEqual(
    mergeCanvasArtifactSnapshot([newerAnnotations, generated], [staleEqualRevision, generated], {
      kind: "upsert",
      changedId: generated.id,
    }),
    [newerAnnotations, generated],
    "equal-revision collateral data cannot regress another artifact's annotations",
  );
  assert.deepEqual(
    mergeCanvasArtifactSnapshot([staleEqualRevision, generated], [newerAnnotations, generated], {
      kind: "upsert",
      changedId: existing.id,
    }),
    [newerAnnotations, generated],
    "equal-revision data remains authoritative for the artifact the mutation changed",
  );
  const afterDelete = mergeCanvasArtifactSnapshot([existing, generated], [existing], {
      kind: "delete",
      deletedId: generated.id,
    });
  assert.deepEqual(
    afterDelete,
    [existing],
    "an explicit deletion response removes its artifact",
  );
  assert.deepEqual(
    mergeCanvasArtifactSnapshot(afterDelete, [existing, generated], {
      kind: "upsert",
      changedId: existing.id,
      deletedIds: new Set([generated.id]),
    }),
    [existing],
    "an older annotation response cannot resurrect an explicitly deleted artifact",
  );
}
assert.match(
  view,
  /sandbox="allow-scripts"/,
  "thumbnails render in an opaque-origin sandbox without popups/modals",
);

// ── Preview modal → editor hand-off ─────────────────────────────────────────
// Clicking a card opens a non-interactive preview dialog, not the editor.
assert.match(view, /onClick=\{\(\) => setPreviewId\(artifact\.id\)\}/, "card click opens the preview modal");
assert.match(
  view,
  /className="chat-canvas-preview"[\s\S]{0,200}?role="dialog"[\s\S]{0,120}?aria-modal="true"/,
  "the preview is an accessible modal dialog",
);
assert.match(
  view,
  /useFocusTrap\(preview !== null, previewDialogRef/,
  "the preview dialog traps focus and closes on Escape per app convention",
);
assert.match(
  view,
  /className="chat-canvas-preview-backdrop"[\s\S]{0,120}?onClick=\{\(\) => setPreviewId\(null\)\}/,
  "backdrop click dismisses the preview",
);
assert.match(
  view,
  /onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  "clicks inside the dialog never fall through to the backdrop dismiss",
);
assert.match(
  view,
  /chat-canvas-preview__frame"[\s\S]{0,200}?sandbox="allow-scripts"/,
  "the live preview keeps the opaque-origin sandbox",
);
assert.match(
  view,
  /setEditorId\(preview\.id\);\s*setPreviewId\(null\);/,
  "Open in editor closes the preview and enters the editor",
);
assert.match(view, /chat-canvas-card--selected/, "the previewed card gets the selected treatment");
// The editor is a full-surface takeover with the agreed prop contract.
assert.match(
  view,
  /<CanvasEditor\s+artifact=\{editing\}\s+familiarId=\{familiarId\}\s+onClose=\{\(\) => setEditorId\(null\)\}\s+onArtifactUpdated=\{handleArtifactUpdated\}/,
  "the editor takeover receives the artifact, familiar, close, and update contract",
);
assert.doesNotMatch(view, /<ChatArtifactViewer/, "the old viewer-in-Modal path is fully replaced");
assert.match(
  view,
  /onArtifactUpdated=\{handleArtifactUpdated\}/,
  "same-artifact updates flow back into the sorted gallery",
);
assert.match(
  view,
  /setArtifacts\(\(current\) => sortArtifactsForGallery\([\s\S]{0,120}?mergeCanvasArtifactSnapshot\(current, next, sequencedMutation\)/,
  "artifact update callbacks preserve gallery ordering",
);
assert.doesNotMatch(
  view,
  /handleArtifactUpdated[\s\S]{0,200}?set(?:PreviewId|EditorId)/,
  "background artifact updates never reopen or replace the active preview/editor",
);
assert.match(
  view,
  /const artifactVersionRef = useRef\(0\);\s*const loadRequestTokenRef = useRef\(0\)/,
  "gallery tracks accepted artifact mutations separately from GET request order",
);
assert.match(
  view,
  /const acceptArtifacts = useCallback\([\s\S]{0,400}?artifactVersionRef\.current \+= 1;[\s\S]{0,600}?mergeCanvasArtifactSnapshot/,
  "every accepted server mutation advances the artifact version before merging gallery state",
);
assert.match(
  view,
  /const requestToken = \+\+loadRequestTokenRef\.current;\s*const startedArtifactVersion = artifactVersionRef\.current;[\s\S]{0,500}?isCanvasGalleryLoadCurrent\([\s\S]{0,200}?artifactVersionRef\.current,[\s\S]{0,100}?loadRequestTokenRef\.current[\s\S]{0,120}?\) return;[\s\S]{0,150}?setArtifacts/,
  "GET responses apply only when both their artifact version and latest-request token are current",
);
assert.match(
  view,
  /if \(\(err as Error\)\?\.name === "AbortError"\) return;[\s\S]{0,250}?isCanvasGalleryLoadCurrent/,
  "aborts remain quiet and stale GET failures cannot replace newer local state with an error",
);
assert.match(
  view,
  /handleSaved[\s\S]{0,220}?acceptArtifacts\(next, \{ kind: "upsert", changedId: savedId \}\)[\s\S]{0,300}?handleArtifactUpdated[\s\S]{0,220}?acceptArtifacts\(next, \{ kind: "upsert", changedId: updated\.id \}\)/,
  "terminal generation adoption and viewer mutations invalidate older GET loads",
);
assert.match(
  view,
  /method: "DELETE"[\s\S]{0,400}?acceptArtifacts\(data\.artifacts \?\? \[\], \{ kind: "delete", deletedId: artifact\.id \}\)/,
  "accepted deletes invalidate older GET loads",
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
assert.match(
  css,
  /\.chat-canvas-preview__frame[\s\S]{0,200}?pointer-events: none/,
  "the preview-modal sketch renders live but never captures pointer input",
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
assert.equal(
  typeof canvasGallery.isCanvasGalleryLoadCurrent,
  "function",
  "gallery exposes the request/version freshness guard used by GET loads",
);

const isLoadCurrent = canvasGallery.isCanvasGalleryLoadCurrent!;
let artifactVersion = 0;
let latestRequestToken = 1;
let visibleArtifactIds = ["initial"];
const staleLoad = { artifactVersion, requestToken: latestRequestToken };
artifactVersion += 1;
visibleArtifactIds = ["terminal-adoption"];
if (isLoadCurrent(staleLoad.artifactVersion, staleLoad.requestToken, artifactVersion, latestRequestToken)) {
  visibleArtifactIds = ["stale-get"];
}
assert.deepEqual(
  visibleArtifactIds,
  ["terminal-adoption"],
  "a GET started before terminal adoption cannot replace the committed artifact",
);

const retryLoad = { artifactVersion, requestToken: ++latestRequestToken };
if (isLoadCurrent(retryLoad.artifactVersion, retryLoad.requestToken, artifactVersion, latestRequestToken)) {
  visibleArtifactIds = ["retry-result"];
}
assert.deepEqual(visibleArtifactIds, ["retry-result"], "a retry begun at the current artifact version still applies");

const supersededLoad = { artifactVersion, requestToken: ++latestRequestToken };
const latestLoad = { artifactVersion, requestToken: ++latestRequestToken };
assert.equal(
  isLoadCurrent(supersededLoad.artifactVersion, supersededLoad.requestToken, artifactVersion, latestRequestToken),
  false,
  "an older overlapping GET cannot apply after a newer request begins",
);
assert.equal(
  isLoadCurrent(latestLoad.artifactVersion, latestLoad.requestToken, artifactVersion, latestRequestToken),
  true,
  "the latest overlapping GET can apply when artifacts have not changed",
);

// ── Add tile (cave-fema): in-grid sketch creation ────────────────────────────
// The gallery owns its add affordance: a ghost tile leads the grid (and IS
// the empty state), expanding in-place into the describe-first composer.
const addTile = readFileSync(new URL("./canvas-add-tile.tsx", import.meta.url), "utf8");
const generationRegistry = readFileSync(new URL("../lib/canvas-generation-registry.ts", import.meta.url), "utf8");

assert.match(
  view,
  /<CanvasAddTile[\s\S]{0,300}?hero=\{galleryArtifacts\.length === 0\}[\s\S]{0,300}?onArtifactsChanged=\{handleSaved\}/,
  "ONE stable tile mount leads the grid — hero-styled when empty, so crossing zero never remounts the composer",
);
assert.doesNotMatch(view, /<CanvasAddTile hero familiarId/, "no second, remount-prone hero mount remains");
assert.doesNotMatch(view, /No saved sketches yet/, "the old leave-for-chat empty state is gone");
assert.match(view, /chat-canvas-card--new/, "a kept sketch settles in with a one-shot highlight");

// ── Toolbar: search · kind filter · count · New sketch ──────────────────────
assert.match(view, /placeholder="Search sketches…"/, "toolbar search uses the canonical placeholder grammar");
assert.match(
  view,
  /filterCanvasArtifacts\(galleryArtifacts, q, kindFilter\)/,
  "the grid renders through the pure search+filter helper",
);
assert.match(
  view,
  /aria-pressed=\{kindFilter === f\.id\}/,
  "segmented filter buttons expose their pressed state",
);
assert.match(
  view,
  /\{filteredArtifacts\.length\} of \{galleryArtifacts\.length\} sketches/,
  "the count line reports shown-of-total",
);
const addTileMount = view.indexOf("<CanvasAddTile");
const filteredMap = view.indexOf("filteredArtifacts.map");
assert.ok(
  addTileMount >= 0 && filteredMap > addTileMount,
  "the add tile always leads the grid regardless of the active filter",
);
assert.match(
  view,
  /setAddExpandRequest\(\(n\) => n \+ 1\)/,
  "the toolbar New sketch button expands the add tile via the counter prop",
);
assert.match(
  view,
  /No sketches match &ldquo;\{trimmedQuery\}&rdquo;/,
  "a filtered-empty gallery names the query instead of looking empty",
);

assert.match(addTile, /aria-expanded=\{false\}/, "the ghost tile reports its expansion state");
assert.match(addTile, /expandRequest\?: number/, "the tile accepts the toolbar's expand-request counter");
assert.match(
  addTile,
  /if \(state\.phase === "collapsed" && !generationVisible\) \{\s*dispatch\(\{ type: "expand" \}\);/,
  "a new expand request opens the collapsed composer via the same action as the ghost click",
);
assert.match(addTile, /startCanvasGeneration\(\{/, "describe starts the navigation-safe Canvas generation owner");
assert.match(addTile, /What would you like to create\?/, "default path asks for intent, not an implementation mode");
assert.match(addTile, /Create preview/, "primary action creates a preview");
assert.match(addTile, /buildSketchPrompt\(state\.prompt\)/, "prompts are wrapped with the shared sketch contract");
assert.match(addTile, /buildRefinePrompt\(state\.result\.code, ask, state\.result\.kind\)/, "refine reuses the shared refine contract");
assert.match(generationRegistry, /buildArtifactRepairPrompt/, "format recovery uses the bounded repair prompt");
assert.match(generationRegistry, /sessionId: result\.sessionId/, "repair resumes the same hidden Canvas session");
assert.match(addTile, /useSyncExternalStore\(/, "the tile adopts module-scope generation progress after remount");
assert.doesNotMatch(
  addTile,
  /return\s*\(\)\s*=>\s*\{[\s\S]{0,160}?abort\(/,
  "component cleanup never aborts Canvas generation",
);
assert.doesNotMatch(
  addTile,
  /const collapse[\s\S]{0,220}?abort\(/,
  "collapse only hides the tile and never cancels generation",
);
assert.match(
  addTile,
  /const stop = useCallback\([\s\S]{0,220}?stopCanvasGeneration\(generation\.runId\)/,
  "the dedicated Stop handler is the explicit cancellation path",
);
assert.match(
  addTile,
  /if \(event\.key === "Escape" && !codeMenuOpen\) \{[\s\S]{0,120}?collapse\(\);/,
  "Escape collapses the tile even while generation is active",
);
assert.doesNotMatch(
  addTile,
  /if \(event\.key === "Escape" && !codeMenuOpen\) \{[\s\S]{0,160}?(?:stopCanvasGeneration|stop\(\)|cancel\(\))/,
  "Escape never reaches the registry cancellation path",
);
assert.match(
  addTile,
  /const canStopGeneration = generation\.phase === "generating" \|\| generation\.phase === "repairing"/,
  "only generating and repairing phases expose cancellation",
);
assert.match(
  addTile,
  /\{canStopGeneration \? \([\s\S]{0,500}?onClick=\{stop\}>Stop<\/button>[\s\S]{0,100}?\) : null\}/,
  "saving presents its status without an enabled Stop action",
);
const terminalAdoption = addTile.indexOf("onArtifactsChanged([...generation.artifacts], generation.savedId)");
const terminalConsume = addTile.indexOf("consumeCanvasGeneration(generation.runId)", terminalAdoption);
assert.ok(
  terminalAdoption >= 0 && terminalConsume > terminalAdoption,
  "a later mount adopts terminal server artifacts before consuming the run",
);
assert.match(addTile, /sandbox="allow-scripts"/, "the in-tile preview keeps the opaque-origin sandbox");
assert.doesNotMatch(addTile, /allow-same-origin/, "preview remains opaque-origin");
assert.match(addTile, /detectPastedKind\(state\.pastedCode\)/, "pasted code kind is detected, not asked");
assert.match(addTile, /useAnnouncer/, "completion and saves are announced to AT");
assert.match(addTile, /aria-haspopup="menu"/, "Start from code is an accessible secondary menu");
assert.match(addTile, /Blank HTML/, "explicit blank HTML remains available");
assert.match(addTile, /Blank React component/, "explicit blank React remains available");
assert.doesNotMatch(addTile, /const MODES/, "equal-weight implementation mode switcher is removed");
assert.match(
  generationRegistry,
  /method: "POST",[\s\S]{0,400}?body: JSON\.stringify\(\{[\s\S]{0,120}?artifact,[\s\S]{0,120}?expectedUpdatedAt[\s\S]{0,120}?expectedAbsent/,
  "the registry-owned executor autosaves to the existing canvas store route",
);
assert.match(
  generationRegistry,
  /expectedAbsent: input\.expectedAbsent \?\? input\.purpose === "create"/,
  "new artifact saves retain an expected-absent precondition across retries",
);
assert.match(
  addTile,
  /purpose: "refine"[\s\S]{0,300}?expectedUpdatedAt: state\.persistedUpdatedAt/,
  "background refinements carry the last server-confirmed artifact revision",
);
assert.match(addTile, /retryCanvasGenerationSave/, "ambiguous saves expose a save-only retry path");
assert.match(
  generationRegistry,
  /const savedArtifact = data\.artifact[\s\S]{0,120}?data\.artifacts\?\.find\(\(entry\) => entry\.id === savedId\)/,
  "terminal replay carries the server-settled artifact when dedupe adopts another id",
);
assert.match(
  generationRegistry,
  /if \(!savedId \|\| !savedArtifact \|\| !Array\.isArray\(data\.artifacts\)\) \{[\s\S]{0,200}?CanvasGenerationSaveError/,
  "an incomplete response remains an explicit ambiguous save instead of claiming success",
);
assert.doesNotMatch(addTile, />\s*Keep\s*</, "generated previews no longer require an ambiguous Keep action");
assert.match(view, /artifact\.id !== activeComposerId/, "the active autosaved artifact is hidden from gallery cards to prevent duplicates");

console.log("chat canvas tab wiring: ok");
