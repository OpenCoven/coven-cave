import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertIsolatedStreamBuild,
  buildStreamInvocation,
  parseStreamArguments,
} from "./run-stream-performance.mjs";
import {
  createStreamWorkload,
  evaluateStreamPerformance,
  hasCompleteStreamText,
  overlappingLongTasks,
} from "../tests/fixtures/chat-stream-performance.ts";
import { verifyStreamControl } from "./verify-stream-control.mjs";

function samples(pattern = "burst", longestTaskMs = 200) {
  return Array.from({ length: 100 }, (_, index) => ({
    index, pattern, complete: true, observerSupported: true,
    sendCount: 1, textMatches: true, draftMatches: true,
    eventCount: 10_000, textBytes: 89_294, sseBytes: 618_430, historyTurns: 1_000,
    longestTaskMs,
  }));
}

test("the generated workload preserves all numbered records and indexed response text", () => {
  const { frames, expectedText } = createStreamWorkload();
  assert.equal(frames.length, 10_000);
  assert.equal(Buffer.byteLength(frames.join("")), 618_430);
  assert.equal(Buffer.byteLength(expectedText), 89_294);
  const records = frames.map((frame, index) => {
    const match = /^id: ([0-9]+)\ndata: (.+)\n\n$/.exec(frame);
    assert.ok(match);
    assert.equal(Number(match[1]), index + 1);
    return JSON.parse(match[2]);
  });
  assert.deepEqual(records[0], { kind: "session", sessionId: "context-a" });
  assert.deepEqual(records.at(-1), {
    kind: "done", sessionId: "context-a", persistedTurnId: "context-a-1001",
  });
  const chunks = records.slice(1, -1);
  assert.equal(chunks.length, 9_998);
  assert.ok(chunks.every(record => record.kind === "assistant_chunk"));
  assert.equal(chunks.map(record => record.text).join(""), expectedText);
  assert.equal(chunks[0].text, "w0000000 ");
  assert.equal(chunks[99].text, "\n\n");
  assert.equal(chunks.at(-2).text, "w0009996 ");
  assert.equal(chunks.at(-1).text, "ENDSTREAM10000");
  assert.equal(new Set(expectedText.match(/w[0-9]{7}/g)).size, 9_898);
});

test("100 complete trials at the existing ceiling pass with the measured percentile", () => {
  const result = evaluateStreamPerformance("burst", samples());
  assert.equal(result.pass, true);
  assert.equal(result.p95Ms, 200);
  assert.equal(result.maximumMs, 200);
  assert.deepEqual(result.failures, []);
});

test("rendered completeness preserves every paragraph and its word separators", () => {
  const { expectedText } = createStreamWorkload();
  const paragraphs = expectedText.split("\n\n").map(text => text.trim());
  assert.equal(paragraphs.length, 100);
  assert.equal(hasCompleteStreamText(paragraphs.join("\n"), paragraphs, expectedText), true);
  for (const damaged of [
    [paragraphs.join(" ")],
    [paragraphs[0] + " " + paragraphs[1], ...paragraphs.slice(2)],
    paragraphs.map(text => text.replaceAll(" ", "")),
    paragraphs.slice(1),
    [...paragraphs].reverse(),
  ]) assert.equal(hasCompleteStreamText(damaged.join("\n"), damaged, expectedText), false);
  assert.equal(hasCompleteStreamText(expectedText, null, expectedText), false);
  assert.equal(hasCompleteStreamText(expectedText + "unexpected", paragraphs, expectedText), false);
});

test("six slow trials breach p95 while five affect the reported maximum", () => {
  const five = samples();
  for (let index = 0; index < 5; index++) five[index].longestTaskMs = 201;
  assert.equal(evaluateStreamPerformance("burst", five).pass, true);
  assert.equal(evaluateStreamPerformance("burst", five).maximumMs, 201);
  five[5].longestTaskMs = 201;
  const result = evaluateStreamPerformance("burst", five);
  assert.equal(result.pass, false);
  assert.equal(result.p95Ms, 201);
  assert.ok(result.failures.some(reason => reason.includes("200")));
});

test("shuffled trial order keeps the same percentile without mutating input", () => {
  const input = samples().map((sample, index) => ({ ...sample, longestTaskMs: 100 - index }));
  const original = structuredClone(input);
  const result = evaluateStreamPerformance("burst", input);
  assert.equal(result.p95Ms, 95);
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
    const result = evaluateStreamPerformance("burst", input);
    assert.equal(result.pass, false);
    assert.equal(result.p95Ms, null);
    assert.ok(result.failures.length > 0);
  }
});

