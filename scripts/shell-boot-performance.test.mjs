import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertIsolatedPerformanceBuild } from "./browser-performance-launch.mjs";
import { buildShellInvocation, parseShellArguments } from "./run-shell-performance.mjs";
import { buildStreamInvocation } from "./run-stream-performance.mjs";
import {
  daemonConnectionPayload,
  evaluateShellBootPerformance,
  shellBootControlStallMs,
  shellBootLimitMs,
  SHELL_BOOT_PERFORMANCE_PROFILE,
} from "../tests/fixtures/shell-boot-performance.ts";
import { PERFORMANCE_BUDGETS } from "../src/lib/performance-budgets.ts";
import { classifyDaemonStatusPoll } from "../src/lib/daemon-status-classification.ts";
import { verifyShellControl } from "./verify-shell-control.mjs";

function samples(mode = "warm", interactiveMs = 1_000) {
  return Array.from({ length: 100 }, (_, index) => ({
    index, mode, complete: true, hydrated: true, typedMatches: true,
    daemonPolls: 1, daemonRunning: mode === "warm", externalBlocked: 0, interactiveMs,
  }));
}

test("the ceilings are the catalogue's two approved shell deadlines, read rather than restated", () => {
  for (const mode of SHELL_BOOT_PERFORMANCE_PROFILE.modes) {
    const budget = PERFORMANCE_BUDGETS.find(entry => entry.id === `shell.${mode}-boot.p95-ms`);
    assert.equal(shellBootLimitMs(mode), budget.limit);
    assert.equal(budget.gate, "browser-performance");
    assert.equal(budget.source, "tests/shell-boot-performance.spec.ts");
  }
  assert.equal(shellBootLimitMs("warm"), 3_000);
  assert.equal(shellBootLimitMs("offline"), 5_000);
  assert.equal(shellBootControlStallMs("warm"), 3_500);
  assert.equal(shellBootControlStallMs("offline"), 5_500);
});

test("the daemon poll each mode serves classifies as the shell state the budget names", () => {
  const classify = payload => classifyDaemonStatusPoll({ responseStatus: 200, responseOk: true, payload });
  assert.deepEqual(classify(daemonConnectionPayload("warm")), { kind: "running", targetMode: "local" });
  assert.deepEqual(classify(daemonConnectionPayload("offline")), { kind: "offline", targetMode: "local" });
});

test("100 complete trials at the ceiling pass with the measured percentiles", () => {
  const result = evaluateShellBootPerformance("warm", samples("warm", 3_000));
  assert.equal(result.pass, true);
  assert.equal(result.p95Ms, 3_000);
  assert.equal(result.medianMs, 3_000);
  assert.equal(result.maximumMs, 3_000);
  assert.deepEqual(result.failures, []);
});

test("six slow trials breach p95 while five only move the reported maximum", () => {
  const five = samples("offline", 100);
  for (let index = 0; index < 5; index++) five[index].interactiveMs = 5_001;
  assert.equal(evaluateShellBootPerformance("offline", five).pass, true);
  assert.equal(evaluateShellBootPerformance("offline", five).maximumMs, 5_001);
  five[5].interactiveMs = 5_001;
  const result = evaluateShellBootPerformance("offline", five);
  assert.equal(result.pass, false);
  assert.equal(result.p95Ms, 5_001);
  assert.ok(result.failures.some(reason => reason.includes("5000")));
});

test("shuffled trial order keeps the same percentile without mutating input", () => {
  const input = samples().map((sample, index) => ({ ...sample, interactiveMs: 100 - index }));
  const original = structuredClone(input);
  const result = evaluateShellBootPerformance("warm", input);
  assert.equal(result.p95Ms, 95);
  assert.equal(result.medianMs, 50);
  assert.equal(result.maximumMs, 100);
  assert.deepEqual(input, original);
});

test("missing, excess, duplicated, and invalid trial identities cannot claim a distribution", () => {
  for (const input of [
    undefined, null, {}, [], samples().slice(1), [...samples(), samples()[0]],
    samples().map((sample, index) => index === 99 ? { ...sample, index: 0 } : sample),
    samples().map((sample, index) => index === 99 ? { ...sample, index: 100 } : sample),
    samples().map((sample, index) => index === 99 ? { ...sample, index: 0.5 } : sample),
  ]) {
    const result = evaluateShellBootPerformance("warm", input);
    assert.equal(result.pass, false);
    assert.equal(result.p95Ms, null);
    assert.ok(result.failures.length > 0);
  }
});

