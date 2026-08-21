#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { THIN_HEADROOM_PCT } from "./budget-headroom.mjs";
import {
  enforcedFixtureProfiles,
  evaluatePerformanceBudgets,
  PERFORMANCE_BUDGETS,
} from "../src/lib/performance-budgets.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The fixture the enforced budgets were seeded against, when they agree on one.
 *
 * An ad-hoc `pnpm performance:report` otherwise runs the benchmark's `default`
 * smoke profile and is then graded against 10k-list ceilings it never went
 * near. Defaulting the benchmark here means the report measures the workload it
 * is about to judge; the evaluation still fails closed if they disagree.
 */
const BUDGETED_FIXTURE_PROFILE = enforcedFixtureProfiles().length === 1
  ? enforcedFixtureProfiles()[0]
  : null;
const DEFAULT_REGRESSION_THRESHOLD_PCT = 20;
const HISTORY_LIMIT = 365;
const LANE = "standard";

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function metric(id, label, unit, value, direction, source) {
  return {
    id,
    label,
    unit,
    value: finiteNumber(value, id),
    direction,
    source,
  };
}

function conversationMetrics(conversation) {
  const before = conversation?.before;
  const after = conversation?.after;
  const cold = conversation?.cold;
  if (!before || !after) throw new Error("conversation benchmark is missing before/after results");

  const beforeP95 = finiteNumber(before.p95Ms, "conversation before p95Ms");
  const afterP95 = finiteNumber(after.p95Ms, "conversation after p95Ms");
  const beforeBytes = finiteNumber(before.bytesReadPerScan, "conversation before bytesReadPerScan");
  const afterBytes = finiteNumber(after.bytesReadPerScan, "conversation after bytesReadPerScan");

  // `cold` measures Cave's own uncached scan and is what the 10k-list budget
  // judges. A baseline report captured before it existed simply omits it, so it
  // stays optional here rather than failing the run that inherits that baseline.
  const coldMetrics = cold
    ? [
        metric(
          "conversation-list.cold-scan.p50-ms",
          "Conversation list cold scan p50",
          "ms",
          finiteNumber(cold.p50Ms, "conversation cold p50Ms"),
          "lower-is-better",
          "conversation-list",
        ),
        metric(
          "conversation-list.cold-scan.p95-ms",
          "Conversation list cold scan p95",
          "ms",
          finiteNumber(cold.p95Ms, "conversation cold p95Ms"),
          "lower-is-better",
          "conversation-list",
        ),
        metric(
          "conversation-list.cold-scan.bytes",
          "Conversation list cold scan bytes",
          "bytes",
          finiteNumber(cold.bytesReadPerScan, "conversation cold bytesReadPerScan"),
          "lower-is-better",
          "conversation-list",
        ),
      ]
    : [];

  return [
    ...coldMetrics,
    metric(
      "conversation-list.full-parse.p50-ms",
      "Conversation list full parse p50",
      "ms",
      before.p50Ms,
      "lower-is-better",
      "conversation-list",
    ),
    metric(
      "conversation-list.full-parse.p95-ms",
      "Conversation list full parse p95",
      "ms",
      beforeP95,
      "lower-is-better",
      "conversation-list",
    ),
    metric(
      "conversation-list.warm-cache.p50-ms",
      "Conversation list warm cache p50",
      "ms",
      after.p50Ms,
      "lower-is-better",
      "conversation-list",
    ),
    metric(
      "conversation-list.warm-cache.p95-ms",
      "Conversation list warm cache p95",
      "ms",
      afterP95,
      "lower-is-better",
      "conversation-list",
    ),
    metric(
      "conversation-list.full-parse.bytes",
      "Conversation list full parse bytes",
      "bytes",
      beforeBytes,
      "lower-is-better",
      "conversation-list",
    ),
    metric(
      "conversation-list.warm-cache.bytes",
      "Conversation list warm cache bytes",
      "bytes",
      afterBytes,
      "lower-is-better",
      "conversation-list",
    ),
    metric(
      "conversation-list.cache-hit-rate",
      "Conversation list cache hit rate",
      "percent",
      finiteNumber(conversation.cacheHitRate, "conversation cacheHitRate") * 100,
      "higher-is-better",
      "conversation-list",
    ),
  ];
}

function reliabilityMetrics(reliability) {
  if (!reliability?.operations || typeof reliability.operations !== "object") {
    throw new Error("daemon reliability benchmark is missing operations");
  }

  return Object.entries(reliability.operations).flatMap(([operation, summary]) => [
    metric(
      `daemon-reliability.${operation}.success-rate`,
      `${operation.replaceAll("_", " ")} success rate`,
      "percent",
      finiteNumber(summary.successRate, `${operation} successRate`) * 100,
      "higher-is-better",
      "daemon-reliability",
    ),
    metric(
      `daemon-reliability.${operation}.successful-p95-ms`,
      `${operation.replaceAll("_", " ")} successful p95`,
      "ms",
      finiteNumber(summary.successfulDurationMs?.p95, `${operation} successful p95`),
      "lower-is-better",
      "daemon-reliability",
    ),
  ]);
}

