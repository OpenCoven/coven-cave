import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import {
  buildPerformanceReport,
  renderPerformanceReportMarkdown,
  writePerformanceReport,
} from "./cave-performance-report.mjs";
import { enforcedFixtureProfiles } from "../src/lib/performance-budgets.ts";

function conversation({ warmP95 = 8, cacheHitRate = 1, coldP95 = 900 } = {}) {
  return {
    fixture: { profile: "phase-6-list-10k", fileCount: 10, transcriptBytes: 1024, iterations: 5 },
    before: {
      label: "full transcript parse",
      p50Ms: 10,
      p95Ms: 20,
      bytesReadPerScan: 10_000,
    },
    cold: {
      label: "cold metadata scan",
      p50Ms: 850,
      p95Ms: coldP95,
      bytesReadPerScan: 10_000,
    },
    after: {
      label: "warm metadata cache",
      p50Ms: 4,
      p95Ms: warmP95,
      bytesReadPerScan: 100,
    },
    cacheHitRate,
  };
}

function reliability() {
  const operation = {
    successCount: 95,
    successRate: 0.95,
    successfulDurationMs: { p50: 4_000, p95: 12_000, max: 15_000 },
    pass: true,
  };
  return {
    schemaVersion: 1,
    baseline: "deterministic-fault-contract",
    records: 100,
    pass: true,
    operations: {
      native_startup: operation,
      frontend_reconnect: operation,
      supervised_recovery: operation,
    },
  };
}

function metadata(overrides = {}) {
  return {
    repository: "OpenCoven/coven-cave",
    ref: "main",
    sha: "a".repeat(40),
    workflow: "Cave Performance",
    runId: "17",
    runAttempt: "2",
    generatedAt: "2026-08-18T06:00:00.000Z",
    runtime: { node: "v24.0.0", platform: "linux", arch: "x64" },
    ...overrides,
  };
}

test("report compares metrics in their improvement direction", () => {
  // Empty catalogue on purpose: this asserts baseline comparison, and the
  // 0.7 hit rate it needs to force a regression also breaches the shipped
  // cache-hit budget, which would mask the verdict under a "fail" status.
  const baseline = buildPerformanceReport({
    conversation: conversation(),
    reliability: reliability(),
    metadata: metadata({ sha: "b".repeat(40), runId: "16" }),
    budgetCatalogue: [],
  });
  const report = buildPerformanceReport({
    conversation: conversation({ warmP95: 12, cacheHitRate: 0.7 }),
    reliability: reliability(),
    metadata: metadata(),
    baselineReport: baseline,
    regressionThresholdPct: 15,
    budgetCatalogue: [],
  });

  assert.equal(report.summary.status, "regression");
  assert.equal(report.summary.regressionCount, 2);
  assert.equal(report.summary.historyPoints, 2);
  assert.deepEqual(
    report.history.map((entry) => entry.runId),
    ["16", "17"],
  );
  assert.equal(
    report.metrics.find((entry) => entry.id === "conversation-list.warm-cache.p95-ms")
      .comparison.verdict,
    "regression",
  );
  assert.equal(
    report.metrics.find((entry) => entry.id === "conversation-list.cache-hit-rate")
      .comparison.verdict,
    "regression",
  );
  assert.equal(report.baseline.runId, "16");
});

