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
  Object.keys(ciWorkflow.jobs).sort(),
  [
    "build",
    "frontend-bundle",
    "frontend-e2e",
    "frontend-e2e-agentic",
    "frontend-validation",
    "ios",
    "paths",
    "pr-checks",
  ],
  "the required context aggregates bounded frontend validation lanes",
);
const prChecks = ciWorkflow.jobs["pr-checks"];
const frontendBuild = ciWorkflow.jobs.build;
const paths = ciWorkflow.jobs.paths;
assert.equal(prChecks.name, "PR checks");
assert.equal(frontendBuild.name, "Frontend build");
assert.deepEqual(ciWorkflow.permissions, {
  actions: "read",
  contents: "read",
  "pull-requests": "read",
});
assert.deepEqual(ciWorkflow.jobs.build.needs, [
  "paths",
  "ios",
  "frontend-validation",
  "frontend-bundle",
  "frontend-e2e",
  "frontend-e2e-agentic",
]);
assert.equal(ciWorkflow.jobs.ios.name, "iOS build");
assert.equal(
  paths.outputs.run_base_ref,
  "${{ steps.base_snapshot.outputs.run_base_ref }}",
  "the selector exports the exact base ref frozen for this run",
);
assert.equal(
  paths.outputs.run_base_sha,
  "${{ steps.base_snapshot.outputs.run_base_sha }}",
  "the selector exports the exact base SHA frozen for this run",
);
const baseSnapshot = paths.steps.find((step) => step.name === "Capture run base snapshot");
assert.ok(baseSnapshot, "the selector captures a base snapshot before selecting validation");
assert.equal(baseSnapshot.id, "base_snapshot");
assert.equal(baseSnapshot.env.GH_TOKEN, "${{ github.token }}");
assert.equal(baseSnapshot.env.PR_NUMBER, "${{ github.event.pull_request.number || inputs.expected_pr_number }}");
assert.equal(
  baseSnapshot.run,
  "node scripts/capture-ci-base-snapshot.mjs >> \"$GITHUB_OUTPUT\"",
);
const pathSelector = paths.steps.find((step) => step.name === "Select path-aware validation");
assert.ok(
  paths.steps.indexOf(baseSnapshot) < paths.steps.indexOf(pathSelector),
  "the base is frozen before path-aware work begins",
);
assert.equal(
  pathSelector.env.BASE_SHA,
  "${{ github.event.before || steps.base_snapshot.outputs.run_base_sha }}",
  "dispatch path selection uses the same live base snapshot exported to the final gate",
);
assert.deepEqual(ciWorkflow.jobs["frontend-validation"].strategy.matrix.validation, [
  { name: "lint", command: "lint" },
  { name: "typecheck", command: "typecheck" },
  { name: "test wiring", command: "check:tests-wired" },
  { name: "protocol conformance", command: "test:conformance" },
  { name: "app tests", command: "test:app" },
  { name: "API tests", command: "test:api" },
  { name: "mobile tests", command: "test:mobile" },
]);
assert.equal(ciWorkflow.jobs["frontend-validation"].strategy["fail-fast"], false);
assert.equal(
  ciWorkflow.jobs["frontend-validation"].steps.at(-1)?.run,
  "pnpm ${{ matrix.validation.command }}",
  "each frontend validation matrix lane runs its declared command",
);
const defaultE2e = ciWorkflow.jobs["frontend-e2e"].steps.find(
  (step) => step.name === "Validate end-to-end behavior",
);
assert.ok(defaultE2e, "CI keeps default-off end-to-end coverage");
assert.deepEqual(ciWorkflow.jobs["frontend-e2e"].strategy.matrix.shard, [1, 2, 3, 4, 5, 6, 7, 8]);
assert.equal(ciWorkflow.jobs["frontend-e2e"].strategy["fail-fast"], false);
assert.equal(
  defaultE2e.run,
  "pnpm exec playwright test --shard=${{ matrix.shard }}/8 --workers=1",
  "default end-to-end coverage is distributed across independently retryable runners",
);
assert.equal(defaultE2e.env, undefined, "default end-to-end coverage does not enable agentic recommendations");