test("one incomplete semantic observation fails even far below the ceiling", () => {
  for (const patch of [
    { complete: false }, { hydrated: false }, { typedMatches: false },
    { daemonPolls: 0 }, { daemonPolls: 1.5 }, { daemonRunning: false },
    { externalBlocked: -1 }, { externalBlocked: 0.5 },
    { mode: "offline" }, { interactiveMs: NaN }, { interactiveMs: Infinity },
    { interactiveMs: -1 }, { interactiveMs: undefined }, { complete: undefined },
  ]) {
    const input = samples("warm", 10);
    input[40] = { ...input[40], ...patch };
    const result = evaluateShellBootPerformance("warm", input);
    assert.equal(result.pass, false, JSON.stringify(patch));
    assert.equal(result.p95Ms, null);
  }
  // The offline mode requires the offline poll, not the running one.
  const offline = samples("offline", 10);
  offline[3] = { ...offline[3], daemonRunning: true };
  assert.equal(evaluateShellBootPerformance("offline", offline).pass, false);
});

test("a fast warm distribution cannot conceal a slow offline one or an unknown mode", () => {
  assert.equal(evaluateShellBootPerformance("warm", samples("warm", 10)).pass, true);
  assert.equal(evaluateShellBootPerformance("offline", samples("offline", 5_500)).pass, false);
  assert.equal(evaluateShellBootPerformance("cold", samples("cold", 10)).pass, false);
  assert.equal(evaluateShellBootPerformance("warm", samples("offline", 10)).pass, false);
});

test("the launcher refuses workload overrides and only accepts the explicit failing control", () => {
  assert.deepEqual(parseShellArguments([]), { control: false });
  assert.deepEqual(parseShellArguments(["--control"]), { control: true });
  for (const args of [["--trials=1"], ["--retries=1"], ["--control", "--control"], ["--unknown"]]) {
    assert.throws(() => parseShellArguments(args));
  }
});

test("the shell invocation strips credentials and injection exactly as the stream one does", () => {
  const sourceEnv = {
    PATH: "/bin", HOME: "/browser-cache-home", CI: "1", COVEN_CAVE_PORT: "3199",
    GITHUB_TOKEN: "private", OPENAI_API_KEY: "private", NODE_OPTIONS: "--require=untrusted.cjs",
    COVEN_HOME: "/real/coven", COVEN_CAVE_ENV_FILE: "/real/.env",
    CAVE_SHELL_CONTROL: "1", CAVE_SHELL_PERFORMANCE: "0", CAVE_STREAM_PERFORMANCE: "1",
  };
  const shell = buildShellInvocation({
    sourceEnv, stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts", control: false,
  });
  const stream = buildStreamInvocation({
    sourceEnv, stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts", control: false,
  });
  assert.equal(shell.env.HOME, "/browser-cache-home");
  assert.equal(shell.env.COVEN_CAVE_PORT, "3199");
  assert.equal(shell.env.CAVE_SHELL_PERFORMANCE, "1");
  assert.equal(shell.env.CAVE_SHELL_CONTROL, "0");
  assert.equal(shell.env.CAVE_SHELL_STATE_ROOT, "/synthetic/state");
  assert.equal(shell.env.CAVE_SHELL_ARTIFACT_ROOT, "/synthetic/artifacts");
  for (const key of ["GITHUB_TOKEN", "OPENAI_API_KEY", "NODE_OPTIONS", "COVEN_HOME",
    "COVEN_CAVE_ENV_FILE", "CAVE_STREAM_PERFORMANCE", "CAVE_STREAM_STATE_ROOT"]) {
    assert.equal(shell.env[key], undefined, key);
  }
  // Same allowlist, same CLI flags; only the spec and the gate's own flags differ.
  const allowlisted = env => Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("CAVE_")));
  assert.deepEqual(allowlisted(shell.env), allowlisted(stream.env));
  assert.deepEqual(shell.args.filter(arg => !arg.endsWith(".spec.ts")), stream.args.filter(arg => !arg.endsWith(".spec.ts")));
  assert.ok(shell.args.includes("tests/shell-boot-performance.spec.ts"));
  assert.ok(stream.args.includes("tests/chat-stream-performance.spec.ts"));
  assert.ok(shell.args.includes("--retries=0"));
  assert.ok(shell.args.includes("--workers=1"));
  assert.ok(shell.args.includes("--no-deps"));
  assert.equal(shell.env.PLAYWRIGHT_JSON_OUTPUT_FILE, "/synthetic/artifacts/playwright.json");
  assert.equal(buildShellInvocation({
    sourceEnv: {}, stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts", control: true,
  }).env.CAVE_SHELL_CONTROL, "1");
});

