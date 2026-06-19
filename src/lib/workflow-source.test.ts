import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  coerceManifest,
  deleteLocalWorkflow,
  dryRunLocalWorkflowManifest,
  loadLocalWorkflowList,
  loadWorkflowLayout,
  planDryRun,
  saveLocalWorkflow,
  saveWorkflowLayout,
  validateManifest,
  workflowFileName,
} from "./workflow-source.ts";
import { discoverRoleFiles } from "./role-source.ts";

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

// A well-formed manifest validates clean and coerces to a valid summary.
{
  const raw = {
    id: "nova-release-review",
    version: "1.0.0",
    name: "Release Review",
    pattern: "sequential",
    limits: { max_agents: 4 },
    steps: [
      { id: "input", kind: "input", summary: "The change to review." },
      { id: "gate", kind: "human-gate", requires: ["input"] },
      { id: "review", kind: "agent", requires: ["gate"] },
      { id: "output", kind: "output", summary: "The reviewed result.", requires: ["review"] },
    ],
  };
  const result = validateManifest(raw);
  assert.equal(result.ok, true, "well-formed manifest validates ok");
  assert.equal(result.issues.length, 0, "no issues on a clean manifest");

  const summary = coerceManifest(raw, "nova-release-review");
  assert.equal(summary.validation_state, "valid", "clean manifest is valid");
  assert.equal(summary.steps?.length, 4, "steps are coerced");
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
    steps: [
      { id: "input", kind: "input", summary: "in" },
      { id: "a", kind: "agent", requires: ["input"] },
      { id: "output", kind: "output", summary: "out", requires: ["a"] },
    ],
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
        { id: "input", kind: "input", summary: "in" },
        { id: "gate", kind: "human-gate", requires: ["input"] },
        { id: "go", kind: "agent", requires: ["gate"] },
        { id: "output", kind: "output", summary: "out", requires: ["go"] },
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
      { id: "input", kind: "input", summary: "in" },
      { id: "a", kind: "agent", requires: ["input"] },
      { id: "b", kind: "agent", requires: ["a"] },
      { id: "output", kind: "output", summary: "out", requires: ["b"] },
    ],
  });
  assert.equal(plan.ok, true, "draft manifest plans ok");
  assert.equal(plan.steps?.length, 4);
}

// I/O contract: a workflow can't validate or plan without an input + output.
{
  const noInput = validateManifest({
    id: "wf",
    version: "1.0.0",
    steps: [
      { id: "a", kind: "agent" },
      { id: "output", kind: "output", summary: "out", requires: ["a"] },
    ],
  });
  assert.equal(noInput.ok, false, "no input node fails validation");
  assert.ok(noInput.issues.some((i) => i.code === "missing_input"), "flags missing input");

  const noOutput = validateManifest({
    id: "wf",
    version: "1.0.0",
    steps: [
      { id: "input", kind: "input", summary: "in" },
      { id: "a", kind: "agent", requires: ["input"] },
    ],
  });
  assert.equal(noOutput.ok, false, "no output node fails validation");
  assert.ok(noOutput.issues.some((i) => i.code === "missing_output"), "flags missing output");

  // The dry-run plan is likewise blocked without the I/O pair.
  const plan = planDryRun(coerceManifest({ id: "wf", version: "1.0.0", steps: [{ id: "a", kind: "agent" }] }, "wf"));
  assert.equal(plan.ok, false, "plan is blocked without input/output");
  assert.ok(
    plan.issues?.some((i) => i.code === "missing_input") && plan.issues?.some((i) => i.code === "missing_output"),
    "plan reports both missing-I/O blockers",
  );
}