const agenticE2e = ciWorkflow.jobs["frontend-e2e-agentic"].steps.find(
  (step) => step.name === "Validate flag-enabled agentic journeys",
);
assert.ok(agenticE2e, "CI runs explicitly enabled Board and Research recommendation journeys");
assert.equal(agenticE2e.env, undefined);
assert.equal(
  ciWorkflow.jobs["frontend-e2e-agentic"].env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS,
  "1",
);
assert.equal(
  agenticE2e.run,
  "pnpm exec playwright test tests/agentic-enhance.spec.ts tests/research-desk-tabs.spec.ts --project=desktop --workers=1 --no-deps",
  "the enabled journeys run in a separate desktop server with only their necessary flags",
);
const bundleRun = ciWorkflow.jobs["frontend-bundle"].steps.at(-1)?.run;
assert.ok(bundleRun, "the frontend bundle job ends with a build script");
assert.match(bundleRun, /if \[ "\$attempt" -lt 3 \]; then/);
assert.match(bundleRun, /::error::pnpm build failed after 3 attempts/);
assert.doesNotMatch(
  bundleRun,
  /echo "::warning::pnpm build attempt \$attempt failed; retrying with clean \.next"\n\s*rm -rf \.next\n\s*done/,
  "the terminal build failure must not claim that another retry will run",
);
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
    expected_pr_number: {
      description: "Pull request number used for recovery concurrency",
      required: true,
      type: "string",
    },
  },
});
assert.equal(
  ciWorkflow.concurrency.group,
  "ci-pr-${{ github.event.pull_request.number || inputs.expected_pr_number || github.run_id }}",
  "each pull request and its recovery dispatch must share one concurrency key",
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
const expectedSubordinateJobGuards = {
  paths: "github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha",
  ios:
    "needs.paths.outputs.ios == 'true' && (github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha)",
  "frontend-validation":
    "needs.paths.outputs.frontend == 'true' && (github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha)",
  "frontend-bundle":
    "needs.paths.outputs.frontend == 'true' && (github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha)",
  "frontend-e2e":
    "needs.paths.outputs.e2e == 'true' && (github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha)",
  "frontend-e2e-agentic":
    "needs.paths.outputs.e2e == 'true' && (github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha)",
};
for (const [jobName, guard] of Object.entries(expectedSubordinateJobGuards)) {
  assert.equal(
    ciWorkflow.jobs[jobName].if,
    guard,
    `${jobName} must not run a recovery dispatch after the branch head moves`,
  );
}
for (const job of [prChecks, frontendBuild]) {
  assert.equal(
    job.if,
    job === frontendBuild ? "always()" : undefined,
    `${job.name} must always report rather than skip a mismatched recovery dispatch as success`,
  );
  const mismatchCheck = job.steps[0];
  assert.equal(
    mismatchCheck?.name,
    "Refuse recovery SHA mismatch",
    `${job.name} must start by rejecting a recovery dispatch for another commit`,
  );
  assert.deepEqual(mismatchCheck.env, {
    EXPECTED_SHA: "${{ inputs.expected_sha }}",
    ACTUAL_SHA: "${{ github.sha }}",
  });
  assert.match(
    mismatchCheck.run,
    /if \[ "\$GITHUB_EVENT_NAME" = "workflow_dispatch" \] && \[ "\$ACTUAL_SHA" != "\$EXPECTED_SHA" \]; then/,
    `${job.name} must fail only mismatched recovery dispatches`,
  );
  assert.match(
    mismatchCheck.run,
    /::error::.*expected.*actual/i,
    `${job.name} must make a recovery SHA mismatch diagnosable`,
  );
  assert.match(
    mismatchCheck.run,
    /exit 1/,
    `${job.name} must fail rather than produce a successful skipped required check`,
  );
}
const prCommands = prChecks.steps
  .map((step) => step.run)
  .filter((run) => run?.startsWith("pnpm "));
assert.deepEqual(prCommands, [
  "pnpm install --frozen-lockfile",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm check:tests-wired",
  "pnpm test:app",
  "pnpm test:api",
  "pnpm test:mobile",
]);
assert.match(
  ciWorkflow.jobs["pr-checks"].steps.find((step) => step.uses?.startsWith("actions/checkout@")).with.ref,
  /refs\/pull\/.*merge/,
  "PR checks validates the pull-request merge ref",
);
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
assert.match(prerequisite.run, /test "\$FRONTEND_VALIDATION_RESULT" = "success"/);
assert.match(prerequisite.run, /test "\$FRONTEND_BUNDLE_RESULT" = "success"/);
assert.match(prerequisite.run, /test "\$FRONTEND_E2E_RESULT" = "success"/);
assert.match(prerequisite.run, /test "\$FRONTEND_E2E_AGENTIC_RESULT" = "success"/);
assert.equal(
  ciWorkflow.jobs.build.steps.some((step) => step.run?.includes("playwright test")),
  false,
  "the protected aggregator does not repeat Playwright work on one monolithic runner",
);

const releaseSource = await readFile(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const releaseWorkflow = parse(releaseSource);
for (const jobName of [
  "release-web-core",
  "release-web-validation",
  "release-e2e",
  "release-e2e-agentic",
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
