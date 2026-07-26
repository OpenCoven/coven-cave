import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const source = await readFile(
  new URL("../.github/workflows/branch-cap.yml", import.meta.url),
  "utf8",
);
const workflow = parse(source);

assert.equal(workflow.name, "Enforce repository branch cap");
assert.deepEqual(workflow.on, { create: null }, "only new refs trigger cap enforcement");
assert.deepEqual(workflow.permissions, { contents: "write" });

const job = workflow.jobs.enforce;
assert.equal(job.if, "github.event.ref_type == 'branch'");
assert.equal(job["runs-on"], "ubuntu-latest");
assert.equal(job["timeout-minutes"], 2);

const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
assert.ok(checkout, "workflow checks out the enforcement script");
assert.match(
  checkout.uses,
  /^actions\/checkout@[0-9a-f]{40}$/,
  "checkout stays pinned to a full commit SHA",
);
assert.equal(
  checkout.with.ref,
  "${{ github.event.repository.default_branch }}",
  "an untrusted created branch cannot replace its own enforcement code",
);
assert.equal(checkout.with["persist-credentials"], false);

const enforcement = job.steps.find((step) => step.name === "Enforce 40-branch cap");
assert.ok(enforcement, "workflow executes the tested enforcement module");
assert.equal(enforcement.env.MAX_BRANCHES, "40");
assert.equal(enforcement.env.CREATED_BRANCH, "${{ github.event.ref }}");
assert.equal(enforcement.env.DEFAULT_BRANCH, "${{ github.event.repository.default_branch }}");
assert.equal(enforcement.env.GITHUB_API_URL, "${{ github.api_url }}");
assert.equal(enforcement.env.GITHUB_TOKEN, "${{ github.token }}");
assert.match(
  enforcement.run,
  /if \[\[ ! -f scripts\/enforce-branch-cap\.mjs \]\]; then/,
  "the workflow allows only its one-time pre-merge bootstrap when main lacks the module",
);
assert.match(enforcement.run, /node scripts\/enforce-branch-cap\.mjs/);

console.log("branch-cap-workflow.test.mjs: ok");
