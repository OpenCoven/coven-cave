import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildDoctorInvocation, controlWrapperSource, parseDoctorArguments, resolveCovenBinary,
} from "./run-doctor-performance.mjs";
import { buildShellInvocation } from "./run-shell-performance.mjs";
import {
  doctorExecControlStallMs,
  doctorExecLimitMs,
  evaluateDoctorExecPerformance,
  isDoctorExecEvidence,
  DOCTOR_EXEC_PERFORMANCE_PROFILE,
} from "../tests/fixtures/doctor-exec-performance.ts";
import { PERFORMANCE_BUDGETS } from "../src/lib/performance-budgets.ts";
import { verifyDoctorControl } from "./verify-doctor-control.mjs";

function samples(wallMs = 100, command = "doctor") {
  return Array.from({ length: 100 }, (_, index) => ({
    index, command, complete: true, status: 200, correlated: true, ok: false, exitCode: 1,
    timedOut: false, stdoutBytes: 1_200, stderrBytes: 0, wallMs,
  }));
}

test("the ceiling is the catalogue's doctor deadline, which is pinned to the exec route's timeout", () => {
  const budget = PERFORMANCE_BUDGETS.find(entry => entry.id === "cli.doctor.p95-ms");
  assert.equal(doctorExecLimitMs("doctor"), budget.limit);
  assert.equal(budget.gate, "browser-performance");
  assert.equal(budget.source, "tests/doctor-exec-performance.spec.ts");
  assert.equal(budget.derivedFrom, "src/app/api/coven/exec/route.ts (EXEC_TIMEOUT_MS)");
  const route = readFileSync(new URL("../src/app/api/coven/exec/route.ts", import.meta.url), "utf8");
  const declared = /const EXEC_TIMEOUT_MS = ([0-9_]+);/.exec(route);
  assert.ok(declared, "the exec route declares EXEC_TIMEOUT_MS");
  assert.equal(doctorExecLimitMs("doctor"), Number(declared[1].replaceAll("_", "")));
  assert.equal(doctorExecLimitMs("doctor"), 6_000);
  assert.equal(doctorExecControlStallMs("doctor"), 6_500);
});

test("100 complete trials at the ceiling pass with the measured percentiles", () => {
  const result = evaluateDoctorExecPerformance("doctor", samples(6_000));
  assert.equal(result.pass, true);
  assert.equal(result.p95Ms, 6_000);
  assert.equal(result.medianMs, 6_000);
  assert.equal(result.maximumMs, 6_000);
  assert.deepEqual(result.failures, []);
});

test("six slow trials breach p95 while five only move the reported maximum", () => {
  const five = samples(100);
  for (let index = 0; index < 5; index++) five[index].wallMs = 6_001;
  assert.equal(evaluateDoctorExecPerformance("doctor", five).pass, true);
  assert.equal(evaluateDoctorExecPerformance("doctor", five).maximumMs, 6_001);
  five[5].wallMs = 6_001;
  const result = evaluateDoctorExecPerformance("doctor", five);
  assert.equal(result.pass, false);
  assert.equal(result.p95Ms, 6_001);
  assert.ok(result.failures.some(reason => reason.includes("6000")));
});

test("a route timeout is evidence of the ceiling firing, graded by its wall clock, never a spawn failure", () => {
  const timedOut = { ...samples()[0], status: 504, ok: false, exitCode: null, timedOut: true, stdoutBytes: 0, wallMs: 6_020 };
  assert.equal(isDoctorExecEvidence(timedOut, "doctor"), true);
  const input = samples(100);
  for (let index = 0; index < 6; index++) input[index] = { ...timedOut, index };
  const result = evaluateDoctorExecPerformance("doctor", input);
  assert.equal(result.pass, false);
  assert.equal(result.p95Ms, 6_020);
  // A CLI that could not be spawned answers 500 in a few milliseconds; that
  // must never read as a fast doctor.
  const spawnFailure = { ...samples()[0], status: 500, ok: false, exitCode: null, stdoutBytes: 0, wallMs: 4 };
  assert.equal(isDoctorExecEvidence(spawnFailure, "doctor"), false);
});

test("shuffled trial order keeps the same percentile without mutating input", () => {
  const input = samples().map((sample, index) => ({ ...sample, wallMs: 100 - index }));
  const original = structuredClone(input);
  const result = evaluateDoctorExecPerformance("doctor", input);
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
    const result = evaluateDoctorExecPerformance("doctor", input);
    assert.equal(result.pass, false);
    assert.equal(result.p95Ms, null);
    assert.ok(result.failures.length > 0);
  }
});

