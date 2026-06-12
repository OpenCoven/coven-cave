import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  coerceManifest,
  deleteLocalWorkflow,
  dryRunLocalWorkflowManifest,
  loadLocalWorkflowList,
  planDryRun,
  saveLocalWorkflow,
  validateManifest,
  workflowFileName,
} from "./workflow-source.ts";

// A well-formed manifest validates clean and coerces to a valid summary.
{
  const raw = {
    id: "nova-release-review",
    version: "1.0.0",
    name: "Release Review",
    pattern: "sequential",
    limits: { max_agents: 4 },
    steps: [
      { id: "gate", kind: "human-gate" },
      { id: "review", kind: "agent", requires: ["gate"] },
    ],
  };
  const result = validateManifest(raw);
  assert.equal(result.ok, true, "well-formed manifest validates ok");
  assert.equal(result.issues.length, 0, "no issues on a clean manifest");

  const summary = coerceManifest(raw, "nova-release-review");
  assert.equal(summary.validation_state, "valid", "clean manifest is valid");
  assert.equal(summary.steps?.length, 2, "steps are coerced");
  assert.equal(summary.path, "nova-release-review", "source becomes the path");
}

// Missing id/version/steps are hard schema errors.
{
  const result = validateManifest({ name: "broken" });
  assert.equal(result.ok, false, "missing required fields fails validation");
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes("missing_id"), "flags missing id");
  assert.ok(codes.includes("missing_version"), "flags missing version");
  assert.ok(codes.includes("no_steps"), "flags missing steps");
}

// A dependency on an undeclared step is a semantic error and a dry-run blocker.
{
  const raw = {
    id: "wf",
    version: "1.0.0",
    steps: [{ id: "a", kind: "agent", requires: ["ghost"] }],
  };
  const result = validateManifest(raw);
  assert.equal(result.ok, false, "unknown dependency fails validation");
  assert.ok(
    result.issues.some((i) => i.code === "unknown_dependency"),
    "flags the unknown dependency",
  );

  const plan = planDryRun(coerceManifest(raw, "wf"));
  assert.equal(plan.ok, false, "plan is not ok when a step is blocked");
  assert.equal(plan.steps?.[0]?.status, "blocked", "blocked step is reported");
}

// Unknown pattern is a warning: ok stays true but an issue is recorded.
{
  const raw = {
    id: "wf",
    version: "1.0.0",
    pattern: "made-up",
    steps: [{ id: "a", kind: "agent" }],
  };
  const result = validateManifest(raw);
  assert.equal(result.ok, true, "unknown pattern is a soft warning");
  assert.ok(result.issues.some((i) => i.code === "unknown_pattern"), "warns on unknown pattern");
  assert.equal(coerceManifest(raw, "wf").validation_state, "warning", "warning-only manifest is 'warning'");
}

// Dry-run rolls up declared limits and human gates.
{
  const summary = coerceManifest(
    {
      id: "wf",
      version: "1.0.0",
      limits: { max_agents: 6, timeout_s: 120 },
      steps: [
        { id: "gate", kind: "human-gate" },
        { id: "go", kind: "agent", requires: ["gate"] },
      ],
    },
    "wf",
  );
  const plan = planDryRun(summary);
  assert.equal(plan.ok, true, "fully-resolved workflow plans ok");
  assert.equal(plan.estimates?.maxAgents, 6, "max_agents rolls up");
  assert.deepEqual(plan.estimates?.humanGates, ["gate"], "human gates are collected");
}

// Filename safety: only plain slugs become files.
{
  assert.equal(workflowFileName("release-review"), "release-review.yaml");
  assert.equal(workflowFileName("Release_Review-2"), "Release_Review-2.yaml");
  assert.equal(workflowFileName("../escape"), null, "path traversal is rejected");
  assert.equal(workflowFileName("a/b"), null, "separators are rejected");
  assert.equal(workflowFileName(""), null, "empty id is rejected");
}

// Inline-manifest dry-run plans drafts without touching disk.
{
  const plan = dryRunLocalWorkflowManifest({
    id: "draft",
    version: "0.1.0",
    steps: [
      { id: "a", kind: "agent" },
      { id: "b", kind: "agent", requires: ["a"] },
    ],
  });
  assert.equal(plan.ok, true, "draft manifest plans ok");
  assert.equal(plan.steps?.length, 2);
}

// Save and delete round-trip against a temp workflows dir.
await (async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cave-workflows-"));
  const prev = process.env.COVEN_WORKFLOWS_DIR;
  process.env.COVEN_WORKFLOWS_DIR = dir;
  try {
    const manifest = {
      id: "saved-flow",
      version: "0.1.0",
      name: "Saved Flow",
      pattern: "sequential",
      steps: [
        { id: "plan", kind: "agent" },
        { id: "go", kind: "agent", requires: ["plan"] },
      ],
    };

    const saved = await saveLocalWorkflow({ manifest });
    assert.equal(saved.ok, true, `save succeeds (${saved.error ?? ""})`);
    assert.equal(saved.workflow?.id, "saved-flow");
    assert.equal(saved.validation?.ok, true, "save returns the validation verdict");

    const onDisk = await readFile(path.join(dir, "saved-flow.yaml"), "utf8");
    assert.match(onDisk, /id: saved-flow/, "manifest lands on disk as YAML");

    const list = await loadLocalWorkflowList();
    assert.ok(
      list.workflows.some((w) => w.id === "saved-flow" && w.validation_state === "valid"),
      "saved workflow is discoverable and valid",
    );

    // Saving an invalid manifest still persists but reports the issues.
    const savedInvalid = await saveLocalWorkflow({
      manifest: { id: "broken-flow", name: "no version or steps" },
    });
    assert.equal(savedInvalid.ok, true, "invalid-but-parseable manifests still save");
    assert.equal(savedInvalid.validation?.ok, false, "validation verdict reports the problems");

    // Unsafe ids never touch disk.
    const unsafe = await saveLocalWorkflow({ manifest: { id: "../evil", version: "1.0.0", steps: [{ id: "a", kind: "agent" }] } });
    assert.equal(unsafe.ok, false, "unsafe id is rejected");

    // Delete by id.
    const deleted = await deleteLocalWorkflow({ id: "saved-flow" });
    assert.equal(deleted.ok, true, "delete succeeds");
    const after = await loadLocalWorkflowList();
    assert.equal(after.workflows.some((w) => w.id === "saved-flow"), false, "deleted workflow is gone");

    const missing = await deleteLocalWorkflow({ id: "never-existed" });
    assert.equal(missing.ok, false, "deleting an unknown workflow reports an error");
  } finally {
    if (prev === undefined) delete process.env.COVEN_WORKFLOWS_DIR;
    else process.env.COVEN_WORKFLOWS_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
})();

console.log("workflow-source.test.ts: ok");
