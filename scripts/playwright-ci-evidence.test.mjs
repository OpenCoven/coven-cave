import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { plannedPlaywrightCases, runPlaywrightWithEvidence, verifyPlaywrightEvidence } from "./playwright-ci-evidence.mjs";

function report(cases) {
  const stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const specs = cases.map(({ id, outcome = "expected", results = [{ status: "passed", retry: 0 }], project = "desktop" }) => {
    stats[outcome]++;
    return { id, tests: [{ projectId: project, status: outcome, results }] };
  });
  return { errors: [], suites: [{ specs }], stats };
}
const plan = ids => report(ids.map(id => ({ id, outcome: "skipped", results: [] })));

test("empty and malformed collection cannot qualify a shard", () => {
  assert.throws(() => plannedPlaywrightCases(plan([])), /zero tests/);
  for (const value of [{}, { suites: [], errors: ["collection failed"] }])
    assert.throws(() => plannedPlaywrightCases(value));
  const inconsistent = plan(["one"]); inconsistent.stats.skipped = 0;
  assert.throws(() => plannedPlaywrightCases(inconsistent), /count/);
});

test("declared identities must match, even when both reports have the same count", () => {
  assert.throws(() => verifyPlaywrightEvidence(plan(["one"]), report([{ id: "other" }])), /identities/);
  assert.throws(() => verifyPlaywrightEvidence(plan(["one", "two"]), report([{ id: "one" }])), /identities/);
  assert.throws(() => plannedPlaywrightCases(plan(["one", "one"])), /Duplicate/);
});

test("listed, wholly skipped and interrupted cases cannot become executed coverage", () => {
  assert.throws(() => verifyPlaywrightEvidence(plan(["one"]), plan(["one"])), /zero executed/);
  assert.throws(() => verifyPlaywrightEvidence(plan(["one"]), report([{ id: "one", results: [] }])), /no execution/);
  assert.throws(() => verifyPlaywrightEvidence(plan(["one"]), report([{ id: "one", results: [{ status: "interrupted", retry: 0 }] }])), /interrupted/);
});

test("skips and retries are recorded without changing the existing flaky-test policy", () => {
  const result = verifyPlaywrightEvidence(plan(["pass", "skip", "flake"]), report([
    { id: "pass" }, { id: "skip", outcome: "skipped", results: [] },
    { id: "flake", outcome: "flaky", results: [{ status: "failed", retry: 0 }, { status: "passed", retry: 1 }] },
  ]));
  const { identitySha256, ...counts } = result;
  assert.deepEqual(counts, { planned: 3, executed: 2, expected: 1, unexpected: 0, flaky: 1, skipped: 1, attempts: 3, retries: 1 });
  assert.match(identitySha256, /^[a-f0-9]{64}$/);
  const ordered = verifyPlaywrightEvidence(plan(["two", "one"]), report([{ id: "one" }, { id: "two" }]));
  const reversed = verifyPlaywrightEvidence(plan(["one", "two"]), report([{ id: "two" }, { id: "one" }]));
  assert.equal(ordered.identitySha256, reversed.identitySha256, "receipt identity is independent of reporting order");
  assert.notEqual(ordered.identitySha256, verifyPlaywrightEvidence(plan(["one", "other"]), report([{ id: "one" }, { id: "other" }])).identitySha256);
  assert.throws(() => verifyPlaywrightEvidence(plan(["one"]), report([{ id: "one", outcome: "unexpected", results: [{ status: "failed", retry: 0 }] }])), /unexpected/);
});

