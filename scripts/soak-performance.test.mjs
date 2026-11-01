import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import {
  buildSoakInvocation, parseSoakArguments, SOAK_DEFAULT_MINUTES, SOAK_MAXIMUM_MINUTES, SOAK_MINIMUM_MINUTES,
} from "./run-soak-performance.mjs";
import { buildShellInvocation } from "./run-shell-performance.mjs";
import {
  allowedMissedSoakSlots, evaluateSoakPerformance, expectedSoakSamples, SOAK_PERFORMANCE_PROFILE, SOAK_SERIES,
} from "../tests/fixtures/soak-performance.ts";

const interval = SOAK_PERFORMANCE_PROFILE.sampleIntervalMs;

function samples(minutes, { rssGrowthPerSample = 0, heap = 20_000_000 } = {}) {
  const count = expectedSoakSamples(minutes);
  return Array.from({ length: count }, (_, index) => ({
    index, atMs: index * interval + (index === count - 1 ? 5 : 0),
    cycles: index * 3, pageErrors: 0, externalBlocked: 0, documentRetained: true,
    server: { pid: 4242, rssBytes: 260_000_000 + index * rssGrowthPerSample, rootRssBytes: 200_000_000 + index * rssGrowthPerSample, processes: 2, fdCount: 40 },
    page: { jsHeapUsedBytes: heap, jsHeapTotalBytes: heap * 2, domNodes: 3_000, jsEventListeners: 400, documents: 1, frames: 1 },
    stateBytes: 10_000,
  }));
}

