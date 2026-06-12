import assert from "node:assert/strict";
import { coerceManifest, planDryRun, validateManifest } from "./workflow-source.ts";

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

console.log("workflow-source.test.ts: ok");