const controlHead = "a".repeat(40);
function controlEvidence() {
  const reports = SHELL_BOOT_PERFORMANCE_PROFILE.modes.map(mode => {
    const trials = samples(mode, 100).map(sample => ({
      ...sample, cleanup: true,
      interactiveMs: sample.index < SHELL_BOOT_PERFORMANCE_PROFILE.controlTrials ? shellBootControlStallMs(mode) : 100,
    }));
    return {
      mode, control: true, samples: trials,
      invocation: { invocationId: "synthetic-control", head: controlHead, dirty: false, control: true },
      verdict: evaluateShellBootPerformance(mode, trials),
    };
  });
  const runner = {
    errors: [], stats: { expected: 0, unexpected: 2, skipped: 0, flaky: 0 },
    suites: [{ specs: reports.map(report => ({ tests: [{
      results: [{ status: "failed", errors: [{ message: `Error: ${JSON.stringify(report.verdict)}\n` }] }],
    }] })) }],
  };
  return { reports, runner };
}

test("control verification accepts only complete latency failures from the expected clean head", () => {
  const { reports, runner } = controlEvidence();
  const verified = verifyShellControl(1, reports, runner, controlHead);
  assert.deepEqual(verified.map(entry => entry.mode), ["warm", "offline"]);
  assert.ok(verified.every(entry => entry.p95Ms > shellBootLimitMs(entry.mode)));
  for (const mutate of [
    evidence => { evidence.exitCode = 0; },
    evidence => { evidence.exitCode = 2; },
    evidence => { evidence.reports.pop(); },
    evidence => { evidence.reports[1] = evidence.reports[0]; },
    evidence => { evidence.reports[0].invocation.head = "b".repeat(40); },
    evidence => { evidence.reports[0].invocation.dirty = true; },
    evidence => { evidence.reports[0].invocation.invocationId = "another-run"; },
    evidence => { evidence.reports[0].control = false; },
    evidence => { evidence.reports[0].samples[50].typedMatches = false; },
    evidence => { evidence.reports[0].samples[50].cleanup = false; },
    evidence => { evidence.reports[0].samples[50].error = "unexpected error"; },
    evidence => { evidence.reports[0].samples.pop(); },
    evidence => { evidence.reports[0].samples[0].interactiveMs = 100; },
    evidence => { evidence.runner.errors.push({ message: "server cleanup failed" }); },
    evidence => { evidence.runner.stats.skipped = 1; },
    evidence => { evidence.runner.suites[0].specs[0].tests[0].results[0].status = "timedOut"; },
    evidence => { evidence.runner.suites[0].specs[0].tests[0].results[0].errors[0].message = "browser crashed"; },
  ]) {
    const evidence = { exitCode: 1, ...controlEvidence() };
    mutate(evidence);
    assert.throws(() => verifyShellControl(
      evidence.exitCode, evidence.reports, evidence.runner, controlHead,
    ));
  }
});

test("a build with local dotenv files is refused without reading or modifying them", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "shell-env-test-"));
  try {
    assert.doesNotThrow(() => assertIsolatedPerformanceBuild(directory));
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      const file = path.join(directory, name);
      writeFileSync(file, "DO_NOT_READ=synthetic\n");
      assert.throws(() => assertIsolatedPerformanceBuild(directory), /dotenv/);
      rmSync(file);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
