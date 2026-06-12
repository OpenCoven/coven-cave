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
assert.match(runStrip, /Run endpoint pending/, "WorkflowRunStrip should guard Play until daemon execution exists");
assert.match(
  runStrip,
  /<p[^>]*>[\s\S]*Run endpoint pending/,
  "WorkflowRunStrip should show a visible pending-run hint",
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
assert.match(css, /\.workflow-studio-shell/, "workflow CSS should style the studio shell");
assert.match(css, /@media \(max-width: 860px\)/, "workflow CSS should include mobile studio layout");

// --- Studio v2: visual builder, runs, assignments ---

assert.match(studio, /WorkflowPalette/, "Studio should include the step palette");
assert.match(studio, /WorkflowRunsPanel/, "Studio should include the runs panel");
assert.match(studio, /WorkflowCreateDialog/, "Studio should wire the create dialog");
assert.match(studio, /WorkflowScheduleDialog/, "Studio should wire the schedule dialog");
assert.match(studio, /onUndo[\s\S]*onRedo/, "Studio should thread undo/redo");

for (const kind of ["agent", "skill", "tool", "human-gate", "workflow"]) {
  assert.match(palette, new RegExp(`"${kind}"`), `Palette should offer the ${kind} step kind`);
}

assert.match(canvas, /onConnect/, "Canvas should support drawing dependency edges");
assert.match(canvas, /onEdgesDelete/, "Canvas should support deleting dependency edges");
assert.match(canvas, /onNodesDelete/, "Canvas should support deleting step nodes");
assert.match(canvas, /deleteKeyCode/, "Canvas should map delete keys for edit operations");

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

assert.match(attachments, /onAttachRole/, "Attachments should persist role bindings");
assert.match(attachments, /onUpdateMeta/, "Attachments should bind familiars into the manifest");
assert.match(attachments, /onScheduleRequest/, "Attachments should open scheduling");

assert.match(dialogs, /WorkflowCreateDialog/, "Create dialog exists");
assert.match(dialogs, /WorkflowScheduleDialog/, "Schedule dialog exists");
assert.match(dialogs, /slugifyWorkflowId/, "Create dialog previews the manifest slug");
assert.match(dialogs, /not an execution schedule|Execution\s+scheduling arrives/i, "Schedule dialog stays honest about reminders vs execution");

assert.match(library, /type="search"/, "Library should include search");
assert.match(library, /Duplicate/, "Library should offer duplicate");
assert.match(library, /Delete/, "Library should offer delete");
assert.match(library, /onCreateRequest/, "Library should offer new-workflow creation");
assert.match(library, /workflow-dirty-dot/, "Library should mark unsaved drafts");

assert.match(manifestPreview, /workflowToYaml/, "Manifest preview should render live canonical YAML");

assert.match(css, /\.workflow-palette/, "CSS should style the palette");
assert.match(css, /\.workflow-runs-panel/, "CSS should style the runs panel");
assert.match(css, /\.workflow-dialog/, "CSS should style dialogs");
assert.match(css, /\.workflow-field/, "CSS should style editor fields");

console.log("workflow-studio.test.ts: ok");
