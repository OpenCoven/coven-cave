import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { buildSoakInvocation, parseSoakArguments, SOAK_DEFAULT_MINUTES } from "./run-soak-performance.mjs";
import { buildShellInvocation } from "./run-shell-performance.mjs";
import {
  evaluateSoakPerformance, expectedSoakSamples, SOAK_PERFORMANCE_PROFILE, SOAK_SERIES,
} from "../tests/fixtures/soak-performance.ts";

function samples(minutes, { rssGrowthPerSample = 0, heap = 20_000_000 } = {}) {
  const count = expectedSoakSamples(minutes);
  return Array.from({ length: count }, (_, index) => ({
    index, atMs: index * SOAK_PERFORMANCE_PROFILE.sampleIntervalMs + (index === count - 1 ? 5 : 0),
    cycles: index * 3, pageErrors: 0, externalBlocked: 0,
    server: { pid: 4242, rssBytes: 200_000_000 + index * rssGrowthPerSample, fdCount: 40 },
    page: { jsHeapUsedBytes: heap, jsHeapTotalBytes: heap * 2, domNodes: 3_000, jsEventListeners: 400, documents: 1, frames: 1 },
    stateBytes: 10_000,
  }));
}

test("the launcher accepts only a bounded integer duration", () => {
  assert.deepEqual(parseSoakArguments([]), { minutes: SOAK_DEFAULT_MINUTES });
  assert.deepEqual(parseSoakArguments(["--minutes", "2"]), { minutes: 2 });
  assert.deepEqual(parseSoakArguments(["--minutes", "300"]), { minutes: 300 });
  for (const args of [["--minutes"], ["--minutes", "0"], ["--minutes", "301"], ["--minutes", "1.5"], ["--minutes", "-5"],
    ["--trials=1"], ["--control"], ["--minutes", "2", "--minutes", "3"]]) {
    assert.throws(() => parseSoakArguments(args), args.join(" "));
  }
});

test("the soak invocation strips credentials exactly as the shell one does", () => {
  const sourceEnv = {
    PATH: "/bin", HOME: "/browser-cache-home", CI: "1", COVEN_CAVE_PORT: "3199",
    GITHUB_TOKEN: "private", NODE_OPTIONS: "--require=untrusted.cjs", COVEN_HOME: "/real/coven",
    CAVE_SHELL_PERFORMANCE: "1", CAVE_SOAK_MINUTES: "9999",
  };
  const soak = buildSoakInvocation({ sourceEnv, stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts", minutes: 7 });
  const shell = buildShellInvocation({ sourceEnv, stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts", control: false });
  assert.equal(soak.env.CAVE_SOAK_PERFORMANCE, "1");
  assert.equal(soak.env.CAVE_SOAK_MINUTES, "7");
  assert.equal(soak.env.CAVE_SOAK_STATE_ROOT, "/synthetic/state");
  assert.equal(soak.env.CAVE_SOAK_ARTIFACT_ROOT, "/synthetic/artifacts");
  for (const key of ["GITHUB_TOKEN", "NODE_OPTIONS", "COVEN_HOME", "CAVE_SHELL_PERFORMANCE"]) assert.equal(soak.env[key], undefined, key);
  const allowlisted = env => Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("CAVE_")));
  assert.deepEqual(allowlisted(soak.env), allowlisted(shell.env));
  assert.deepEqual(soak.args.filter(arg => !arg.endsWith(".spec.ts")), shell.args.filter(arg => !arg.endsWith(".spec.ts")));
  assert.ok(soak.args.includes("tests/soak-performance.spec.ts"));
});

test("a complete steady run passes and reports every series with its growth per hour", () => {
  const verdict = evaluateSoakPerformance(samples(10), 10);
  assert.deepEqual(verdict.failures, []);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.sampleCount, 11);
  assert.equal(verdict.cycles, 30);
  for (const series of SOAK_SERIES) {
    assert.ok(verdict.series[series], series);
    assert.equal(verdict.series[series].growthPerHour, 0, series);
  }
  const growing = evaluateSoakPerformance(samples(10, { rssGrowthPerSample: 1_000_000 }), 10);
  assert.equal(growing.pass, true, "growth is reported, not graded: the catalogue has no soak ceiling yet");
  assert.ok(Math.abs(growing.series.serverRssBytes.growthPerHour - 60_000_000) < 60_000, "within 0.1% of 60 MB/h despite the final sample jitter");
  assert.equal(growing.series.serverRssBytes.first, 200_000_000);
  assert.equal(growing.series.serverRssBytes.last, 210_000_000);
});

test("an incomplete run fails closed instead of reading as no growth", () => {
  const base = () => samples(5);
  for (const [label, mutate] of [
    ["too few samples", s => s.slice(0, -1)],
    ["short duration", s => { s[s.length - 1].atMs = 4 * 60_000; return s; }],
    ["non-monotonic time", s => { s[2].atMs = s[1].atMs; return s; }],
    ["bad index", s => { s[3].index = 7; return s; }],
    ["no cycles", s => s.map(x => ({ ...x, cycles: 0 }))],
    ["page error", s => { s[s.length - 1].pageErrors = 1; return s; }],
    ["pid changed", s => { s[4].server = { ...s[4].server, pid: 1 }; return s; }],
    ["missing heap", s => { s[1].page = { ...s[1].page, jsHeapUsedBytes: NaN }; return s; }],
    ["missing state bytes", s => { delete s[1].stateBytes; return s; }],
    ["missing rss", s => { s[1].server = { ...s[1].server, rssBytes: undefined }; return s; }],
  ]) {
    const verdict = evaluateSoakPerformance(mutate(base()), 5);
    assert.equal(verdict.pass, false, label);
    assert.ok(verdict.failures.length > 0, label);
  }
  assert.equal(evaluateSoakPerformance(undefined, 5).pass, false);
  assert.equal(evaluateSoakPerformance(samples(5), 0).pass, false);
  assert.equal(evaluateSoakPerformance(samples(5), 2.5).pass, false);
  const noFd = samples(5).map(x => ({ ...x, server: { ...x.server, fdCount: null } }));
  const verdict = evaluateSoakPerformance(noFd, 5);
  assert.equal(verdict.pass, true, "descriptor count may be unavailable on a host; it is reported absent, not fabricated");
  assert.equal(verdict.series.serverFdCount, undefined);
});

test("the workflow runs the soak only for an explicit positive duration and never on the schedule", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/cave-performance.yml", import.meta.url), "utf8"));
  const input = workflow.on.workflow_dispatch.inputs.soak_minutes;
  assert.equal(input.type, "string");
  assert.equal(input.default, "");
  const job = workflow.jobs.soak;
  assert.match(job.if, /inputs\.soak_minutes/);
  assert.ok(job["timeout-minutes"] >= 320, "a 300-minute soak plus the build must fit the job");
  const run = job.steps.find(step => typeof step.run === "string" && step.run.includes("performance:soak"));
  assert.match(run.run, /--minutes/);
  const upload = job.steps.find(step => step.uses?.startsWith("actions/upload-artifact"));
  assert.equal(upload.if, "always()");
  assert.match(upload.with.name, /cave-soak-performance-/);
});