// Save and delete round-trip against a temp workflows dir.
await (async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cave-workflows-"));
  const covenHome = await mkdtemp(path.join(tmpdir(), "cave-home-"));
  const prev = process.env.COVEN_WORKFLOWS_DIR;
  const prevCovenHome = process.env.COVEN_HOME;
  process.env.COVEN_WORKFLOWS_DIR = dir;
  process.env.COVEN_HOME = covenHome;
  try {
    const manifest = {
      id: "saved-flow",
      version: "0.1.0",
      name: "Saved Flow",
      pattern: "sequential",
      visibility: { public: true, coven_cave: true },
      steps: [
        { id: "input", kind: "input", summary: "in" },
        { id: "plan", kind: "agent", requires: ["input"] },
        { id: "go", kind: "agent", requires: ["plan"] },
        { id: "output", kind: "output", summary: "out", requires: ["go"] },
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

    // Layout sidecar: cave-only node positions round-trip beside manifests.
    const layoutSave = await saveWorkflowLayout("saved-flow", {
      plan: { x: 40, y: 80 },
      go: { x: 320, y: 80 },
    });
    assert.equal(layoutSave.ok, true, "layout sidecar saves");
    const layout = await loadWorkflowLayout("saved-flow");
    assert.deepEqual(layout?.plan, { x: 40, y: 80 }, "layout sidecar round-trips positions");
    const unsafeLayout = await saveWorkflowLayout("../evil", { a: { x: 0, y: 0 } });
    assert.equal(unsafeLayout.ok, false, "unsafe layout ids are rejected");
    const sidecar = await readFile(path.join(dir, "saved-flow.cave.json"), "utf8");
    assert.match(sidecar, /"plan"/, "sidecar lives next to the manifest as <id>.cave.json");

    // Delete by id.
    const deleted = await deleteLocalWorkflow({ id: "saved-flow" });
    assert.equal(deleted.ok, true, "delete succeeds");
    const after = await loadLocalWorkflowList();
    assert.equal(after.workflows.some((w) => w.id === "saved-flow"), false, "deleted workflow is gone");

    const missing = await deleteLocalWorkflow({ id: "never-existed" });
    assert.equal(missing.ok, false, "deleting an unknown workflow reports an error");
    assert.equal(await loadWorkflowLayout("never-existed"), null, "missing sidecar reads as null");
  } finally {
    if (prev === undefined) delete process.env.COVEN_WORKFLOWS_DIR;
    else process.env.COVEN_WORKFLOWS_DIR = prev;
    if (prevCovenHome === undefined) delete process.env.COVEN_HOME;
    else process.env.COVEN_HOME = prevCovenHome;
    await rm(dir, { recursive: true, force: true });
    await rm(covenHome, { recursive: true, force: true });
  }
})();

// Personal saves stay private by default; explicit public workflows land in the repo workflow dir.
await (async () => {
  const publicDir = await mkdtemp(path.join(tmpdir(), "cave-public-workflows-"));
  const covenHome = await mkdtemp(path.join(tmpdir(), "cave-home-"));
  const prevWorkflowsDir = process.env.COVEN_WORKFLOWS_DIR;
  const prevCovenHome = process.env.COVEN_HOME;
  process.env.COVEN_WORKFLOWS_DIR = publicDir;
  process.env.COVEN_HOME = covenHome;
  try {
    const personalManifest = {
      id: "personal-flow",
      version: "0.1.0",
      name: "Personal Flow",
      steps: [{ id: "plan", kind: "agent" }],
    };
    const personal = await saveLocalWorkflow({ manifest: personalManifest });
    assert.equal(personal.ok, true, `personal save succeeds (${personal.error ?? ""})`);
    assert.equal(await exists(path.join(publicDir, "personal-flow.yaml")), false, "personal saves do not write to the public workflow dir");
    assert.equal(
      await exists(path.join(covenHome, "workflows", "personal", "personal-flow.yaml")),
      true,
      "personal saves write under the private Coven home",
    );
    assert.equal(
      (await stat(path.join(covenHome, "workflows", "personal", "personal-flow.yaml"))).mode & 0o777,
      0o600,
      "personal saves are owner-only readable",
    );

    const publicManifest = {
      id: "public-flow",
      version: "0.1.0",
      name: "Public Flow",
      visibility: { public: true, coven_cave: true },
      steps: [{ id: "plan", kind: "agent" }],
    };
    const publicSave = await saveLocalWorkflow({ manifest: publicManifest });
    assert.equal(publicSave.ok, true, `public save succeeds (${publicSave.error ?? ""})`);
    assert.equal(await exists(path.join(publicDir, "public-flow.yaml")), true, "public saves write to the public workflow dir");
    assert.equal(
      await exists(path.join(covenHome, "workflows", "personal", "public-flow.yaml")),
      false,
      "public saves do not create a personal copy",
    );

    const list = await loadLocalWorkflowList();
    assert.ok(list.workflows.some((workflow) => workflow.id === "personal-flow"), "personal workflow is listed");
    assert.ok(list.workflows.some((workflow) => workflow.id === "public-flow"), "public workflow is listed");

    const movedPublic = await saveLocalWorkflow({
      manifest: { ...personalManifest, visibility: { public: true, coven_cave: true } },
    });
    assert.equal(movedPublic.ok, true, `personal-to-public save succeeds (${movedPublic.error ?? ""})`);
    assert.equal(await exists(path.join(publicDir, "personal-flow.yaml")), true, "public promotion writes to the public dir");
    assert.equal(
      await exists(path.join(covenHome, "workflows", "personal", "personal-flow.yaml")),
      false,
      "public promotion removes the stale personal copy",
    );

    const movedPersonal = await saveLocalWorkflow({
      manifest: { id: "public-flow", version: "0.1.0", name: "Private Again", steps: [{ id: "plan", kind: "agent" }] },
    });
    assert.equal(movedPersonal.ok, true, `public-to-personal save succeeds (${movedPersonal.error ?? ""})`);
    assert.equal(await exists(path.join(publicDir, "public-flow.yaml")), false, "private demotion removes the stale public copy");
    assert.equal(
      await exists(path.join(covenHome, "workflows", "personal", "public-flow.yaml")),
      true,
      "private demotion writes to the private Coven home",
    );
  } finally {
    if (prevWorkflowsDir === undefined) delete process.env.COVEN_WORKFLOWS_DIR;
    else process.env.COVEN_WORKFLOWS_DIR = prevWorkflowsDir;
    if (prevCovenHome === undefined) delete process.env.COVEN_HOME;
    else process.env.COVEN_HOME = prevCovenHome;
    await rm(publicDir, { recursive: true, force: true });
    await rm(covenHome, { recursive: true, force: true });
  }
})();

// Role-declared workflows without manifests still appear in the workflow list.
await (async () => {
  const workflowsDir = await mkdtemp(path.join(tmpdir(), "cave-workflows-"));
  const covenHome = await mkdtemp(path.join(tmpdir(), "cave-home-"));
  const prevWorkflowsDir = process.env.COVEN_WORKFLOWS_DIR;
  const prevCovenHome = process.env.COVEN_HOME;
  process.env.COVEN_WORKFLOWS_DIR = workflowsDir;
  process.env.COVEN_HOME = covenHome;
  try {
    await writeFile(
      path.join(workflowsDir, "saved-flow.yaml"),
      [
        "id: saved-flow",
        "version: 0.1.0",
        "name: Saved Flow",
        "steps:",
        "  - id: plan",
        "    kind: agent",
        "",
      ].join("\n"),
      "utf8",
    );
    const roleDir = path.join(covenHome, "roles", "familiars", "sage", "researcher");
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      path.join(roleDir, "ROLE.md"),
      [
        "---",
        'name: "Researcher"',
        "familiar: sage",
        "---",
        "",
        "workflows:",
        "- research-brief",
        "",
      ].join("\n"),
      "utf8",
    );

    const list = await loadLocalWorkflowList();
    const ids = list.workflows.map((workflow) => workflow.id);
    assert.deepEqual(ids, ["research-brief", "saved-flow"], "role-declared workflow ids are merged with manifests");
    const roleOnly = list.workflows.find((workflow) => workflow.id === "research-brief");
    assert.equal(roleOnly?.validation_state, "unknown", "role-only workflows render as placeholders");
  } finally {
    if (prevWorkflowsDir === undefined) delete process.env.COVEN_WORKFLOWS_DIR;
    else process.env.COVEN_WORKFLOWS_DIR = prevWorkflowsDir;
    if (prevCovenHome === undefined) delete process.env.COVEN_HOME;
    else process.env.COVEN_HOME = prevCovenHome;
    await rm(workflowsDir, { recursive: true, force: true });
    await rm(covenHome, { recursive: true, force: true });
  }
})();