test("one trial that did not prove the CLI ran fails even far below the ceiling", () => {
  for (const patch of [
    { complete: false }, { correlated: false }, { status: 500 }, { status: 200, exitCode: null },
    { stdoutBytes: 0, stderrBytes: 0 }, { ok: true }, { exitCode: 0 }, { exitCode: 1.5 },
    { timedOut: true }, { timedOut: true, status: 504 }, { timedOut: "yes" },
    { stdoutBytes: -1 }, { stderrBytes: 0.5 }, { command: "daemon" },
    { wallMs: NaN }, { wallMs: Infinity }, { wallMs: -1 }, { wallMs: undefined }, { complete: undefined },
  ]) {
    const input = samples(10);
    input[40] = { ...input[40], ...patch };
    const result = evaluateDoctorExecPerformance("doctor", input);
    assert.equal(result.pass, false, JSON.stringify(patch));
    assert.equal(result.p95Ms, null, JSON.stringify(patch));
  }
  // A doctor that exits 0 is evidence too; the budget grades the clock.
  const healthy = samples(10).map(sample => ({ ...sample, ok: true, exitCode: 0 }));
  assert.equal(evaluateDoctorExecPerformance("doctor", healthy).pass, true);
});

test("an unknown command or a mismatched sample command cannot pass", () => {
  assert.equal(evaluateDoctorExecPerformance("daemon", samples(10, "daemon")).pass, false);
  assert.equal(evaluateDoctorExecPerformance("doctor", samples(10, "daemon")).pass, false);
});

test("the launcher refuses workload overrides and only accepts the explicit failing control", () => {
  assert.deepEqual(parseDoctorArguments([]), { control: false });
  assert.deepEqual(parseDoctorArguments(["--control"]), { control: true });
  for (const args of [["--trials=1"], ["--retries=1"], ["--control", "--control"], ["--unknown"]]) {
    assert.throws(() => parseDoctorArguments(args));
  }
});