test("the launcher accepts only a bounded integer duration from the fixture profile", () => {
  assert.equal(SOAK_DEFAULT_MINUTES, SOAK_PERFORMANCE_PROFILE.defaultMinutes);
  assert.equal(SOAK_MINIMUM_MINUTES, SOAK_PERFORMANCE_PROFILE.minimumMinutes);
  assert.equal(SOAK_MAXIMUM_MINUTES, SOAK_PERFORMANCE_PROFILE.maximumMinutes);
  assert.deepEqual(parseSoakArguments([]), { minutes: SOAK_DEFAULT_MINUTES });
  assert.deepEqual(parseSoakArguments(["--minutes", "2"]), { minutes: 2 });
  assert.deepEqual(parseSoakArguments(["--minutes", String(SOAK_MAXIMUM_MINUTES)]), { minutes: SOAK_MAXIMUM_MINUTES });
  for (const args of [["--minutes"], ["--minutes", "0"], ["--minutes", String(SOAK_MAXIMUM_MINUTES + 1)], ["--minutes", "1.5"], ["--minutes", "-5"],
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

test("the Playwright config refuses a soak duration outside the profile before any build", async () => {
  const previous = { ...process.env };
  const stateRoot = mkdtempSync(path.join(tmpdir(), "cave-soak-config-"));
  try {
    process.env.CAVE_SOAK_PERFORMANCE = "1";
    process.env.CAVE_SOAK_STATE_ROOT = stateRoot;
    delete process.env.CAVE_SHELL_PERFORMANCE;
    delete process.env.CAVE_STREAM_PERFORMANCE;
    delete process.env.CAVE_DOCTOR_PERFORMANCE;
    for (const bad of ["", "abc", "0", "2.5", String(SOAK_PERFORMANCE_PROFILE.maximumMinutes + 1)]) {
      process.env.CAVE_SOAK_MINUTES = bad;
      await assert.rejects(() => import(`../playwright.config.ts?soak-minutes-${encodeURIComponent(bad) || "blank"}`), /CAVE_SOAK_MINUTES/, JSON.stringify(bad));
    }
    process.env.CAVE_SOAK_MINUTES = "5";
    const config = (await import("../playwright.config.ts?soak-minutes-5")).default;
    assert.equal(config.globalTimeout, (5 + 35) * 60_000, "the global timeout covers the build allowance plus the soak");
  } finally {
    for (const key of ["CAVE_SOAK_PERFORMANCE", "CAVE_SOAK_STATE_ROOT", "CAVE_SOAK_MINUTES", "CAVE_SHELL_PERFORMANCE", "CAVE_STREAM_PERFORMANCE", "CAVE_DOCTOR_PERFORMANCE"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("a complete steady run passes and reports every series with its growth per hour", () => {
  const verdict = evaluateSoakPerformance(samples(10), 10);
  assert.deepEqual(verdict.failures, []);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.expectedSamples, 11);
  assert.equal(verdict.sampleCount, 11);
  assert.equal(verdict.missedSlots, 0);
  assert.equal(verdict.cycles, 30);
  for (const series of SOAK_SERIES) {
    assert.ok(verdict.series[series], series);
    assert.equal(verdict.series[series].growthPerHour, 0, series);
  }
  const growing = evaluateSoakPerformance(samples(10, { rssGrowthPerSample: 1_000_000 }), 10);
  assert.equal(growing.pass, true, "growth is reported, not graded: the catalogue has no soak ceiling yet");
  assert.ok(Math.abs(growing.series.serverRssBytes.growthPerHour - 60_000_000) < 60_000, "within 0.1% of 60 MB/h despite the final sample jitter");
  assert.ok(Math.abs(growing.series.serverRootRssBytes.growthPerHour - 60_000_000) < 60_000);
  assert.equal(growing.series.serverRssBytes.first, 260_000_000);
  assert.equal(growing.series.serverRssBytes.last, 270_000_000);
  assert.equal(growing.series.serverProcesses.maximum, 2);
});

test("missed wall-clock slots are reported and tolerated only within the profile's fraction", () => {
  assert.equal(allowedMissedSoakSlots(120), 6, "121 slots at 5 percent");
  assert.equal(allowedMissedSoakSlots(2), 0, "a two-minute smoke may miss nothing");
  const base = samples(120);
  const oneMissed = base.filter(sample => sample.index !== 40);
  const tolerated = evaluateSoakPerformance(oneMissed, 120);
  assert.deepEqual(tolerated.failures, []);
  assert.equal(tolerated.missedSlots, 1);
  assert.equal(tolerated.sampleCount, 120);
  const sevenMissed = base.filter(sample => sample.index < 40 || sample.index > 46);
  const failed = evaluateSoakPerformance(sevenMissed, 120);
  assert.equal(failed.pass, false);
  assert.ok(failed.failures.some(failure => /7 sample slot\(s\) were missed/.test(failure)), failed.failures.join("; "));
  // A late sample keeps its true slot and time; it is never back-filled into an earlier slot.
  const late = samples(5);
  late[2].atMs = 2 * interval - 1;
  assert.ok(evaluateSoakPerformance(late, 5).failures.some(failure => /before its slot 2/.test(failure)));
});

test("an incomplete run fails closed instead of reading as no growth", () => {
  const base = () => samples(5);
  for (const [label, mutate] of [
    ["too few samples", s => s.slice(0, -1)],
    ["short duration", s => { s[s.length - 1].atMs = 4 * interval; return s; }],
    ["non-monotonic time", s => { s[2].atMs = s[1].atMs; return s; }],
    ["repeated slot", s => { s[3].index = 2; return s; }],
    ["no cycles", s => s.map(x => ({ ...x, cycles: 0 }))],
    ["page error", s => { s[s.length - 1].pageErrors = 1; return s; }],
    ["reloaded document", s => { s[4].documentRetained = false; return s; }],
    ["pid changed", s => { s[4].server = { ...s[4].server, pid: 1 }; return s; }],
    ["descriptor count disappeared", s => { s[3].server = { ...s[3].server, fdCount: null }; return s; }],
    ["missing heap", s => { s[1].page = { ...s[1].page, jsHeapUsedBytes: NaN }; return s; }],
    ["missing state bytes", s => { delete s[1].stateBytes; return s; }],
    ["missing rss", s => { s[1].server = { ...s[1].server, rssBytes: undefined }; return s; }],
    ["missing process count", s => { s[1].server = { ...s[1].server, processes: undefined }; return s; }],
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
  assert.equal(verdict.pass, true, "descriptor count may be unavailable on a host; it is reported absent throughout, not fabricated");
  assert.equal(verdict.series.serverFdCount, undefined);
});

test("the growth per hour of each series is fitted on that series' own final two thirds", () => {
  // The descriptor series drops out entirely on this host; the other series
  // must still be fitted on their own tails, not an index from a longer array.
  const run = samples(30, { rssGrowthPerSample: 2_000_000 }).map(x => ({ ...x, server: { ...x.server, fdCount: null } }));
  const verdict = evaluateSoakPerformance(run, 30);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.series.serverFdCount, undefined);
  assert.ok(Math.abs(verdict.series.serverRssBytes.growthPerHour - 120_000_000) < 120_000);
});

test("the workflow runs the soak only for an explicit positive duration and never on the schedule", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/cave-performance.yml", import.meta.url), "utf8"));
  const input = workflow.on.workflow_dispatch.inputs.soak_minutes;
  assert.equal(input.type, "string");
  assert.equal(input.default, "");
  const job = workflow.jobs.soak;
  assert.match(job.if, /inputs\.soak_minutes/);
  const playwrightAllowance = 35;
  const setupAllowance = 15;
  assert.ok(job["timeout-minutes"] >= SOAK_PERFORMANCE_PROFILE.maximumMinutes + playwrightAllowance + setupAllowance,
    "the longest soak plus the build allowance, checkout, install, browser install and upload must fit the job");
  const run = job.steps.find(step => typeof step.run === "string" && step.run.includes("performance:soak"));
  assert.match(run.run, /--minutes/);
  const upload = job.steps.find(step => step.uses?.startsWith("actions/upload-artifact"));
  assert.equal(upload.if, "always()");
  assert.match(upload.with.name, /cave-soak-performance-/);
});