test("one invalid semantic or workload observation fails even below the latency ceiling", () => {
  for (const patch of [
    { complete: false }, { observerSupported: false }, { sendCount: 0 }, { sendCount: 2 },
    { textMatches: false }, { draftMatches: false },
    { eventCount: 9_999 }, { textBytes: 89_293 }, { sseBytes: 618_429 }, { historyTurns: 999 },
    { pattern: "paced" }, { longestTaskMs: NaN }, { longestTaskMs: Infinity },
    { longestTaskMs: -1 }, { longestTaskMs: undefined }, { complete: undefined },
  ]) {
    const input = samples("burst", 0);
    input[40] = { ...input[40], ...patch };
    const result = evaluateStreamPerformance("burst", input);
    assert.equal(result.pass, false, JSON.stringify(patch));
    assert.equal(result.p95Ms, null);
  }
});

test("fast burst trials cannot conceal a slow paced distribution or an unknown pattern", () => {
  assert.equal(evaluateStreamPerformance("burst", samples("burst", 0)).pass, true);
  assert.equal(evaluateStreamPerformance("paced", samples("paced", 260)).pass, false);
  assert.equal(evaluateStreamPerformance("unknown", samples()).pass, false);
});

test("overlap measurement includes a task already blocking at stream release", () => {
  const entries = [
    { start: 0, duration: 50 },
    { start: 90, duration: 260 },
    { start: 150, duration: 60 },
    { start: 390, duration: 70 },
    { start: 400, duration: 80 },
  ];
  assert.deepEqual(overlappingLongTasks(entries, 100, 400), [entries[1], entries[2], entries[3]]);
});

test("invalid observer entries and time windows fail instead of disappearing", () => {
  for (const entries of [
    [{ start: NaN, duration: 260 }], [{ start: 0, duration: Infinity }],
    [{ start: 0, duration: -1 }], [{ start: -1, duration: 60 }],
  ]) assert.throws(() => overlappingLongTasks(entries, 100, 400));
  for (const [start, end] of [[NaN, 400], [100, Infinity], [400, 100], [-1, 400]]) {
    assert.throws(() => overlappingLongTasks([], start, end));
  }
});

test("the launcher refuses workload overrides and only accepts the explicit failing control", () => {
  assert.deepEqual(parseStreamArguments([]), { control: false });
  assert.deepEqual(parseStreamArguments(["--control"]), { control: true });
  for (const args of [["--trials=1"], ["--retries=1"], ["--control", "--control"], ["--unknown"]]) {
    assert.throws(() => parseStreamArguments(args));
  }
});

test("the real CLI invocation strips credentials and injection while fixing the tested workload", () => {
  const invocation = buildStreamInvocation({
    stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts", control: false,
    sourceEnv: {
      PATH: "/bin", HOME: "/browser-cache-home", CI: "1", COVEN_CAVE_PORT: "3199",
      GITHUB_TOKEN: "private", GITHUB_PAT: "private", OPENAI_API_KEY: "private",
      ANTHROPIC_API_KEY: "private", NODE_OPTIONS: "--require=untrusted.cjs",
      COVEN_HOME: "/real/coven", COVEN_CAVE_ENV_FILE: "/real/.env",
      CAVE_STREAM_CONTROL: "1", CAVE_STREAM_PERFORMANCE: "0",
    },
  });
  assert.equal(invocation.env.HOME, "/browser-cache-home");
  assert.equal(invocation.env.COVEN_CAVE_PORT, "3199");
  assert.equal(invocation.env.CAVE_STREAM_PERFORMANCE, "1");
  assert.equal(invocation.env.CAVE_STREAM_CONTROL, "0");
  assert.equal(invocation.env.CAVE_STREAM_STATE_ROOT, "/synthetic/state");
  for (const key of ["GITHUB_TOKEN", "GITHUB_PAT", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    "NODE_OPTIONS", "COVEN_HOME", "COVEN_CAVE_ENV_FILE"]) {
    assert.equal(invocation.env[key], undefined, key);
  }
  assert.ok(invocation.args.includes("tests/chat-stream-performance.spec.ts"));
  assert.ok(invocation.args.includes("--retries=0"));
  assert.ok(invocation.args.includes("--workers=1"));
  assert.ok(invocation.args.includes("--no-deps"));
  assert.ok(invocation.args.includes("--reporter=list,json"));
  assert.equal(invocation.env.PLAYWRIGHT_JSON_OUTPUT_FILE, "/synthetic/artifacts/playwright.json");
  assert.equal(invocation.args.some(arg => arg.includes("repeat-each")), false);
  assert.equal(buildStreamInvocation({
    stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts",
    sourceEnv: {}, control: true,
  }).env.CAVE_STREAM_CONTROL, "1");
});

