import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parse } from "yaml";

import {
  buildPerformanceReport,
  renderPerformanceReportMarkdown,
  writePerformanceReport,
} from "./cave-performance-report.mjs";

function conversation({ warmP95 = 8, cacheHitRate = 1 } = {}) {
  return {
    fixture: { fileCount: 10, transcriptBytes: 1024, iterations: 5 },
    before: {
      label: "full transcript parse",
      p50Ms: 10,
      p95Ms: 20,
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
  const baseline = buildPerformanceReport({
    conversation: conversation(),
    reliability: reliability(),
    metadata: metadata({ sha: "b".repeat(40), runId: "16" }),
  });
  const report = buildPerformanceReport({
    conversation: conversation({ warmP95: 12, cacheHitRate: 0.7 }),
    reliability: reliability(),
    metadata: metadata(),
    baselineReport: baseline,
    regressionThresholdPct: 15,
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
  assert.equal(upload.if, "always()");
  assert.equal(
    upload.uses,
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  );
  assert.equal(upload.with["if-no-files-found"], "error");
});