function compareMetric(current, previous, thresholdPct) {
  if (!previous || previous.unit !== current.unit || previous.direction !== current.direction) {
    return null;
  }

  const delta = current.value - previous.value;
  const percentChange = previous.value === 0 ? null : (delta / Math.abs(previous.value)) * 100;
  const directionalChangePct = percentChange === null
    ? null
    : current.direction === "lower-is-better"
    ? percentChange
    : -percentChange;
  const verdict = directionalChangePct === null
    ? "unrated"
    : directionalChangePct > thresholdPct
    ? "regression"
    : directionalChangePct < -thresholdPct
    ? "improvement"
    : "stable";

  return {
    baselineValue: previous.value,
    delta,
    percentChange,
    verdict,
  };
}

function historyPoint(report) {
  return {
    sha: report.sha,
    runId: report.runId,
    generatedAt: report.generatedAt,
    status: report.summary?.status ?? "unknown",
    metrics: Object.fromEntries(
      Array.isArray(report.metrics)
        ? report.metrics.map((entry) => [entry.id, entry.value])
        : [],
    ),
  };
}

export function buildPerformanceReport({
  conversation,
  reliability,
  metadata,
  baselineReport = null,
  regressionThresholdPct = DEFAULT_REGRESSION_THRESHOLD_PCT,
  budgetCatalogue = PERFORMANCE_BUDGETS,
}) {
  finiteNumber(regressionThresholdPct, "regressionThresholdPct");
  if (regressionThresholdPct < 0) throw new Error("regressionThresholdPct must be non-negative");

  const previousMetrics = new Map(
    Array.isArray(baselineReport?.metrics)
      ? baselineReport.metrics.map((entry) => [entry.id, entry])
      : [],
  );
  const metrics = [...conversationMetrics(conversation), ...reliabilityMetrics(reliability)].map(
    (entry) => ({
      ...entry,
      comparison: compareMetric(entry, previousMetrics.get(entry.id), regressionThresholdPct),
    }),
  );
  const regressionCount = metrics.filter(
    (entry) => entry.comparison?.verdict === "regression",
  ).length;
  const improvementCount = metrics.filter(
    (entry) => entry.comparison?.verdict === "improvement",
  ).length;
  const reliabilityPass = reliability.pass === true;
  const budgets = evaluatePerformanceBudgets(metrics, budgetCatalogue, {
    fixtureProfile: conversation.fixture?.profile ?? null,
  });
  // A breached absolute budget is a harder signal than a percentage drift from
  // the previous run, so it fails the report outright rather than waiting for
  // --fail-on-regression. Baseline comparison catches erosion; this catches a
  // number that has left the approved envelope regardless of how it got there.
  const status = !reliabilityPass || !budgets.pass
    ? "fail"
    : regressionCount > 0
    ? "regression"
    : "pass";
  const report = {
    schemaVersion: 1,
    repository: metadata.repository,
    ref: metadata.ref,
    sha: metadata.sha,
    workflow: metadata.workflow,
    runId: metadata.runId,
    runAttempt: metadata.runAttempt,
    lane: LANE,
    generatedAt: metadata.generatedAt,
    runtime: metadata.runtime,
    baseline: baselineReport
      ? {
          sha: baselineReport.sha,
          runId: baselineReport.runId,
          generatedAt: baselineReport.generatedAt,
        }
      : null,
    controls: {
      regressionThresholdPct,
      conversationFixture: conversation.fixture,
      daemonReliabilityBaseline: reliability.baseline,
    },
    summary: {
      status,
      metricCount: metrics.length,
      regressionCount,
      improvementCount,
      reliabilityPass,
      budgetPass: budgets.pass,
      budgetBreachCount: budgets.breachCount,
      budgetUnmeasuredCount: budgets.unmeasuredCount,
      historyPoints: 0,
    },
    budgets,
    metrics,
    benchmarks: {
      conversationList: conversation,
      daemonReliability: reliability,
    },
  };
  const inheritedHistory = Array.isArray(baselineReport?.history)
    ? baselineReport.history
    : baselineReport
    ? [historyPoint(baselineReport)]
    : [];
  report.history = [...inheritedHistory, historyPoint(report)].slice(-HISTORY_LIMIT);
  report.summary.historyPoints = report.history.length;
  return report;
}

