// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("./workflow-studio.tsx", import.meta.url), "utf8");
const library = readFileSync(new URL("./workflow-library.tsx", import.meta.url), "utf8");
const canvas = readFileSync(new URL("./workflow-canvas.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("./workflow-inspector.tsx", import.meta.url), "utf8");
const attachments = readFileSync(new URL("./workflow-attachments.tsx", import.meta.url), "utf8");
const runStrip = readFileSync(new URL("./workflow-run-strip.tsx", import.meta.url), "utf8");
const manifestPreview = readFileSync(new URL("./workflow-manifest-preview.tsx", import.meta.url), "utf8");
const palette = readFileSync(new URL("./workflow-palette.tsx", import.meta.url), "utf8");
const runsPanel = readFileSync(new URL("./workflow-runs-panel.tsx", import.meta.url), "utf8");
const dialogs = readFileSync(new URL("./workflow-create-dialog.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/workflows.css", import.meta.url), "utf8");

assert.match(studio, /export (type )?WorkflowStudioActionState/, "WorkflowStudio action state should be exported");
assert.match(studio, /export (type )?WorkflowStudioProps/, "WorkflowStudio props should be exported");
assert.match(studio, /export function WorkflowStudio/, "WorkflowStudio should be exported");
assert.match(studio, /WorkflowLibrary/, "WorkflowStudio should include WorkflowLibrary");
assert.match(studio, /WorkflowCanvas/, "WorkflowStudio should include WorkflowCanvas");
assert.match(studio, /WorkflowInspector/, "WorkflowStudio should include WorkflowInspector");
assert.match(studio, /WorkflowAttachments/, "WorkflowStudio should include WorkflowAttachments");
assert.match(studio, /WorkflowRunStrip/, "WorkflowStudio should include WorkflowRunStrip");
assert.match(studio, /WorkflowManifestPreview/, "WorkflowStudio should include WorkflowManifestPreview");

assert.match(canvas, /@xyflow\/react/, "WorkflowCanvas should use React Flow");
assert.match(canvas, /nodeTypes\s*=/, "WorkflowCanvas should define nodeTypes");
assert.match(canvas, /workflowStep:\s*WorkflowStepNode/, "WorkflowCanvas should register WorkflowStepNode");
assert.match(canvas, /workflowToGraph/, "WorkflowCanvas should adapt workflow manifests into graph nodes");

assert.match(library, /validation_state/, "WorkflowLibrary should show validation health");
assert.match(inspector, /Selected node/, "WorkflowInspector should include selected-node details");
assert.match(inspector, /Workflow/, "WorkflowInspector should include workflow details");
assert.match(inspector, /Permissions/, "WorkflowInspector should include permissions");
assert.match(inspector, /Validation/, "WorkflowInspector should include validation state");

for (const label of ["Familiars", "Roles", "Boards", "Projects"]) {
  assert.match(attachments, new RegExp(label), `WorkflowAttachments should include ${label}`);
}

for (const label of ["Validate", "Dry-run", "Play"]) {
  assert.match(runStrip, new RegExp(label), `WorkflowRunStrip should include ${label}`);
}
assert.match(runStrip, /workflowIssueSummary/, "WorkflowRunStrip should summarize validator and dry-run issues");
assert.match(runStrip, /Daemon offline/, "WorkflowRunStrip should guard Play with an honest offline hint");
assert.match(
  runStrip,
  /<p[^>]*>[\s\S]*Daemon offline/,
  "WorkflowRunStrip should show a visible offline-run hint",
);

assert.match(
  attachments,
  /Persistence pending daemon API/,
  "WorkflowAttachments should make attachment saves visibly non-destructive",
);

assert.match(
  manifestPreview,
  /schema_version|WORKFLOW\.md|\.workflow\.yaml/,
  "WorkflowManifestPreview should preview canonical workflow manifest fields",
);
assert.match(
  manifestPreview,
  /Cave-only layout stays in WORKFLOW\.cave\.json/,
  "WorkflowManifestPreview should keep the sidecar boundary visible",
);
assert.match(
  css,
  /\.workflow-studio-side-content > \[role="tabpanel"\]\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/,
  "Workflow detail tab panels should fill the side panel instead of shrinking around their contents",
);
assert.match(
  css,
  /\.workflow-studio-side-content \.workflow-panel\s*\{[\s\S]*flex:\s*1 1 auto;/,
  "Each detail section card should grow to fill the column height (full-height side surface, like the left library) — not float as a short card above empty space",
);
assert.match(
  css,
  /\.workflow-manifest-preview\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/,
  "Workflow manifest preview should use a vertical flex layout",
);
assert.match(
  css,
  /\.workflow-manifest-preview \.workflow-manifest-yaml\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*max-height:\s*none;/,
  "Workflow manifest YAML should expand like an editor surface inside the side panel",
);
assert.match(css, /\.workflow-studio-shell/, "workflow CSS should style the studio shell");
assert.match(css, /\.workflow-studio-shell \{[\s\S]{0,700}padding:\s*16px 16px 16px 0/, "Studio shell drops left padding so the library hugs the app nav (no blank band)");
{
  // The collapsed left library rail keeps its hairline divider but drops the
  // background fill so the toggle blends with the canvas.
  const collapsedLeft = css.match(/\.workflow-studio-shell\.is-left-collapsed > \.workflow-studio-library-panel \{[\s\S]*?\}/);
  assert.ok(collapsedLeft, "Collapsed left library rail rule should exist");
  assert.ok(/border-right/.test(collapsedLeft[0]), "Collapsed left rail keeps its hairline divider");
  assert.ok(!/background/.test(collapsedLeft[0]), "Collapsed left rail should have no background fill");
}
assert.match(css, /@media \(max-width: 860px\)/, "workflow CSS should include mobile studio layout");
assert.doesNotMatch(
  css,
  /\.workflow-canvas \.react-flow \{[\s\S]{0,300}zoom:\s*calc\(1 \/ var\(--cave-screen-scale\)\)/,
  "Workflow canvas must NOT counter-zoom — screen magnification is rem-based (no app-wide CSS zoom), so a 1/scale counter-zoom here would shrink the canvas and re-detach edge arrows (the #482 bug)",
);

// --- Studio v2: visual builder, runs, assignments ---

assert.match(studio, /WorkflowPalette/, "Studio should include the step palette");
assert.match(studio, /WorkflowRunsPanel/, "Studio should include the runs panel");
assert.match(studio, /WorkflowCreateDialog/, "Studio should wire the create dialog");
assert.match(studio, /WorkflowScheduleDialog/, "Studio should wire the schedule dialog");
assert.match(studio, /type WorkflowRunPreviewMode/, "Run preview layout modes should be typed");
assert.match(studio, /runPreviewMode,\s*setRunPreviewMode[\s\S]{0,80}useState<WorkflowRunPreviewMode>\("compact"\)/, "Run preview should default to compact bottom mode");
assert.match(studio, /--workflow-runs-height/, "Run preview should expose a CSS height variable for drag resizing");
assert.match(studio, /--workflow-runs-side-width/, "Run preview should expose a CSS side width variable for split resizing");
assert.match(studio, /startRunPreviewResize/, "Run preview should expose a drag resize handler");
assert.match(studio, /setRunPreviewMode\("custom"\)/, "Dragging the bottom run preview should switch to a custom height");
assert.match(studio, /WORKFLOW_RUN_PREVIEW_PRESETS[\s\S]{0,500}50%[\s\S]{0,500}Full[\s\S]{0,500}Side by side/, "Run preview presets should offer half, full, and side-by-side modes");
assert.match(studio, /workflow-run-preview-toolbar/, "Run preview should render a mode toolbar");
assert.match(studio, /aria-label="Drag to resize run preview"/, "Run preview resize handle should be accessible");
assert.match(studio, /onUndo[\s\S]*onRedo/, "Studio should thread undo/redo");
assert.match(studio, /leftPanelOpen,\s*setLeftPanelOpen[\s\S]{0,80}useState\(true\)/, "Studio should keep the workflow library panel open by default");
assert.match(studio, /rightPanelOpen,\s*setRightPanelOpen[\s\S]{0,80}useState\(true\)/, "Studio should keep the workflow details panel open by default");
assert.match(studio, /type WorkflowSidePanelSection/, "Workflow right panel should model distinct selectable sections");
assert.match(studio, /sidePanelSection,\s*setSidePanelSection[\s\S]{0,100}useState<WorkflowSidePanelSection>\("inspector"\)/, "Workflow right panel should default to the inspector section");
assert.match(studio, /<Tabs<WorkflowSidePanelSection>[\s\S]{0,160}ariaLabel="Workflow detail sections"/, "Workflow right panel should expose section tabs (shared Vercel-style Tabs) instead of using selection as a close action");
assert.match(studio, /<Tabs<WorkflowSidePanelSection>[\s\S]{0,180}size="sm"/, "Workflow right panel tabs should use compact density so Manifest fits in the sidepanel");
assert.doesNotMatch(studio, /<Tabs<WorkflowSidePanelSection>[\s\S]{0,220}\n\s*fill\n/, "Workflow right panel tabs should not use equal-width fill tabs in the narrow sidepanel");
assert.match(studio, /setSidePanelSection\(id\);[\s\S]{0,80}if \(!rightPanelOpen\) setRightPanelOpen\(true\);/, "Selecting a workflow side-panel tab should open or keep the panel open");
assert.match(studio, /sidePanelSection === "inspector"[\s\S]{0,400}<WorkflowInspector/, "Workflow inspector should render only in the inspector tab panel");
assert.match(studio, /sidePanelSection === "attachments"[\s\S]{0,500}<WorkflowAttachments/, "Workflow attachments should render only in the attachments tab panel");
assert.match(studio, /sidePanelSection === "manifest"[\s\S]{0,300}<WorkflowManifestPreview/, "Workflow manifest should render only in the manifest tab panel");
assert.match(studio, /aria-label=\{leftPanelOpen \? "Hide workflow library" : "Show workflow library"\}/, "Studio should expose an accessible left-panel toggle");
assert.match(studio, /aria-label=\{rightPanelOpen \? "Hide workflow details" : "Show workflow details"\}/, "Studio should expose an accessible right-panel toggle");
assert.match(studio, /workflow-studio-library-panel[\s\S]{0,500}workflow-panel-tab workflow-panel-tab-left[\s\S]{0,700}<WorkflowLibrary/, "Left workflow panel toggle should live at the panel top edge");
assert.match(studio, /workflow-side-panel-header[\s\S]{0,400}workflow-panel-collapse-button workflow-panel-tab-right[\s\S]{0,720}workflow-side-panel-tabs/, "Right workflow panel header should put the collapse toggle leftmost (mirroring the left panel), then the section tabs");
assert.match(studio, /workflow-panel-collapse-button workflow-panel-tab-right/, "Right workflow panel collapse should stay separate from section selection");
assert.match(studio, /leftPanelOpen \? "ph:sidebar-simple-fill" : "ph:sidebar-simple"/, "Left workflow panel toggle should use the sidebar tab icon");
assert.match(studio, /rightPanelOpen \? "ph:sidebar-simple-fill" : "ph:sidebar-simple"/, "Right workflow panel toggle should use the sidebar tab icon");
assert.match(studio, /is-left-collapsed[\s\S]{0,160}is-right-collapsed/, "Studio should put collapsed panel state on the shell");
assert.match(css, /\.workflow-panel-tab/, "Workflow CSS should style sidebar-like side-panel tab toggles");
assert.match(css, /--workflow-top-control-height:\s*34px/, "Workflow top controls should share a standardized height");
assert.match(css, /--workflow-top-control-offset:\s*8px/, "Workflow top controls should share a standardized y offset (8px matches the palette's vertical padding)");
assert.match(css, /\.workflow-panel-tab[\s\S]{0,320}width:\s*100%[\s\S]{0,160}height:\s*var\(--workflow-top-control-height\)[\s\S]{0,120}margin-top:\s*0[\s\S]{0,80}margin-bottom:\s*6px/, "Workflow panel tabs should span the full panel width, share the control height, and sit flush at the top (no offset) so the panel header pulls content up");
assert.match(css, /\.workflow-side-panel-header/, "Workflow right side panel should style its tab row separately from the collapse control");
// The section tabs now use the shared Vercel-style <Tabs> (active state is the
// 2px underline rendered by components/ui/tabs.tsx), so the bespoke
// `.workflow-side-panel-tab[aria-selected]` box rule no longer exists. The
// tablist container class is still styled here for layout.
assert.match(css, /\.workflow-side-panel-tabs\s*\{/, "Workflow right side panel tablist should keep its layout styles");
assert.match(css, /\.workflow-side-panel-tabs\s*\{[\s\S]{0,120}flex:\s*0 1 auto/, "Workflow right side panel tabs should size to their labels, not spread into wide gutters");
assert.match(css, /\.workflow-side-panel-tabs\s*\{[\s\S]{0,180}max-width:\s*calc\(100% - var\(--workflow-top-control-height\) - 4px\)/, "Workflow tabs reserve room for the collapse button without clipping Manifest");
assert.match(css, /\.workflow-side-panel-header\s*\{[\s\S]{0,140}gap:\s*4px[\s\S]{0,120}margin:\s*0 0 4px/, "Workflow sidepanel header should keep tight spacing between tabs, toggle, and content");
assert.match(css, /\.workflow-studio-library-panel,[\s\S]{0,140}flex-direction:\s*column/, "Workflow panel content should sit below the full-width trigger row");
const paletteItemRule = css.match(/\.workflow-palette-item\s*\{[\s\S]*?\}/)?.[0] ?? "";
assert.match(paletteItemRule, /min-height:\s*var\(--workflow-top-control-height\)/, "Workflow palette buttons should use the same height as the side-panel triggers");
assert.match(paletteItemRule, /height:\s*var\(--workflow-top-control-height\)/, "Workflow palette toggle tabs should use a fixed shared height so their top and bottom edges align");
assert.match(paletteItemRule, /box-sizing:\s*border-box/, "Workflow palette toggle tabs should include tone borders in the fixed control box");
assert.match(paletteItemRule, /justify-content:\s*center/, "Workflow palette toggle tab content should be centered inside the shared box");
assert.match(paletteItemRule, /line-height:\s*1/, "Workflow palette toggle tab text should not add vertical baseline slack");
assert.match(css, /\.workflow-palette-item svg\s*\{[\s\S]{0,120}display:\s*block/, "Workflow palette toggle icons should not participate in text baseline alignment");
assert.match(css, /is-left-collapsed[\s\S]{0,120}grid-template-columns:\s*36px/, "Collapsed left workflow panel should keep a visible toggle rail");
assert.match(css, /is-right-collapsed[\s\S]{0,160}36px;/, "Collapsed right workflow panel should keep a visible toggle rail");
assert.match(studio, /<span className="workflow-panel-tab__title">/, "Panel tabs render a header title");
assert.match(css, /\.workflow-panel-tab\b[\s\S]{0,200}justify-content:\s*space-between/, "Panel tab header lays title and toggle across the row");
assert.match(css, /is-left-collapsed \.workflow-panel-tab-left \.workflow-panel-tab__title,[\s\S]{0,140}display:\s*none/, "Collapsed panel hides the header title, leaving only the toggle icon");
assert.match(css, /\.workflow-studio-shell\.is-left-collapsed/, "Workflow CSS should collapse the left workflow panel");
assert.match(css, /\.workflow-studio-shell\.is-right-collapsed/, "Workflow CSS should collapse the right workflow panel");

for (const kind of ["agent", "skill", "tool", "human-gate", "workflow"]) {
  assert.match(palette, new RegExp(`"${kind}"`), `Palette should offer the ${kind} step kind`);
}

assert.match(canvas, /onConnect/, "Canvas should support drawing dependency edges");
assert.match(canvas, /onEdgesDelete/, "Canvas should support deleting dependency edges");
assert.match(canvas, /onNodesDelete/, "Canvas should support deleting step nodes");
assert.match(canvas, /deleteKeyCode/, "Canvas should map delete keys for edit operations");
assert.match(canvas, /showMiniMap,\s*setShowMiniMap[\s\S]{0,80}useState\(false\)/, "Canvas minimap should default hidden");
assert.match(canvas, /aria-label=\{showMiniMap \? "Hide workflow minimap" : "Show workflow minimap"\}/, "Canvas should expose an accessible minimap toggle");
assert.match(canvas, /\{showMiniMap && \([\s\S]{0,700}<MiniMap/, "Canvas should only mount the minimap after the toggle is enabled");
assert.match(canvas, /nodeColor=\{workflowMiniMapNodeColor\}/, "Minimap should color live workflow nodes by workflow tone");
assert.match(canvas, /zoomable[\s\S]{0,120}pannable[\s\S]{0,120}position="bottom-right"/, "Minimap should be interactive and anchored inside the viewer");
assert.match(canvas, /initialWidth:\s*WORKFLOW_NODE_WIDTH[\s\S]{0,80}initialHeight:\s*WORKFLOW_NODE_HEIGHT/, "Flow nodes should expose dimensions so the minimap can draw the actual workflow");
assert.match(css, /\.workflow-minimap-toggle/, "Workflow CSS should style the minimap toggle");
assert.match(studio, /layoutDirection/, "Studio should accept the active workflow canvas layout direction");
assert.match(studio, /onResetView/, "Studio should thread reset-view actions into the canvas");
assert.match(studio, /onSwitchLayout/, "Studio should thread layout switching into the canvas");
assert.match(canvas, /aria-label="Reset workflow view"/, "Canvas should expose a reset-view control");
assert.match(canvas, /aria-label=\{layoutDirection === "horizontal" \? "Switch workflow layout to vertical" : "Switch workflow layout to horizontal"\}/, "Canvas should expose an accessible layout switch control");
assert.match(canvas, /layoutDirection === "vertical" \? Position\.Top : Position\.Left/, "Vertical layout should move target handles to the top edge");
assert.match(canvas, /layoutDirection === "vertical" \? Position\.Bottom : Position\.Right/, "Vertical layout should move source handles to the bottom edge");
assert.match(canvas, /key=\{flowKey\}/, "Canvas should remount React Flow when the view is reset so fitView reruns");
assert.match(css, /\.workflow-canvas-toolbar/, "Workflow CSS should style the canvas action toolbar");
assert.match(runStrip, /workflow-run-action-button/, "Workflow run strip text actions should expose a mobile hit-area hook");
assert.match(
  css,
  /@media \(max-width: 767px\) \{[\s\S]*\.workflow-studio-shell\s*\{[\s\S]*--workflow-top-control-height:\s*var\(--touch-target\)[\s\S]*\.workflow-panel-tab,[\s\S]*\.workflow-palette-item,[\s\S]*\.workflow-run-row,[\s\S]*\.workflow-run-action-button,[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Workflow mobile controls should meet the shared touch target",
);

// Draggable nodes: local node state + drag-stop persistence to the sidecar.
assert.match(canvas, /nodesDraggable/, "Canvas nodes must be draggable");
assert.match(canvas, /applyNodeChanges/, "Canvas applies node changes to local state so drags stick");
assert.match(canvas, /onNodeDragStop=\{handleNodeDragStop\}/, "Drag stop persists node positions");
assert.match(canvas, /savedPositions/, "Canvas seeds from saved sidecar positions");
assert.match(studio, /onSavePositions/, "Studio threads position persistence");

assert.match(inspector, /onUpdateStep/, "Inspector should edit step fields");
assert.match(inspector, /onUpdateMeta/, "Inspector should edit workflow metadata");
assert.match(inspector, /workflow-field/, "Inspector should render editable fields");
assert.match(inspector, /on_error/, "Inspector should expose on-error behavior");

assert.match(runStrip, /Save/, "Run strip should expose Save");
assert.match(runStrip, /floppy-disk/, "Save should use the floppy icon");
assert.match(runStrip, /Undo/, "Run strip should expose Undo");
assert.match(runStrip, /Redo/, "Run strip should expose Redo");
assert.match(runStrip, /onPlay/, "Run strip should probe the daemon run proxy");
assert.match(runStrip, /engineUnavailable/, "Play should stay guarded when the engine is unavailable");

assert.match(runsPanel, /WorkflowRunRecord/, "Runs panel should render run records");
assert.match(runsPanel, /dry-run snapshots and daemon executions/i, "Runs panel should explain its data sources");

// --- Studio v3: playback walkthrough + rich runs ---
const playback = readFileSync(new URL("../../lib/workflow-playback.ts", import.meta.url), "utf8");
assert.match(playback, /export function playbackFromPlan/, "Playback should seed from a dry-run plan");
assert.match(playback, /export function playbackFromRun/, "Playback should seed from a recorded run (replay)");
assert.match(playback, /never fabricates execution|preview/i, "Playback must stay honest about previews vs executions");

assert.match(studio, /playback=\{props\.playback\}/, "Studio should thread playback into the canvas");
assert.match(studio, /onStopPlayback=\{props\.onStopPlayback\}/, "Studio should thread the stop-playback control");
assert.match(studio, /onReplayRun=\{props\.onReplayRun\}/, "Studio should thread replay into the runs panel");

assert.match(canvas, /nodePhases/, "Canvas should overlay playback node phases");
assert.match(canvas, /workflow-node-phase-/, "Canvas nodes should carry a playback phase class");
assert.match(canvas, /workflow-edge-active/, "Canvas should highlight the edge feeding the active step");

assert.match(runStrip, /workflow-playback-transport/, "Run strip should show a playback transport");
assert.match(runStrip, /onStopPlayback/, "Run strip should expose a stop/clear control");
assert.match(runStrip, /preview · not a live execution/, "Run strip must label previews honestly");
// Operational Play: a live agent-session run reads as live and offers to open the session.
assert.match(runStrip, /executing in agent session/, "Run strip must label a live session run as executing");
assert.match(runStrip, /Open in Chat/, "A live session run should offer to open the session");
assert.match(runStrip, /onOpenSession\(activePlayback\.sessionId!\)/, "Open-in-Chat should invoke the open-session callback");
assert.match(studio, /onOpenSession=\{props\.onOpenSession\}/, "Studio should thread the open-session control into the run strip");
assert.match(runStrip, /playbackSummary/, "Run strip should show playback progress");

assert.match(runsPanel, /aria-expanded=\{expanded\}/, "Runs rows should be expandable");
assert.match(runsPanel, /workflow-run-steps/, "Expanded runs should show a per-step timeline");
assert.match(runsPanel, /onReplayRun\(run\)/, "Runs should offer replay-on-canvas");
assert.match(runsPanel, /runDuration/, "Expanded runs should show duration");
assert.match(runsPanel, /summarizeRuns/, "Runs heading should show summary stats");

assert.match(css, /\.workflow-node-phase-active/, "CSS should style the active playback node");
assert.match(css, /@keyframes workflow-node-pulse/, "CSS should animate the active node");
assert.match(css, /prefers-reduced-motion/, "Playback animation should respect reduced-motion");
assert.match(css, /\.workflow-playback-transport/, "CSS should style the playback transport");
assert.match(css, /\.workflow-run-replay/, "CSS should style the replay action");

assert.match(attachments, /onAttachRole/, "Attachments should persist role bindings");
assert.match(attachments, /onUpdateMeta/, "Attachments should bind familiars into the manifest");
assert.match(attachments, /onScheduleRequest/, "Attachments should open scheduling");
assert.match(attachments, /WorkflowFamiliarOption/, "Attachments should accept normalized familiar dropdown options");
assert.match(attachments, /<select[\s\S]{0,220}aria-label="Familiar binding"/, "Familiar attachment binding should render as a selection dropdown");
assert.doesNotMatch(attachments, /placeholder="Unassigned — saved into the manifest"[\s\S]{0,120}<input/, "Familiar attachment binding should no longer be free-text input");
assert.match(attachments, /<option value="">Unassigned — saved into the manifest<\/option>/, "Familiar dropdown should keep an unassigned choice");
assert.match(attachments, /familiarOptions\.map/, "Familiar dropdown should render discovered familiar options");
assert.match(attachments, /AttachmentSection/, "Attachments compose sections");
// Bind tab sections render flat — no per-section collapse framing, and the Bind
// content is not gated behind an outer disclosure caret (the tab already gates it).
assert.doesNotMatch(attachments, /aria-expanded=\{open\}/, "Attachment sections no longer collapse behind a caret");
assert.doesNotMatch(attachments, /workflow-attachment-toggle/, "Attachment section headers are not disclosure toggles");
assert.doesNotMatch(attachments, /workflow-section-caret-btn/, "Bind tab content is not behind an outer collapse caret");
assert.match(attachments, /workflow-attachment-title/, "Attachment section headers are plain titles");
assert.doesNotMatch(css, /\.workflow-attachment-row \{[^}]*border/, "Flat attachment sections drop the bordered framing");
assert.match(css, /\.workflow-attachment-body > \* \{\n  width: 100%;/, "Attachment bodies span the full row width");

// Inspect and Manifest tabs are flat too — content shows directly on tab-select,
// not behind an outer disclosure caret (the tabs already gate visibility).
assert.doesNotMatch(inspector, /workflow-section-caret-btn/, "Inspect tab content is not behind an outer collapse caret");
assert.doesNotMatch(inspector, /aria-expanded=\{open\}/, "Inspect tab does not gate content behind a disclosure");
assert.doesNotMatch(manifestPreview, /workflow-section-caret-btn/, "Manifest tab content is not behind an outer collapse caret");
assert.doesNotMatch(manifestPreview, /aria-expanded=\{open\}/, "Manifest tab does not gate content behind a disclosure");
// The caret control is fully retired across the workflow panels.
assert.doesNotMatch(css, /\.workflow-section-caret-btn/, "Dead caret-button CSS is removed");
assert.match(attachments, /workflow-role-emoji/, "Role rows reserve a fixed emoji slot so names align");
assert.match(css, /grid-template-columns: auto 20px minmax\(0, 1fr\) auto/, "Role rows align as checkbox/emoji/name/familiar columns");
assert.match(css, /scrollbar-width: thin/, "Studio scroll regions use thin themed scrollbars");

assert.match(dialogs, /WorkflowCreateDialog/, "Create dialog exists");
assert.match(dialogs, /WorkflowScheduleDialog/, "Schedule dialog exists");
assert.match(dialogs, /slugifyWorkflowId/, "Create dialog previews the manifest slug");
assert.match(dialogs, /not an execution schedule|Execution\s+scheduling arrives/i, "Schedule dialog stays honest about reminders vs execution");

assert.match(library, /type="search"/, "Library should include search");
assert.match(library, /Duplicate/, "Library should offer duplicate");
assert.match(library, /Delete/, "Library should offer delete");
assert.match(library, /onCreateRequest/, "Library should offer new-workflow creation");
assert.match(library, /workflow-dirty-dot/, "Library should mark unsaved drafts");

// Personal vs public split: the library groups by manifest origin so private
// (~/.coven) workflows never blur into shared repo templates.
assert.match(library, /isPersonalWorkflow\(workflow\)/, "Library should classify workflows by storage origin");
assert.match(library, /groups\.personal[\s\S]{0,400}Personal[\s\S]{0,400}groups\.templates[\s\S]{0,400}Templates/, "Library should render Personal then Templates groups");
assert.match(library, /workflow-origin-dot-personal/, "Personal rows should carry a personal origin badge");
assert.match(library, /workflow-origin-dot-public/, "Template rows should carry a public origin badge");
assert.match(css, /\.workflow-library-group-heading/, "CSS should style the origin group headings");
assert.match(css, /\.workflow-origin-dot-personal/, "CSS should style the personal origin badge");
assert.match(css, /\.workflow-origin-dot-public/, "CSS should style the public origin badge");

// Read-only templates: delete is blocked and saving forks a personal copy.
assert.match(library, /disabled=\{isPublicTemplate\(selectedWorkflow\)\}/, "Delete should be disabled for read-only templates");
assert.match(library, /Read-only template/, "Library footer should flag read-only templates");
assert.match(css, /\.workflow-library-footer-note/, "CSS should style the read-only template note");
assert.match(css, /\.workflow-library-footer button:disabled/, "CSS should dim disabled footer buttons");
assert.match(runStrip, /isPublicTemplate\(workflow\)/, "Run strip should detect read-only templates");
assert.match(runStrip, /Fork & Save/, "Save button should read 'Fork & Save' for templates");

assert.match(manifestPreview, /workflowToYaml/, "Manifest preview should render live canonical YAML");

assert.match(css, /\.workflow-palette/, "CSS should style the palette");
assert.match(css, /\.workflow-runs-panel/, "CSS should style the runs panel");
assert.match(css, /grid-template-areas:[\s\S]*"palette"[\s\S]*"canvas"[\s\S]*"strip"[\s\S]*"runs"/, "Workflow main grid should name the bottom run preview area");
assert.match(css, /\.workflow-run-preview-frame/, "CSS should style the run preview frame");
assert.match(css, /\.workflow-run-preview-resizer/, "CSS should style the draggable run preview handle");
assert.match(css, /\.workflow-studio-main\.is-run-preview-half/, "CSS should support a 50% bottom run preview");
assert.match(css, /\.workflow-studio-main\.is-run-preview-full/, "CSS should support a full-height bottom run preview");
assert.match(css, /\.workflow-studio-main\.is-run-preview-split/, "CSS should support a side-by-side run preview");
assert.match(css, /\.workflow-studio-main\.is-run-preview-split\s*\{[\s\S]*grid-template-areas:[\s\S]*"palette palette"[\s\S]*"canvas runs"[\s\S]*"strip runs"/, "Side-by-side mode should place runs next to the workflow view");
assert.match(css, /\.workflow-dialog/, "CSS should style dialogs");
assert.match(css, /\.workflow-field/, "CSS should style editor fields");

console.log("workflow-studio.test.ts: ok");