test("report writer creates immutable run paths and a latest pointer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-performance-report-"));
  try {
    const report = buildPerformanceReport({
      conversation: conversation(),
      reliability: reliability(),
      metadata: metadata({ ref: "refs/heads/feature/perf" }),
    });
    const written = await writePerformanceReport({ outputRoot: root, report });

    assert.equal(written.pointer.path, "feature-perf/17-2/standard");
    assert.equal(
      JSON.parse(await readFile(written.pointerPath, "utf8")).sha,
      "a".repeat(40),
    );
    assert.equal(JSON.parse(await readFile(written.reportJsonPath, "utf8")).schemaVersion, 1);
    assert.match(await readFile(written.indexPath, "utf8"), /this run seeds the timeline/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("markdown includes comparison and reliability evidence", () => {
  const report = buildPerformanceReport({
    conversation: conversation(),
    reliability: reliability(),
    metadata: metadata(),
  });
  const markdown = renderPerformanceReportMarkdown(report);

  assert.match(markdown, /Conversation list warm cache p95/);
  assert.match(markdown, /native startup/);
  assert.match(markdown, /deterministic daemon startup, reconnect, and recovery contract/);
});

test("failed daemon reliability contract fails the report summary", () => {
  const failedReliability = reliability();
  failedReliability.pass = false;
  failedReliability.operations.native_startup = {
    ...failedReliability.operations.native_startup,
    pass: false,
  };
  const report = buildPerformanceReport({
    conversation: conversation(),
    reliability: failedReliability,
    metadata: metadata(),
  });

  assert.equal(report.summary.status, "fail");
  assert.equal(report.summary.reliabilityPass, false);
});

test("a run inside every budget reports a passing budget verdict", () => {
  const report = buildPerformanceReport({
    conversation: conversation(),
    reliability: reliability(),
    metadata: metadata(),
  });

  assert.equal(report.summary.budgetPass, true);
  assert.equal(report.summary.budgetBreachCount, 0);
  assert.equal(report.summary.budgetUnmeasuredCount, 0);
  assert.equal(report.summary.status, "pass");
  assert.ok(report.budgets.pendingCount > 0, "pending budgets stay visible in the report");
});

test("a breached budget fails the report even with no baseline to regress against", () => {
  const report = buildPerformanceReport({
    conversation: conversation({ coldP95: 30_000 }),
    reliability: reliability(),
    metadata: metadata(),
  });

  assert.equal(report.summary.status, "fail");
  assert.equal(report.summary.budgetPass, false);
  assert.equal(report.summary.budgetBreachCount, 1);
  assert.equal(
    report.budgets.results.find(
      (result) => result.budget.id === "conversation-list.cold-scan.p95-ms",
    ).verdict,
    "breach",
  );
});

test("a benchmark that produced no cold scan fails closed rather than passing", () => {
  const withoutCold = conversation();
  delete withoutCold.cold;
  const report = buildPerformanceReport({
    conversation: withoutCold,
    reliability: reliability(),
    metadata: metadata(),
  });

  assert.equal(report.summary.status, "fail");
  assert.equal(report.summary.budgetUnmeasuredCount, 2);
});

test("a smoke-scale run fails instead of certifying the 10k budgets", () => {
  // Reproduced before this assertion existed: `pnpm performance:report` with no
  // profile ran the 100-conversation `default` fixture and printed
  // "10k conversation list, cold metadata scan p95 | 38.07 ms | ≤ 3000.00 ms |
  // pass", with summary.budgetPass true and exit code 0. Every enforced limit
  // is a claim about a specific workload; measuring a different one measures
  // nothing, so it fails closed exactly like an absent metric.
  const smoke = conversation();
  smoke.fixture = { profile: "default", fileCount: 100, transcriptBytes: 262_144, iterations: 20 };
  const report = buildPerformanceReport({
    conversation: smoke,
    reliability: reliability(),
    metadata: metadata(),
  });

  assert.equal(report.summary.status, "fail");
  assert.equal(report.summary.budgetPass, false);
  assert.equal(report.summary.budgetBreachCount, 0, "the numbers themselves are fine — the scale is not");
  assert.equal(report.summary.budgetUnmeasuredCount, report.budgets.enforcedCount);
  assert.match(
    renderPerformanceReportMarkdown(report),
    /seeded against the phase-6-list-10k fixture, but this run measured default/,
  );
});

test("a swept dimension does not inherit its profile's authority", () => {
  // The exact payload of
  //   CAVE_BENCH_PROFILE=phase-6-list-10k CAVE_BENCH_CONVERSATIONS=25 \
  //   CAVE_BENCH_ITERATIONS=1 pnpm bench:conversation-list
  // before the benchmark stopped claiming the profile it departed from. The
  // profile check compares a NAME, and the name was stamped from
  // CAVE_BENCH_PROFILE alone — so twenty-five conversations reported
  // `profile: "phase-6-list-10k"` and the report answered status "pass",
  // budgetPass true, cold-scan p95 "pass" against the 10k ceiling. That is the
  // same smoke-certifies-10k defect the profile check exists to stop, reached
  // through the override door rather than the profile door.
  const swept = conversation();
  swept.fixture = {
    profile: "phase-6-list-10k (overridden: CAVE_BENCH_CONVERSATIONS, CAVE_BENCH_ITERATIONS)",
    fileCount: 25,
    transcriptBytes: 4096,
    iterations: 1,
  };
  const report = buildPerformanceReport({
    conversation: swept,
    reliability: reliability(),
    metadata: metadata(),
  });

  assert.equal(report.summary.status, "fail");
  assert.equal(report.summary.budgetPass, false);
  assert.equal(report.summary.budgetBreachCount, 0, "the numbers are fine — the workload is not");
  assert.equal(report.summary.budgetUnmeasuredCount, report.budgets.enforcedCount);
});

test("the benchmark reports a swept dimension, and only a genuinely swept one", () => {
  // Pinned by running the benchmark rather than by restating its output, since
  // the stamp is the whole tie between a workload and the budget that judges
  // it. Two conversations of 64 bytes keeps this a sub-second fixture; the
  // iterations override is set to the profile's OWN value (5), which changes
  // nothing about the workload and so must not read as a sweep.
  const script = fileURLToPath(new URL("./conversation-list-benchmark.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      CAVE_BENCH_PROFILE: "phase-6-list-10k",
      CAVE_BENCH_CONVERSATIONS: "2",
      CAVE_BENCH_TRANSCRIPT_BYTES: "64",
      CAVE_BENCH_ITERATIONS: "5",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const { fixture } = JSON.parse(result.stdout);

  assert.equal(
    fixture.profile,
    "phase-6-list-10k (overridden: CAVE_BENCH_CONVERSATIONS, CAVE_BENCH_TRANSCRIPT_BYTES)",
  );
  assert.equal(fixture.iterations, 5);
  assert.ok(
    !enforcedFixtureProfiles().includes(fixture.profile),
    "a swept run must not name a profile any budget is seeded against",
  );
});

test("markdown renders the budget table with limits and pending surfaces", () => {
  const markdown = renderPerformanceReportMarkdown(
    buildPerformanceReport({
      conversation: conversation(),
      reliability: reliability(),
      metadata: metadata(),
    }),
  );

  assert.match(markdown, /## Production budgets/);
  assert.match(markdown, /Budget verdict: \*\*PASS\*\*/);
  assert.match(markdown, /Warm shell boot to interactive p95/);
  assert.match(markdown, /must not read as a clean run/);
});

test("scheduled workflow restores history and always uploads report evidence", async () => {
  const workflow = parse(
    await readFile(new URL("../.github/workflows/cave-performance.yml", import.meta.url), "utf8"),
  );
  const steps = workflow.jobs.report.steps;
  const restore = steps.find((step) => step.name === "Restore previous report");
  const generate = steps.find((step) => step.name === "Generate report");
  const upload = steps.find((step) => step.name === "Upload performance report");

  assert.ok(workflow.on.schedule);
  assert.ok(workflow.on.workflow_dispatch);
  assert.equal(workflow.permissions.actions, "read");
  assert.match(restore.run, /--status success/);
  assert.match(generate.run, /--baseline/);
  // A breached budget fails this workflow by exit code and by nothing else, and
  // the step deliberately runs the report under `set +e` so a failing run still
  // writes its job summary. That makes one line the whole enforcement: drop
  // `exit "$report_status"` and the gate goes green on every breach, with no
  // failing assertion anywhere to say so. Pin the capture and the propagation.
  assert.match(generate.run, /^\s*set \+e$/m, "the report runs with errexit off");
  assert.match(generate.run, /^\s*report_status=\$\?$/m, "its exit code is captured");
  assert.match(generate.run, /^\s*exit "\$report_status"$/m, "and is the step's own exit code");
  assert.equal(upload.if, "always()");
  assert.equal(
    upload.uses,
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  );
  assert.equal(upload.with["if-no-files-found"], "error");
});

test("the workflow benchmarks the fixture the enforced budgets were seeded against", async () => {
  // The catalogue and the workload have to move together or the nightly grades
  // one thing against another's ceilings. The report now fails closed on that
  // mismatch, so a drift here turns the whole scheduled run red — catch it in
  // the unit suite instead.
  const workflow = parse(
    await readFile(new URL("../.github/workflows/cave-performance.yml", import.meta.url), "utf8"),
  );
  const profiles = enforcedFixtureProfiles();
  assert.equal(profiles.length, 1, "the report can only default to a single seeded profile");

  assert.equal(workflow.on.workflow_dispatch.inputs.profile.default, profiles[0]);
  assert.ok(
    workflow.jobs.report.env.CAVE_BENCH_PROFILE.includes(profiles[0]),
    `job env must fall back to ${profiles[0]}`,
  );
  // Blank on a scheduled run: `inputs` is empty for a non-dispatch event, and
  // the benchmark reads blank as "not overridden" rather than as zero.
  assert.equal(workflow.jobs.report.env.CAVE_BENCH_ITERATIONS, "${{ inputs.iterations }}");
  assert.equal(workflow.on.workflow_dispatch.inputs.iterations.default, "");
});