// Exported role copies do not duplicate workspace roles in role-backed views.
await (async () => {
  const covenHome = await mkdtemp(path.join(tmpdir(), "cave-home-"));
  const workspace = await mkdtemp(path.join(tmpdir(), "cave-workspace-"));
  const prevCovenHome = process.env.COVEN_HOME;
  process.env.COVEN_HOME = covenHome;
  try {
    await writeFile(
      path.join(covenHome, "familiars.toml"),
      [`[[familiar]]`, `id = "sage"`, `workspace = "${workspace}"`, ""].join("\n"),
      "utf8",
    );
    const workspaceRoleDir = path.join(workspace, "roles", "researcher");
    const exportedRoleDir = path.join(covenHome, "roles", "familiars", "sage", "researcher");
    await mkdir(workspaceRoleDir, { recursive: true });
    await mkdir(exportedRoleDir, { recursive: true });
    const roleMd = [
      "---",
      'name: "Researcher"',
      "familiar: sage",
      "---",
      "",
      "workflows:",
      "- research-brief",
      "",
    ].join("\n");
    await writeFile(path.join(workspaceRoleDir, "ROLE.md"), roleMd, "utf8");
    await writeFile(path.join(exportedRoleDir, "ROLE.md"), roleMd, "utf8");

    const roles = await discoverRoleFiles();
    assert.equal(
      roles.filter((role) => role.familiar === "sage" && role.id === "researcher").length,
      1,
      "exported role copies do not duplicate workspace roles",
    );
  } finally {
    if (prevCovenHome === undefined) delete process.env.COVEN_HOME;
    else process.env.COVEN_HOME = prevCovenHome;
    await rm(covenHome, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
})();

// The production role workflows are backed by real multi-step manifests, not
// fallback single-node placeholders.
await (async () => {
  const covenHome = await mkdtemp(path.join(tmpdir(), "cave-home-"));
  const prevCovenHome = process.env.COVEN_HOME;
  const prevWorkflowsDir = process.env.COVEN_WORKFLOWS_DIR;
  delete process.env.COVEN_WORKFLOWS_DIR;
  process.env.COVEN_HOME = covenHome;
  const workflowIds = [
    "annotate-document",
    "archive-memory",
    "bug-diagnosis",
    "coordination-router",
    "coven-orchestration",
    "curate-reading-list",
    "devrel-response",
    "draft-copy",
    "prepare-social-post",
    "research-brief",
    "retrospective-synthesis",
    "review-diff",
    "scoped-implementation",
    "strategy-map",
    "synthesize-sources",
    "system-architecture-review",
    "tag-and-organize",
  ];
  try {
    const roleDir = path.join(covenHome, "roles", "familiars", "sage", "workflow-auditor");
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      path.join(roleDir, "ROLE.md"),
      [
        "---",
        'name: "Workflow Auditor"',
        "familiar: sage",
        "---",
        "",
        "workflows:",
        ...workflowIds.map((id) => `- ${id}`),
        "",
      ].join("\n"),
      "utf8",
    );

    const list = await loadLocalWorkflowList();
    for (const id of workflowIds) {
      const workflow = list.workflows.find((entry) => entry.id === id);
      assert.ok(workflow, `${id} is discoverable`);
      assert.equal(workflow.validation_state, "valid", `${id} has a valid manifest`);
      assert.ok((workflow.steps?.length ?? 0) >= 3, `${id} has a multi-step execution graph`);
      assert.notEqual(workflow.summary, "Declared by a role, but no workflow manifest exists yet.", `${id} is not a placeholder`);
    }
  } finally {
    if (prevCovenHome === undefined) delete process.env.COVEN_HOME;
    else process.env.COVEN_HOME = prevCovenHome;
    if (prevWorkflowsDir === undefined) delete process.env.COVEN_WORKFLOWS_DIR;
    else process.env.COVEN_WORKFLOWS_DIR = prevWorkflowsDir;
    await rm(covenHome, { recursive: true, force: true });
  }
})();

console.log("workflow-source.test.ts: ok");
