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
const SHA_GUARD = "github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha";

// Every job must refuse a recovery dispatch whose branch head has moved. A job
// may narrow itself further (for example, skipping on pull_request to keep a
// paid runner off the PR fan-out), but only by ANDing extra conditions onto the
// guard. Any `||` in the suffix could re-admit a stale dispatch, so the shape is
// pinned rather than merely searched for.
function assertShaGuarded(jobName, condition) {
  assert.equal(typeof condition, "string", `${jobName} must declare an if: condition`);
  if (condition === SHA_GUARD) {
    return;
  }
  const prefix = `(${SHA_GUARD}) && `;
  assert.ok(
    condition.startsWith(prefix),
    `${jobName} must not run a recovery dispatch after the branch head moves`,
  );
  const suffix = condition.slice(prefix.length);
  assert.ok(suffix.length > 0, `${jobName} must not AND the guard against an empty condition`);
  assert.ok(
    !suffix.includes("||"),
    `${jobName} must not weaken the head-moved guard with any disjunction in the suffix`,
  );
}

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
  assertShaGuarded(jobName, ciWorkflow.jobs[jobName].if);
}

// Paid-runner fan-out policy: Windows is billed at 2x and the shared Actions
// queue could not absorb three Windows legs per pull request. Windows coverage
// moves to push/main and release. These assertions exist so the reduction
// cannot be silently undone, and so the rollup below cannot be "fixed" by
// accepting a skip on the very event whose coverage it guarantees.
const PR_ONLY_UBUNTU =
  "${{ github.event_name == 'pull_request' && fromJSON('[\"ubuntu-latest\"]')" +
  " || fromJSON('[\"ubuntu-latest\",\"windows-latest\"]') }}";
for (const jobName of ["conformance", "sidecar-runtime"]) {
  assert.equal(
    ciWorkflow.jobs[jobName].strategy.matrix.os,
    PR_ONLY_UBUNTU,
    `${jobName} must run ubuntu-only on pull_request and ubuntu+windows elsewhere`,
  );
}
assert.ok(
  ciWorkflow.jobs["windows-native"].if.includes("github.event_name != 'pull_request'"),
  "windows-native must stay off the pull_request fan-out",
);

const sidecarRollup = ciWorkflow.jobs["sidecar-runtime-required"];
assert.deepEqual(
  sidecarRollup.needs,
  ["sidecar-runtime", "windows-native"],
  "the sidecar rollup must still depend on the Windows legs it reports for",
);
const sidecarGate = sidecarRollup.steps.find(
  (step) => step.name === "Require every sidecar runtime matrix leg",
);
assert.ok(sidecarGate, "the sidecar rollup must gate on its matrix legs");
assert.match(
  sidecarGate.run,
  /"\$WINDOWS_RESULT" = "skipped" \] && \[ "\$EVENT" = "pull_request"/,
  "a skipped windows-native is acceptable on pull_request only",
);
assert.match(
  sidecarGate.run,
  /elif \[ "\$WINDOWS_RESULT" != "success" \]/,
  "any other windows-native result, on any other event, must fail the rollup",
);

console.log("ci-recovery-workflow.test.mjs: ok");