function formatMetricValue(value, unit) {
  if (unit === "bytes") return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "ms") return `${value.toFixed(2)} ms`;
  return String(value);
}

function formatDelta(comparison) {
  if (!comparison) return "—";
  if (comparison.percentChange === null) return "unrated";
  const sign = comparison.percentChange > 0 ? "+" : "";
  return `${sign}${comparison.percentChange.toFixed(2)}%`;
}

function formatBudgetLimit(result) {
  // A postbuild entry carries no limit on purpose — its gate owns the number.
  if (result.budget.limit === null) return "—";
  const comparator = result.budget.direction === "lower-is-better" ? "≤" : "≥";
  return `${comparator} ${formatMetricValue(result.budget.limit, result.budget.unit)}`;
}

function budgetRow(result) {
  const value = result.value === null
    ? "—"
    : formatMetricValue(result.value, result.budget.unit);
  const headroom = result.headroomPct === null
    ? result.budget.gate === "postbuild"
      ? `enforced by \`${result.budget.source}\``
      : result.note ?? result.budget.source
    : `${result.headroomPct.toFixed(1)}%` +
      (result.headroomPct < THIN_HEADROOM_PCT ? " ⚠ THIN" : "");
  return `| ${result.budget.surface} | ${result.budget.label} | ${value} | ${formatBudgetLimit(result)} | ${headroom} | ${result.verdict} |`;
}

export function renderPerformanceReportMarkdown(report) {
  const rows = report.metrics.map((entry) => {
    const baseline = entry.comparison
      ? formatMetricValue(entry.comparison.baselineValue, entry.unit)
      : "—";
    const verdict = entry.comparison?.verdict ?? "baseline";
    return `| ${entry.label} | ${formatMetricValue(entry.value, entry.unit)} | ${baseline} | ${formatDelta(entry.comparison)} | ${verdict} |`;
  });
  const reliabilityRows = Object.entries(report.benchmarks.daemonReliability.operations).map(
    ([operation, summary]) =>
      `| ${operation.replaceAll("_", " ")} | ${(summary.successRate * 100).toFixed(2)}% | ${formatMetricValue(summary.successfulDurationMs.p95, "ms")} | ${summary.pass ? "pass" : "fail"} |`,
  );
  const baselineLine = report.baseline
    ? `Compared with ${report.baseline.sha} from run ${report.baseline.runId}.`
    : "No previous report was available; this run seeds the timeline.";

  return `# Cave Performance Report

- Status: **${report.summary.status.toUpperCase()}**
- Ref: \`${report.ref}\`
- Commit: \`${report.sha}\`
- Run: \`${report.runId}\` (attempt ${report.runAttempt})
- Generated: ${report.generatedAt}
- Metrics: ${report.summary.metricCount}
- History points: ${report.summary.historyPoints}
- Regressions: ${report.summary.regressionCount}
- Improvements: ${report.summary.improvementCount}

${baselineLine} A directional change greater than ${report.controls.regressionThresholdPct}% is classified as a regression or improvement.

## Tracked metrics

| Metric | Current | Previous | Change | Verdict |
| --- | ---: | ---: | ---: | --- |
${rows.join("\n")}

## Production budgets

- Budget verdict: **${report.summary.budgetPass ? "PASS" : "FAIL"}**
- Enforced here: ${report.budgets.enforcedCount} · breached: ${report.budgets.breachCount} · unmeasured: ${report.budgets.unmeasuredCount}
- Enforced by a build gate: ${report.budgets.delegatedCount} · awaiting a fixture: ${report.budgets.pendingCount}
- Fixture profile: \`${report.controls.conversationFixture?.profile ?? "unknown"}\` (${report.controls.conversationFixture?.fileCount ?? "?"} conversations)

An enforced budget with no measurement counts as a failure, not a pass: a
benchmark that never ran must not read as a clean run.

| Surface | Budget | Measured | Limit | Headroom | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
${report.budgets.results.map(budgetRow).join("\n")}

## Daemon reliability contract

| Operation | Success rate | Successful p95 | Budget |
| --- | ---: | ---: | --- |
${reliabilityRows.join("\n")}

## Scope

This lane measures Cave's conversation-list scan/cache path and its deterministic daemon startup, reconnect, and recovery contract. The JSON report retains the raw benchmark payloads for future analysis.
`;
}

function safeSegment(value, label) {
  const normalized = String(value ?? "")
    .replace(/^refs\/heads\//, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error(`${label} does not contain a safe path segment`);
  }
  return normalized;
}

