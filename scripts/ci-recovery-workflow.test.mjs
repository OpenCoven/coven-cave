import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const source = await readFile(
  new URL("../.github/workflows/ci-recovery.yml", import.meta.url),
  "utf8",
);
const workflow = parse(source);

assert.equal(workflow.name, "Recover missing PR CI");
assert.deepEqual(workflow.on, {
  schedule: [{ cron: "*/10 * * * *" }],
  workflow_dispatch: null,
});
assert.deepEqual(workflow.permissions, {
  actions: "write",
  contents: "read",
  "pull-requests": "read",
});

const recovery = workflow.jobs.recover;
assert.equal(recovery["runs-on"], "ubuntu-latest");
assert.equal(recovery["timeout-minutes"], 5);

const checkout = recovery.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
assert.ok(checkout, "the workflow checks out the tested recovery script");
assert.match(checkout.uses, /^actions\/checkout@[0-9a-f]{40}$/);
assert.equal(checkout.with["persist-credentials"], false);

const detector = recovery.steps.find((step) => step.name === "Detect and recover missing CI");
assert.ok(detector, "the scheduled workflow runs the recovery detector");
assert.equal(detector.env.GITHUB_TOKEN, "${{ github.token }}");
assert.equal(detector.env.GITHUB_REPOSITORY, "${{ github.repository }}");
assert.match(detector.run, /node scripts\/ci-recovery\.mjs --apply/);

const ciSource = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const ciWorkflow = parse(ciSource);
assert.equal(
  ciWorkflow["run-name"],
  "CI ${{ github.event_name }} ${{ inputs.expected_sha || github.sha }}",
  "workflow_dispatch runs must expose their expected SHA to REST inventory",
);
assert.deepEqual(ciWorkflow.on.workflow_dispatch, {
  inputs: {
    expected_sha: {
      description: "Expected pull request head SHA",
      required: true,
      type: "string",
    },
  },
});
assert.equal(
  ciWorkflow.concurrency.group,
  "ci-${{ github.event.pull_request.head.sha || inputs.expected_sha || github.sha }}",
  "late pull_request delivery and its recovery dispatch must share one concurrency key",
);
for (const jobName of [
  "frontend-static",
  "frontend-tests",
  "frontend-bundle",
  "cargo-check",
  "e2e-shard",
  "conformance",
  "sidecar-runtime",
  "windows-native",
]) {
  assert.equal(
    ciWorkflow.jobs[jobName].if,
    "github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha",
    `${jobName} must not run a recovery dispatch after the branch head moves`,
  );
}

console.log("ci-recovery-workflow.test.mjs: ok");