const controlHead = "a".repeat(40);
function controlEvidence() {
  const reports = ["burst", "paced"].map(pattern => {
    const trials = samples(pattern, 0).map(sample => ({
      ...sample, cleanup: true, longestTaskMs: sample.index < 6 ? 260 : 0,
    }));
    return {
      pattern, control: true, samples: trials,
      invocation: { invocationId: "synthetic-control", head: controlHead, dirty: false, control: true },
      verdict: evaluateStreamPerformance(pattern, trials),
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
  assert.doesNotThrow(() => verifyStreamControl(1, reports, runner, controlHead));
  for (const mutate of [
    evidence => { evidence.exitCode = 0; },
    evidence => { evidence.exitCode = 2; },
    evidence => { evidence.reports.pop(); },
    evidence => { evidence.reports[1] = evidence.reports[0]; },
    evidence => { evidence.reports[0].invocation.head = "b".repeat(40); },
    evidence => { evidence.reports[0].invocation.dirty = true; },
    evidence => { evidence.reports[0].invocation.invocationId = "another-run"; },
    evidence => { evidence.reports[0].control = false; },
    evidence => { evidence.reports[0].samples[50].textMatches = false; },
    evidence => { evidence.reports[0].samples[50].cleanup = false; },
    evidence => { evidence.reports[0].samples[50].error = "unexpected error"; },
    evidence => { evidence.reports[0].samples.pop(); },
    evidence => { evidence.reports[0].samples[0].longestTaskMs = 0; },
    evidence => { evidence.runner.errors.push({ message: "server cleanup failed" }); },
    evidence => { evidence.runner.stats.skipped = 1; },
    evidence => { evidence.runner.suites[0].specs[0].tests[0].results[0].status = "timedOut"; },
    evidence => { evidence.runner.suites[0].specs[0].tests[0].results[0].errors[0].message = "browser crashed"; },
  ]) {
    const evidence = { exitCode: 1, ...controlEvidence() };
    mutate(evidence);
    assert.throws(() => verifyStreamControl(
      evidence.exitCode, evidence.reports, evidence.runner, controlHead,
    ));
  }
});

test("control verification reads actual Playwright assertion failure records", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "stream-control-reporter-"));
  try {
    const { reports } = controlEvidence();
    const require = createRequire(import.meta.url);
    writeFileSync(path.join(directory, "control.spec.cjs"),
      `const { test, expect } = require(${JSON.stringify(require.resolve("@playwright/test"))});
       for (const report of ${JSON.stringify(reports.map(({ pattern, verdict }) => ({ pattern, verdict })))}) {
         test(report.pattern, () => expect(report.verdict.failures, JSON.stringify(report.verdict)).toEqual([]));
       }`);
    const config = path.join(directory, "playwright.config.cjs");
    writeFileSync(config, `module.exports = {
      testDir: ${JSON.stringify(directory)}, testMatch: "control.spec.cjs",
      workers: 1, retries: 0, reporter: [["json"]],
      outputDir: ${JSON.stringify(path.join(directory, "results"))}
    };`);
    const invocation = buildStreamInvocation({
      sourceEnv: process.env, stateRoot: directory, artifactRoot: directory, control: true,
    });
    const result = spawnSync(process.execPath, [invocation.cli, "test", "--config", config], {
      cwd: directory, env: invocation.env, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(result.status, 1, result.stderr);
    const runner = JSON.parse(readFileSync(path.join(directory, "playwright.json"), "utf8"));
    assert.doesNotThrow(() => verifyStreamControl(result.status, reports, runner, controlHead));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a build with local dotenv files is refused without reading or modifying them", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "stream-env-test-"));
  try {
    assert.doesNotThrow(() => assertIsolatedStreamBuild(directory));
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      const file = path.join(directory, name);
      writeFileSync(file, "DO_NOT_READ=synthetic\n");
      assert.throws(() => assertIsolatedStreamBuild(directory), /dotenv/);
      rmSync(file);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