export async function writePerformanceReport({ outputRoot, report }) {
  const ref = safeSegment(report.ref, "ref");
  const run = `${safeSegment(report.runId, "runId")}-${safeSegment(report.runAttempt, "runAttempt")}`;
  const relativeDirectory = path.posix.join(ref, run, LANE);
  const reportDirectory = path.join(outputRoot, ...relativeDirectory.split("/"));
  const reportJsonPath = path.join(reportDirectory, "report.json");
  const indexPath = path.join(reportDirectory, "index.md");
  const pointerPath = path.join(outputRoot, ref, `latest-${LANE}.json`);
  const pointer = {
    repository: report.repository,
    ref: report.ref,
    sha: report.sha,
    workflow: report.workflow,
    runId: report.runId,
    runAttempt: report.runAttempt,
    lane: report.lane,
    path: relativeDirectory,
  };

  await mkdir(reportDirectory, { recursive: true });
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(indexPath, renderPerformanceReportMarkdown(report), "utf8");
  await mkdir(path.dirname(pointerPath), { recursive: true });
  await writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");

  return { reportJsonPath, indexPath, pointerPath, pointer };
}

function parseArgs(argv) {
  const options = {
    output: path.join(projectRoot, "artifacts", "cave-performance"),
    baseline: null,
    generatedAt: new Date().toISOString(),
    regressionThresholdPct: DEFAULT_REGRESSION_THRESHOLD_PCT,
    failOnRegression: false,
  };
  const valueOptions = new Set([
    "--output",
    "--baseline",
    "--generated-at",
    "--regression-threshold-pct",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fail-on-regression") {
      options.failOnRegression = true;
      continue;
    }
    if (!valueOptions.has(argument)) throw new Error(`unknown option: ${argument}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === "--output") options.output = path.resolve(value);
    if (argument === "--baseline") options.baseline = path.resolve(value);
    if (argument === "--generated-at") options.generatedAt = new Date(value).toISOString();
    if (argument === "--regression-threshold-pct") {
      options.regressionThresholdPct = Number(value);
    }
  }
  return options;
}

function runJsonBenchmark(script, { allowNonzero = false } = {}) {
  const env = { ...process.env };
  // An explicit choice always wins; this only supplies the budgeted default.
  if (!env.CAVE_BENCH_PROFILE && BUDGETED_FIXTURE_PROFILE) {
    env.CAVE_BENCH_PROFILE = BUDGETED_FIXTURE_PROFILE;
  }
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(projectRoot, "scripts", script)],
    {
      cwd: projectRoot,
      env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowNonzero) {
    throw new Error(`${script} failed (${result.status}): ${result.stderr.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const status = result.status === 0 ? "" : ` after exiting ${result.status}`;
    throw new Error(`${script} emitted invalid JSON${status}: ${error.message}`);
  }
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baselineReport = options.baseline
    ? JSON.parse(await readFile(options.baseline, "utf8"))
    : null;
  const generatedAt = options.generatedAt;
  const reliability = runJsonBenchmark("daemon-reliability-benchmark.mjs", {
    allowNonzero: true,
  });
  const report = buildPerformanceReport({
    conversation: runJsonBenchmark("conversation-list-benchmark.mjs"),
    reliability,
    metadata: {
      repository: process.env.GITHUB_REPOSITORY || "OpenCoven/coven-cave",
      ref: process.env.GITHUB_REF_NAME || "local",
      sha: process.env.GITHUB_SHA || gitHead(),
      workflow: process.env.GITHUB_WORKFLOW || "local",
      runId: process.env.GITHUB_RUN_ID || `local-${generatedAt.replace(/[^0-9]/g, "")}`,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || "1",
      generatedAt,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    },
    baselineReport,
    regressionThresholdPct: options.regressionThresholdPct,
  });
  const written = await writePerformanceReport({ outputRoot: options.output, report });
  process.stdout.write(
    `${JSON.stringify({
      status: report.summary.status,
      regressions: report.summary.regressionCount,
      budgetBreaches: report.summary.budgetBreachCount,
      budgetUnmeasured: report.summary.budgetUnmeasuredCount,
      report: written.reportJsonPath,
      index: written.indexPath,
      pointer: written.pointerPath,
    }, null, 2)}\n`,
  );
  for (const result of report.budgets.results) {
    if (result.verdict === "breach") {
      console.error(
        `cave-performance-report: ${result.budget.id} breached its budget ` +
          `(${result.value} vs ${result.budget.direction === "lower-is-better" ? "max" : "min"} ${result.budget.limit} ${result.budget.unit})`,
      );
    }
    if (result.verdict === "unmeasured") {
      console.error(
        `cave-performance-report: ${result.budget.id} is enforced but unmeasured — ` +
          `${result.note ?? "no run produced it"} (${result.budget.source})`,
      );
    }
  }
  if (
    !report.summary.reliabilityPass ||
    !report.summary.budgetPass ||
    (options.failOnRegression && report.summary.regressionCount > 0)
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`cave-performance-report: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
