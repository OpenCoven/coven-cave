import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicDaemonReliabilityScenarios,
  runDaemonReliabilityBenchmark,
  validateDaemonReliabilityRecords,
} from "./daemon-reliability-benchmark.mjs";

test("deterministic daemon reliability benchmark exercises every classification and passes", () => {
  const records = deterministicDaemonReliabilityScenarios();
  const result = runDaemonReliabilityBenchmark(records);

  assert.equal(result.pass, true);
  assert.equal(result.operations.native_startup.blockedCount, 2);
  assert.equal(result.operations.native_startup.unverifiedCount, 1);
  assert.equal(result.operations.native_startup.successCount, 95);
  assert.equal(result.operations.native_startup.failureClassCounts.timeout, 1);
  assert.equal(result.operations.frontend_reconnect.failureClassCounts.authentication, 1);
  assert.equal(result.operations.frontend_reconnect.failureClassCounts.transport, 1);
  assert.equal(result.operations.supervised_recovery.failureClassCounts.process_exit, 1);
  assert.equal(result.operations.supervised_recovery.failureClassCounts.timeout, 1);
  assert.equal(result.operations.supervised_recovery.successfulDurationMs.p95, 28_000);
  assert.ok(records
    .filter((record) => record.operation === "frontend_reconnect")
    .every((record) => record.timeoutMs === 30_000));
  assert.ok(records
    .filter((record) => record.operation === "supervised_recovery")
    .every((record) => record.timeoutMs === 90_000));
  const recoveryRecords = records.filter((record) =>
    record.operation === "supervised_recovery"
  );
  assert.ok(recoveryRecords.every((record) => record.restartCount <= 1));
  assert.ok(recoveryRecords
    .filter((record) => record.outcome === "success" || record.outcome === "unverified")
    .every((record) => record.restartCount === 1));
  assert.ok(recoveryRecords
    .filter((record) => record.outcome !== "success" && record.outcome !== "unverified")
    .every((record) => record.restartCount === 0));
  assert.equal(
    records.find((record) =>
      record.operation === "supervised_recovery" && record.attempts === 4
    )?.backoffMs,
    14_250,
  );
});

test("transport-only readiness cannot satisfy a success budget", () => {
  const result = runDaemonReliabilityBenchmark([
    {
      schemaVersion: 1,
      recordedAtUnixMs: 0,
      source: "benchmark",
      operation: "native_startup",
      outcome: "unverified",
      readiness: "transport",
      durationMs: 1,
      attempts: 1,
      backoffMs: 0,
      timeoutMs: 60_000,
      crashCount: 0,
      restartCount: 0,
    },
  ], {
    native_startup: { minimumSuccessRate: 1, maximumSuccessfulP95Ms: 60_000 },
    frontend_reconnect: { minimumSuccessRate: 0, maximumSuccessfulP95Ms: 60_000 },
    supervised_recovery: { minimumSuccessRate: 0, maximumSuccessfulP95Ms: 60_000 },
  });

  assert.equal(result.operations.native_startup.successCount, 0);
  assert.equal(result.operations.native_startup.successRate, 0);
  assert.equal(result.operations.native_startup.pass, false);
});

test("fixture validation rejects arbitrary diagnostic fields", () => {
  assert.throws(() => validateDaemonReliabilityRecords([{
    ...deterministicDaemonReliabilityScenarios()[0],
    url: "http://token@example.test/private",
  }]), /unsupported field url/);
});