test("missing reports and nonzero child exits fail closed; earlier evidence stays intact", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pw-evidence-contract-"));
  try {
    const run = (mode, exit = 0) => runPlaywrightWithEvidence([], { root, runner(args, env) {
      const collecting = args.includes("--list");
      if (collecting || mode !== "missing") writeFileSync(env.PLAYWRIGHT_JSON_OUTPUT_NAME,
        JSON.stringify(collecting ? plan(["one"]) : report([{ id: "one" }])));
      return { status: collecting ? 0 : exit, signal: null };
    } });
    const missing = run("missing");
    assert.equal(missing.status, 1); assert.match(missing.summary.error, /Missing or invalid/);
    const failure = run("valid", 17);
    assert.equal(failure.status, 17); assert.equal(failure.summary.executionExit.status, 17);
    const success = run("valid");
    assert.equal(success.status, 0);
    assert.notEqual(missing.directory, success.directory);
    assert.equal(JSON.parse(readFileSync(path.join(missing.directory, "summary.json"))).passed, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the pinned real Playwright runner's zero-test success is refused before execution", () => {
  const require = createRequire(import.meta.url);
  const root = mkdtempSync(path.join(tmpdir(), "pw-evidence-real-"));
  try {
    const config = path.join(root, "playwright.config.cjs");
    writeFileSync(config, 'module.exports={testDir:__dirname,testMatch:"*.spec.cjs",fullyParallel:true,workers:1};\n');
    const imported = JSON.stringify(require.resolve("@playwright/test"));
    writeFileSync(path.join(root, "one.spec.cjs"), `const {test}=require(${imported});test('one',()=>{});\n`);
    writeFileSync(path.join(root, "skip.spec.cjs"), `const {test}=require(${imported});test.skip('skipped',()=>{});\n`);
    const cli = path.join(path.dirname(require.resolve("@playwright/test/package.json")), "cli.js");
    let executions = 0;
    const runner = (args, env) => {
      if (!args.includes("--list")) executions++;
      return spawnSync(process.execPath, [cli, "test", "--config", config, ...args], {
        env: { ...env, CI: "true" }, encoding: "utf8",
      });
    };
    const rawFile = path.join(root, "raw-empty.json");
    const raw = runner(["one.spec.cjs", "--shard=2/2", "--reporter=json"], { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: rawFile });
    assert.equal(raw.status, 0, raw.stderr);
    assert.equal(JSON.parse(readFileSync(rawFile)).suites.length, 0);
    executions = 0;
    const empty = runPlaywrightWithEvidence(["one.spec.cjs", "--shard=2/2"], { root, runner });
    assert.equal(empty.status, 1); assert.match(empty.summary.error, /zero tests/);
    assert.equal(empty.summary.planned, 0);
    assert.equal(executions, 0, "an empty shard must not start its server");
    const positive = runPlaywrightWithEvidence(["one.spec.cjs"], { root, runner });
    assert.equal(positive.status, 0, positive.summary.error);
    assert.equal(positive.summary.counts.executed, 1);
    const skipped = runPlaywrightWithEvidence(["skip.spec.cjs"], { root, runner });
    assert.equal(skipped.status, 1); assert.match(skipped.summary.error, /zero executed/);
    assert.equal(skipped.summary.counts.executed, 0);
    assert.equal(skipped.summary.counts.skipped, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("callers cannot turn the execution phase into a list-only or alternate-reporter invocation", () => {
  for (const args of [["--list"], ["--reporter=json"], ["--reporter", "null"]])
    assert.throws(() => runPlaywrightWithEvidence(args), /owns --list and --reporter/);
});

test("a checker copied from the workflow revision still runs the candidate checkout", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pw-evidence-old-ref-"));
  try {
    const candidate = path.join(root, "candidate");
    const tools = path.join(root, "tools");
    mkdirSync(path.join(candidate, "scripts"), { recursive: true });
    mkdirSync(tools);
    const checker = path.join(tools, "checker.mjs");
    writeFileSync(checker, readFileSync(new URL("./playwright-ci-evidence.mjs", import.meta.url)));
    writeFileSync(path.join(candidate, "scripts/playwright-ci-image.sh"), `#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *" --list "*) outcome=skipped; results='[]'; stats='{"expected":0,"unexpected":0,"flaky":0,"skipped":1}' ;;
  *) outcome=expected; results='[{"status":"passed","retry":0}]'; stats='{"expected":1,"unexpected":0,"flaky":0,"skipped":0}' ;;
esac
printf '{"errors":[],"suites":[{"specs":[{"id":"one","tests":[{"projectId":"","status":"%s","results":%s}]}]}],"stats":%s}\\n' "$outcome" "$results" "$stats" > "$PLAYWRIGHT_JSON_OUTPUT_NAME"
`);
    const result = spawnSync(process.execPath, [checker], { cwd: candidate, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"executed":1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
