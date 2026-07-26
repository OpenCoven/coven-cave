// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildExecutionPlan,
  catalogEntriesFromSubmissions,
  resolveExecutionRoute,
  validateSubmissionPackage,
} from "./opencoven-submissions.ts";

const runtimePackage = {
  manifest: {
    name: "Local Coven Runtime",
    version: "1.2.0",
    description: "Runs OpenCoven workloads on the local machine.",
    type: "runtime",
    capabilities: ["shell.exec", "filesystem.read", "events.stream"],
    requiredServices: ["coven-daemon"],
    permissions: {
      env: ["OPENAI_API_KEY"],
      config: ["cwd"],
      filesystem: ["read", "write"],
    },
    entrypoints: {
      invoke: "bin/coven-runtime",
      health: "bin/coven-runtime health",
    },
    runtime: {
      id: "local-coven",
      invocation: "stdio",
      protocols: ["opencoven.runtime.v1"],
      capabilities: ["shell.exec", "filesystem.read", "events.stream"],
      config: {
        env: ["OPENAI_API_KEY"],
      },
      healthCheck: {
        command: "bin/coven-runtime health",
      },
      sandbox: {
        network: "restricted",
        filesystem: "workspace",
      },
    },
    artifacts: ["bin/coven-runtime"],
    examples: [{ name: "smoke", path: "examples/smoke.json" }],
    docs: ["docs/runtime.md"],
  },
  artifacts: ["manifest.json", "bin/coven-runtime", "examples/smoke.json"],
  files: {
    "bin/coven-runtime": { size: 128, sha256: "a".repeat(64) },
    "examples/smoke.json": JSON.stringify({ prompt: "hello" }),
  },
};

const harnessPackage = {
  manifest: {
    name: "Repository Review Harness",
    version: "0.4.0",
    description: "Reviews repository changes and emits structured findings.",
    type: "harness",
    capabilities: ["review.diff"],
    requiredServices: ["git"],
    permissions: {
      env: [],
      config: ["repositoryRoot"],
      filesystem: ["read"],
    },
    entrypoints: {
      run: "harness/review.js",
    },
    harness: {
      id: "repo-review",
      requiresCapabilities: ["shell.exec", "filesystem.read", "events.stream"],
      configSchema: {
        type: "object",
        required: ["repositoryRoot"],
      },
      lifecycleHooks: {
        prepare: "harness/prepare.js",
        run: "harness/review.js",
        cleanup: "harness/cleanup.js",
      },
      executionMode: "ephemeral",
      outputContract: "opencoven.events.v1",
    },
    artifacts: ["harness/review.js", "harness/prepare.js", "harness/cleanup.js"],
    tests: [{ name: "fixture", path: "examples/review-fixture.json" }],
  },
  artifacts: [
    "manifest.json",
    "harness/review.js",
    "harness/prepare.js",
    "harness/cleanup.js",
    "examples/review-fixture.json",
  ],
  files: {
    "harness/review.js": { size: 64, sha256: "b".repeat(64) },
    "harness/prepare.js": { size: 32, sha256: "c".repeat(64) },
    "harness/cleanup.js": { size: 32, sha256: "d".repeat(64) },
    "examples/review-fixture.json": JSON.stringify({ repositoryRoot: "." }),
  },
};

const oldRuntimePackage = {
  ...runtimePackage,
  manifest: {
    ...runtimePackage.manifest,
    version: "1.1.0",
    runtime: {
      ...runtimePackage.manifest.runtime,
      capabilities: ["shell.exec"],
    },
  },
};

const unsafeRuntimePackage = {
  ...runtimePackage,
  manifest: {
    ...runtimePackage.manifest,
    version: "2.0.0",
    runtime: {
      ...runtimePackage.manifest.runtime,
      sandbox: {
        network: "host",
        filesystem: "host",
      },
    },
  },
};

const runtimeValidation = validateSubmissionPackage(runtimePackage);
assert.equal(runtimeValidation.status, "pass");
assert.deepEqual(runtimeValidation.issues, []);

const harnessValidation = validateSubmissionPackage(harnessPackage, {
  runtimes: [runtimePackage.manifest],
});
assert.equal(harnessValidation.status, "pass");

const unsafeValidation = validateSubmissionPackage(unsafeRuntimePackage);
assert.equal(unsafeValidation.status, "review-required");
assert.ok(
  unsafeValidation.issues.some((issue) => issue.code === "runtime.policy.review"),
  "unsafe runtime sandbox declarations require OpenCoven review",
);

