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
assert.deepEqual(
  Object.keys(ciWorkflow.jobs),
  ["paths", "ios", "build"],
  "routine CI classifies once, runs path-aware iOS validation, then reports through the required job",
);
assert.equal(ciWorkflow.jobs.build.name, "Frontend build");
assert.deepEqual(ciWorkflow.jobs.build.needs, ["paths", "ios"]);
assert.equal(ciWorkflow.jobs.ios.name, "iOS build");
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
// Sharing the key is deliberate; CANCELLING across it is not. A dispatch
// resolves to the same group as the run it is rescuing, so with a blanket
// cancel-in-progress it kills that run and the required check never reports —
// observed on #4618, where one head collected three cancelled runs and no
// verdict, each cancellation feeding ci-recovery's `cancelled_latest_run`
// wedge test and provoking the next dispatch (cave-f22tp). Excluded from
// cancellation, a dispatch queues behind the in-flight run instead.
assert.equal(
  ciWorkflow.concurrency["cancel-in-progress"],
  "${{ github.event_name != 'workflow_dispatch' && github.ref != 'refs/heads/main' }}",
  "a recovery dispatch must never cancel the run it exists to rescue",
);
const expectedJobGuards = {
  paths: "github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha",
  ios:
    "needs.paths.outputs.ios == 'true' && (github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha)",
  build:
    "always() && (github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha)",
};
for (const [jobName, guard] of Object.entries(expectedJobGuards)) {
  assert.equal(
    ciWorkflow.jobs[jobName].if,
    guard,
    `${jobName} must not run a recovery dispatch after the branch head moves`,
  );
}
assert.equal(
  ciWorkflow.jobs.ios.steps.some((step) => step.run === "bash scripts/ios-xcodegen.sh"),
  true,
  "PR iOS validation uses the canonical generator",
);
assert.equal(
  ciWorkflow.jobs.ios.steps.some((step) => step.run?.startsWith("xcodebuild ")),
  true,
  "PR iOS validation compiles the app without signing",
);
const prerequisite = ciWorkflow.jobs.build.steps.find(
  (step) => step.name === "Require selected validation",
);
assert.ok(prerequisite, "the required Frontend build aggregates prerequisite job results");
assert.match(prerequisite.run, /test "\$IOS_RESULT" = "success"/);

const releaseSource = await readFile(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const releaseWorkflow = parse(releaseSource);
for (const jobName of [
  "release-web-validation",
  "release-platform-validation",
  "release-windows-native",
  "release-ios-build",
]) {
  assert.ok(releaseWorkflow.jobs[jobName], `release workflow defines ${jobName}`);
}
assert.deepEqual(
  releaseWorkflow.jobs.build.needs,
  [
    "daemon-package",
    "source-version",
    "release-web-validation",
    "release-platform-validation",
    "release-windows-native",
  ],
  "artifact builds wait for release validation without depending on TestFlight publication",
);

console.log("ci-recovery-workflow.test.mjs: ok");
