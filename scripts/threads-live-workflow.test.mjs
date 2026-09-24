import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/threads-live-acceptance.yml", import.meta.url), "utf8"));
assert.ok(workflow.on.schedule.length, "stability collection needs a schedule");
assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
assert.deepEqual(workflow.permissions, { contents: "read" });
assert.equal(workflow.concurrency, undefined, "manual dispatch must not replace a pending scheduled observation");
const job = workflow.jobs.acceptance;
assert.deepEqual(job.strategy.matrix.browser, ["chromium", "firefox", "webkit"]);
assert.equal(job.strategy["fail-fast"], false, "one failing lane must not erase the others");
assert.equal(job["continue-on-error"], undefined);
for (const step of job.steps) {
  assert.equal(step["continue-on-error"], undefined, "failures remain visible");
  if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/, "actions are immutable");
  if (step.run) {
    const syntax = spawnSync("bash", ["-n"], { input: step.run, encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
}
const source = job.steps.find(step => step.name === "Prepare exact Coven source");
assert.match(source.run, /compatibility\.json/);
assert.match(source.run, /test "\$\(git -C "\$source_dir" rev-parse HEAD\)" = "\$pin"/);
assert.match(source.run, /\$RUNNER_TEMP\/coven-source/, "producer checkout stays outside audited Cave source");
const run = job.steps.find(step => step.name === "Run first-attempt journeys");
assert.match(run.run, /--config playwright\.threads-live\.config\.ts --retries=0$/);
const identityIndex = job.steps.findIndex(step => step.name === "Record invocation identity");
assert.ok(identityIndex < job.steps.findIndex(step => step.run === "pnpm install --frozen-lockfile"), "setup failures retain an invocation identity");
const upload = job.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
assert.equal(upload.if, "always()");
assert.equal(upload.with["if-no-files-found"], "error");
assert.ok(upload.with["retention-days"] >= 30);
assert.match(upload.with.name, /github\.run_attempt/);
assert.deepEqual(upload.with.path.trim().split("\n"), ["test-results/threads-live-daemon", "test-results/threads-live-metadata"], "only sanitized evidence is uploaded, never raw temporary homes");
console.log("Threads scheduled acceptance safety contracts passed");
