import assert from "node:assert/strict";
import { parse as parseYaml } from "yaml";
import {
  createWorkflowFromTemplate,
  duplicateWorkflow,
  slugifyWorkflowId,
  WORKFLOW_TEMPLATES,
  workflowToManifest,
  workflowToYaml,
} from "./workflow-edit.ts";
import { validateManifest } from "./workflow-source.ts";
import type { WorkflowPattern, WorkflowSummary } from "./workflows.ts";

// --- slugifyWorkflowId ---
assert.equal(slugifyWorkflowId("Nightly Release Review!"), "nightly-release-review");
assert.equal(slugifyWorkflowId("  --Weird   spacing__"), "weird-spacing");
assert.equal(slugifyWorkflowId(""), "untitled-workflow");

// --- templates: every pattern yields a manifest that validates clean ---
for (const pattern of Object.keys(WORKFLOW_TEMPLATES) as WorkflowPattern[]) {
  const workflow = createWorkflowFromTemplate({ id: `demo-${pattern}`, pattern });
  const validation = validateManifest(workflowToManifest(workflow));
  assert.equal(validation.ok, true, `${pattern} template must validate (got ${JSON.stringify(validation.issues)})`);
  assert.equal(
    validation.issues.length,
    0,
    `${pattern} template must have zero issues (got ${JSON.stringify(validation.issues)})`,
  );
  assert.ok((workflow.steps?.length ?? 0) >= 2, `${pattern} template should scaffold at least two steps`);
}

// --- serialization: round-trips through YAML and strips undefined ---
const workflow: WorkflowSummary = {
  id: "release-review",
  version: "1.0.0",
  name: "Release Review",
  pattern: "sequential",
  validation_state: "valid", // cave-only, must NOT serialize
  path: "release-review",    // cave-only, must NOT serialize
  steps: [
    { id: "gate", kind: "human-gate", name: "Approval", uses: "valentina" },
    { id: "review", kind: "agent", uses: "nova", requires: ["gate"] },
  ],
  limits: { max_agents: 4 },
};

const manifest = workflowToManifest(workflow);
assert.equal(manifest.validation_state, undefined, "cave-only validation_state is stripped");
assert.equal(manifest.path, undefined, "cave-only path is stripped");
assert.equal(manifest.summary, undefined, "absent fields are stripped, not serialized as null");

const yamlText = workflowToYaml(workflow);
const reparsed = parseYaml(yamlText) as Record<string, unknown>;
assert.equal(reparsed.id, "release-review");
assert.deepEqual(
  (reparsed.steps as Array<Record<string, unknown>>)[1].requires,
  ["gate"],
  "requires edges survive the YAML round-trip",
);
assert.equal(validateManifest(reparsed).ok, true, "serialized YAML re-validates");
assert.equal(
  Object.keys(reparsed)[0],
  "id",
  "id is the first serialized key for stable diffs",
);

// --- duplicate ---
const copy = duplicateWorkflow(workflow, "release-review-copy");
assert.equal(copy.id, "release-review-copy");
assert.equal(copy.name, "Release Review copy");
assert.equal(copy.path, undefined, "duplicate is detached from the source file");
assert.notEqual(copy.steps, workflow.steps, "duplicate deep-copies steps");
assert.equal(validateManifest(workflowToManifest(copy)).ok, true);

console.log("workflow-edit.test.ts: ok");