test("the binary under measurement must be named absolutely and exist; PATH discovery is refused", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "doctor-bin-test-"));
  try {
    const binary = path.join(directory, "coven.js");
    writeFileSync(binary, "#!/usr/bin/env node\n");
    assert.equal(resolveCovenBinary({ COVEN_BIN: binary }), binary);
    assert.equal(resolveCovenBinary({ COVEN_BIN: `  ${binary}  ` }), binary);
    for (const env of [{}, { COVEN_BIN: "" }, { COVEN_BIN: "coven" }, { COVEN_BIN: "node_modules/.bin/coven" },
      { COVEN_BIN: path.join(directory, "missing.js") }, { COVEN_BIN: directory }]) {
      assert.throws(() => resolveCovenBinary(env), JSON.stringify(env));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the doctor invocation strips credentials like the other gates and passes only the chosen binary", () => {
  const sourceEnv = {
    PATH: "/bin", HOME: "/browser-cache-home", CI: "1", COVEN_CAVE_PORT: "3199",
    GITHUB_TOKEN: "private", OPENAI_API_KEY: "private", NODE_OPTIONS: "--require=untrusted.cjs",
    COVEN_HOME: "/real/coven", COVEN_CAVE_ENV_FILE: "/real/.env", COVEN_BIN: "/not/the/one/the/launcher/resolved",
    CAVE_DOCTOR_CONTROL: "1", CAVE_SHELL_PERFORMANCE: "1", CAVE_DOCTOR_CONTROL_MARKER: "/stale/marker",
  };
  const base = { sourceEnv, stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts", covenBin: "/pinned/coven.js" };
  const doctor = buildDoctorInvocation({ ...base, control: false });
  const shell = buildShellInvocation({ sourceEnv, stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts", control: false });
  assert.equal(doctor.env.COVEN_BIN, "/pinned/coven.js", "the resolved binary, never the source environment's");
  assert.equal(doctor.env.CAVE_DOCTOR_PERFORMANCE, "1");
  assert.equal(doctor.env.CAVE_DOCTOR_CONTROL, "0");
  assert.equal(doctor.env.CAVE_DOCTOR_STATE_ROOT, "/synthetic/state");
  assert.equal(doctor.env.CAVE_DOCTOR_ARTIFACT_ROOT, "/synthetic/artifacts");
  assert.equal(doctor.env.CAVE_DOCTOR_CONTROL_MARKER, undefined, "no marker outside the control");
  for (const key of ["GITHUB_TOKEN", "OPENAI_API_KEY", "NODE_OPTIONS", "COVEN_HOME", "COVEN_CAVE_ENV_FILE",
    "CAVE_SHELL_PERFORMANCE", "CAVE_SHELL_STATE_ROOT"]) {
    assert.equal(doctor.env[key], undefined, key);
  }
  const allowlisted = env => Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("CAVE_") && key !== "COVEN_BIN"));
  assert.deepEqual(allowlisted(doctor.env), allowlisted(shell.env));
  assert.deepEqual(doctor.args.filter(arg => !arg.endsWith(".spec.ts")), shell.args.filter(arg => !arg.endsWith(".spec.ts")));
  assert.ok(doctor.args.includes("tests/doctor-exec-performance.spec.ts"));
  assert.ok(shell.env.COVEN_BIN === undefined, "the shell gate never receives a CLI");
  const control = buildDoctorInvocation({ ...base, control: true, covenBin: "/synthetic/state/wrapper.js", controlMarker: "/synthetic/state/stall" });
  assert.equal(control.env.CAVE_DOCTOR_CONTROL, "1");
  assert.equal(control.env.CAVE_DOCTOR_CONTROL_MARKER, "/synthetic/state/stall");
  assert.equal(control.env.COVEN_BIN, "/synthetic/state/wrapper.js");
  assert.throws(() => buildDoctorInvocation({ ...base, control: false, covenBin: "coven" }));
});

test("the control wrapper stalls past the ceiling only while the marker exists, then runs the real CLI", () => {
  const source = controlWrapperSource({ realBinary: "/pinned/coven.js", marker: "/state/stall", stallMs: 6_500 });
  assert.ok(source.startsWith("#!/usr/bin/env node\n"), "executable as COVEN_BIN");
  assert.match(source, /const MARKER = "\/state\/stall";/);
  assert.match(source, /const STALL_MS = 6500;/);
  assert.match(source, /if \(existsSync\(MARKER\)\) Atomics\.wait/);
  assert.match(source, /spawnSync\(process\.execPath, \[REAL, \.\.\.process\.argv\.slice\(2\)\]/, "a .js binary runs under node");
  assert.match(source, /process\.exit\(result\.status \?\? 1\)/, "the real exit code is preserved");
  const native = controlWrapperSource({ realBinary: "/pinned/coven", marker: "/state/stall", stallMs: 6_500 });
  assert.match(native, /spawnSync\(REAL, process\.argv\.slice\(2\)/);
});

const controlHead = "a".repeat(40);
function controlEvidence() {
  const trials = samples(100).map(sample => sample.index < DOCTOR_EXEC_PERFORMANCE_PROFILE.controlTrials
    ? { ...sample, status: 504, ok: false, exitCode: null, timedOut: true, stdoutBytes: 0, wallMs: 6_030, cleanup: true }
    : { ...sample, cleanup: true });
  const report = {
    command: "doctor", control: true, samples: trials,
    invocation: { invocationId: "synthetic-control", head: controlHead, dirty: false, control: true },
    verdict: evaluateDoctorExecPerformance("doctor", trials),
  };
  const runner = {
    errors: [], stats: { expected: 0, unexpected: 1, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ tests: [{
      results: [{ status: "failed", errors: [{ message: `Error: ${JSON.stringify(report.verdict)}\n` }] }],
    }] }] }],
  };
  return { reports: [report], runner };
}

test("control verification accepts only complete latency failures from the expected clean head", () => {
  const { reports, runner } = controlEvidence();
  const verified = verifyDoctorControl(1, reports, runner, controlHead);
  assert.deepEqual(verified.map(entry => entry.command), ["doctor"]);
  assert.ok(verified[0].p95Ms > doctorExecLimitMs("doctor"));
  for (const mutate of [
    evidence => { evidence.exitCode = 0; },
    evidence => { evidence.exitCode = 2; },
    evidence => { evidence.reports.pop(); },
    evidence => { evidence.reports[0].invocation.head = "b".repeat(40); },
    evidence => { evidence.reports[0].invocation.dirty = true; },
    evidence => { evidence.reports[0].control = false; },
    evidence => { evidence.reports[0].samples[50].correlated = false; },
    evidence => { evidence.reports[0].samples[50].status = 500; },
    evidence => { evidence.reports[0].samples[50].cleanup = false; },
    evidence => { evidence.reports[0].samples[50].error = "unexpected error"; },
    evidence => { evidence.reports[0].samples.pop(); },
    evidence => { evidence.reports[0].samples[0].wallMs = 100; },
    evidence => { evidence.runner.errors.push({ message: "server cleanup failed" }); },
    evidence => { evidence.runner.stats.skipped = 1; },
    evidence => { evidence.runner.suites[0].specs[0].tests[0].results[0].status = "timedOut"; },
    evidence => { evidence.runner.suites[0].specs[0].tests[0].results[0].errors[0].message = "browser crashed"; },
  ]) {
    const evidence = { exitCode: 1, ...controlEvidence() };
    mutate(evidence);
    assert.throws(() => verifyDoctorControl(evidence.exitCode, evidence.reports, evidence.runner, controlHead));
  }
});
