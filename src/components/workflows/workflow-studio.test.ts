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

console.log("workflow-studio.test.ts: ok");