const incompatibleHarness = validateSubmissionPackage(
  {
    ...harnessPackage,
    manifest: {
      ...harnessPackage.manifest,
      harness: {
        ...harnessPackage.manifest.harness,
        requiresCapabilities: ["gpu.render"],
      },
    },
  },
  { runtimes: [runtimePackage.manifest] },
);
assert.equal(incompatibleHarness.status, "fail");
assert.ok(
  incompatibleHarness.issues.some((issue) => issue.code === "harness.runtime.incompatible"),
  "harnesses fail validation when no OpenCoven runtime provides required capabilities",
);

const missingExample = validateSubmissionPackage({
  ...harnessPackage,
  artifacts: ["manifest.json", "harness/review.js"],
});
assert.equal(missingExample.status, "fail");
assert.ok(
  missingExample.issues.some((issue) => issue.code === "package.examples.missing"),
  "examples/tests listed by the manifest must exist in the uploaded package",
);

const missingArtifactFile = validateSubmissionPackage({
  ...runtimePackage,
  files: {
    "examples/smoke.json": JSON.stringify({ prompt: "hello" }),
  },
});
assert.equal(missingArtifactFile.status, "fail");
assert.ok(
  missingArtifactFile.issues.some((issue) => issue.code === "package.file.missing"),
  "artifact paths must resolve to file entries inside the uploaded package",
);

const invalidExample = validateSubmissionPackage({
  ...runtimePackage,
  files: {
    "bin/coven-runtime": { size: 128, sha256: "a".repeat(64) },
    "examples/smoke.json": "{not json",
  },
});
assert.equal(invalidExample.status, "fail");
assert.ok(
  invalidExample.issues.some((issue) => issue.code === "package.examples.invalid"),
  "example files with JSON content must parse when examples are declared",
);

const catalog = catalogEntriesFromSubmissions([
  oldRuntimePackage.manifest,
  runtimePackage.manifest,
  harnessPackage.manifest,
]);
const runtimeEntry = catalog.find((entry) => entry.id === "runtime:local-coven");
assert.equal(runtimeEntry?.latestCompatibleVersion, "1.2.0");
assert.equal(runtimeEntry?.validationStatus, "pass");
assert.deepEqual(runtimeEntry?.capabilities, ["shell.exec", "filesystem.read", "events.stream"]);
assert.deepEqual(runtimeEntry?.examples.map((example) => example.path), ["examples/smoke.json"]);
assert.deepEqual(runtimeEntry?.docs, ["docs/runtime.md"]);

const harnessEntry = catalog.find((entry) => entry.id === "harness:repo-review");
assert.equal(harnessEntry?.enabled, true);
assert.equal(harnessEntry?.compatibleRuntimeIds?.[0], "local-coven");

const disabledCatalog = catalogEntriesFromSubmissions([harnessPackage.manifest]);
const disabledHarness = disabledCatalog.find((entry) => entry.id === "harness:repo-review");
assert.equal(disabledHarness?.enabled, false);
assert.deepEqual(disabledHarness?.compatibleRuntimeIds, []);

const route = resolveExecutionRoute({
  harnessId: "repo-review",
  runtimeId: "local-coven",
  catalog,
});
assert.equal(route.status, "ready");
assert.equal(route.harnessId, "repo-review");
assert.equal(route.runtimeId, "local-coven");
assert.equal(route.invocationAdapter, "stdio");
assert.deepEqual(route.platformServices, ["coven-daemon"]);

const unresolved = resolveExecutionRoute({
  harnessId: "repo-review",
  catalog: disabledCatalog,
});
assert.equal(unresolved.status, "disabled");
assert.match(unresolved.reason, /no compatible runtime/i);

const plan = buildExecutionPlan({
  harnessId: "repo-review",
  catalog,
  input: { repositoryRoot: "." },
});
assert.equal(plan.status, "ready");
assert.equal(plan.executionService, "opencoven.execution.v1");
assert.equal(plan.route.runtimeId, "local-coven");
assert.equal(plan.dispatch.adapter, "stdio");
assert.deepEqual(plan.dispatch.requiredCapabilities, ["shell.exec", "filesystem.read", "events.stream"]);
assert.deepEqual(plan.dispatch.input, { repositoryRoot: "." });

const disabledPlan = buildExecutionPlan({
  harnessId: "repo-review",
  catalog: disabledCatalog,
});
assert.equal(disabledPlan.status, "disabled");
assert.match(disabledPlan.reason, /no compatible runtime/i);

console.log("opencoven-submissions.test.ts: ok");
