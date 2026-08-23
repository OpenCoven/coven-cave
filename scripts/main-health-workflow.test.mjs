import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const source = await readFile(
  new URL("../.github/workflows/main-health.yml", import.meta.url),
  "utf8",
);
const workflow = parse(source);

assert.equal(workflow.name, "Main health");

// The whole point of the workflow is that it reports when nobody is watching,
// so the triggers are the contract. A workflow_run trigger alone would be one
// dropped delivery away from silence; the schedule is the backstop, and both
// converge on the same deduplicated issue.
assert.deepEqual(workflow.on, {
  workflow_run: { workflows: ["CI"], types: ["completed"] },
  schedule: [{ cron: "23 * * * *" }],
  workflow_dispatch: null,
});

// Issue writes are the only mutation this workflow is allowed to make. In
// particular it must never hold `contents: write` — it observes main, it does
// not repair it.
assert.deepEqual(workflow.permissions, {
  actions: "read",
  contents: "read",
  issues: "write",
});

assert.equal(workflow.concurrency.group, "main-health");
assert.equal(workflow.concurrency["cancel-in-progress"], false);

const assessJob = workflow.jobs.assess;
assert.equal(assessJob["runs-on"], "ubuntu-latest");
assert.equal(assessJob["timeout-minutes"], 5);

// A CI run on a pull-request head says nothing about main; without this guard
// every PR would file against whatever main happened to look like.
assert.match(assessJob.if, /github\.event\.workflow_run\.head_branch == 'main'/);
assert.match(assessJob.if, /github\.event\.workflow_run\.event == 'push'/);
assert.match(assessJob.if, /github\.event_name != 'workflow_run'/);
// A folded YAML scalar keeps the newline when a continuation line is indented
// further, and Actions would then evaluate an expression with a newline in it.
assert.ok(!assessJob.if.includes("\n"), "the job guard stays a single-line expression");

const checkout = assessJob.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
assert.ok(checkout, "the workflow checks out the tested assessment script");
assert.match(checkout.uses, /^actions\/checkout@[0-9a-f]{40}$/);
assert.equal(checkout.with.ref, "${{ github.event.repository.default_branch }}");
assert.equal(checkout.with["persist-credentials"], false);

const assessStep = assessJob.steps.find((step) =>
  step.run?.includes("scripts/main-health.mjs"),
);
assert.ok(assessStep, "the workflow runs the assessment script");
assert.match(assessStep.run, /node scripts\/main-health\.mjs --apply/);
assert.equal(assessStep.env.GITHUB_TOKEN, "${{ github.token }}");
assert.equal(assessStep.env.GITHUB_REPOSITORY, "${{ github.repository }}");
assert.equal(assessStep.env.GITHUB_API_URL, "${{ github.api_url }}");

// scripts/main-health.mjs is dependency-free so this job can skip the install.
// An install step would put a lockfile failure between a red main and its only
// signal, and it would silently start passing if an import crept in.
assert.ok(
  !assessJob.steps.some((step) => step.run?.includes("pnpm install")),
  "the assessment job installs nothing",
);
const script = await readFile(new URL("./main-health.mjs", import.meta.url), "utf8");
const imports = [...script.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map(
  (match) => match[1],
);
assert.deepEqual(
  imports.filter((specifier) => !specifier.startsWith("node:")),
  [],
  "scripts/main-health.mjs imports only the Node standard library",
);
