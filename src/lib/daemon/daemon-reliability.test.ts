import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateDaemonReliability,
  classifyDaemonConnectionFailure,
  createTauriDaemonReliabilityObserver,
  daemonReliabilityDistribution,
  evaluateDaemonReliabilityBudgets,
  normalizeDaemonReliabilityMeasurement,
  type DaemonReliabilityMeasurement,
} from "./daemon-reliability.ts";

function measurement(
  input: Partial<DaemonReliabilityMeasurement>,
): DaemonReliabilityMeasurement {
  return {
    schemaVersion: 1,
    recordedAtUnixMs: 1,
    source: "benchmark",
    operation: "frontend_reconnect",
    outcome: "success",
    readiness: "authenticated",
    durationMs: 100,
    attempts: 1,
    backoffMs: 0,
    timeoutMs: 30_000,
    crashCount: 0,
    restartCount: 0,
    ...input,
  };
}

test("normalization retains only the privacy-safe schema and clamps numeric fields", () => {
  const input = {
    operation: "frontend_reconnect",
    outcome: "failure",
    failureClass: "transport",
    readiness: "none",
    durationMs: Number.POSITIVE_INFINITY,
    attempts: -5,
    backoffMs: 999_999_999,
    timeoutMs: 1.2,
    crashCount: 3,
    restartCount: 4,
    url: "http://token@example.test/private",
    error: "secret local path",
  } as const;

  const normalized = normalizeDaemonReliabilityMeasurement(input);

  assert.deepEqual(Object.keys(normalized).sort(), [
    "attempts",
    "backoffMs",
    "crashCount",
    "durationMs",
    "failureClass",
    "operation",
    "outcome",
    "readiness",
    "restartCount",
    "timeoutMs",
  ]);
  assert.equal(normalized.durationMs, 0);
  assert.equal(normalized.attempts, 0);
  assert.equal(normalized.backoffMs, 86_400_000);
  assert.equal(JSON.stringify(normalized).includes("token@example"), false);
  assert.equal(JSON.stringify(normalized).includes("secret local path"), false);

  const unverified = normalizeDaemonReliabilityMeasurement({
    ...normalized,
    outcome: "success",
    readiness: "transport",
  });
  assert.equal(unverified.outcome, "unverified");

  const blocked = normalizeDaemonReliabilityMeasurement({
    ...normalized,
    outcome: "failure",
    failureClass: "contention",
  });
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.readiness, "none");
});

test("nearest-rank distributions are deterministic for small and large samples", () => {
  assert.deepEqual(daemonReliabilityDistribution([]), {
    count: 0,
    p50: null,
    p95: null,
    max: null,
  });
  assert.deepEqual(daemonReliabilityDistribution([50, 10, 30, 20, 40]), {
    count: 5,
    p50: 30,
    p95: 50,
    max: 50,
  });
  assert.equal(
    daemonReliabilityDistribution(Array.from({ length: 100 }, (_, index) => index + 1)).p95,
    95,
  );
});

test("blocked and cancelled runs are excluded while transport-only readiness is not success", () => {
  const summaries = aggregateDaemonReliability([
    measurement({ outcome: "success", readiness: "authenticated" }),
    measurement({ outcome: "blocked", failureClass: "contention" }),
    measurement({ outcome: "cancelled", failureClass: "cancellation" }),
    measurement({ outcome: "unverified", readiness: "transport" }),
  ]);

  assert.equal(summaries.frontend_reconnect.count, 4);
  assert.equal(summaries.frontend_reconnect.eligibleCount, 2);
  assert.equal(summaries.frontend_reconnect.successCount, 1);
  assert.equal(summaries.frontend_reconnect.successRate, 0.5);
  assert.equal(summaries.frontend_reconnect.blockedCount, 1);
  assert.equal(summaries.frontend_reconnect.unverifiedCount, 1);
  assert.deepEqual(summaries.frontend_reconnect.failureClassCounts, {
    contention: 1,
    cancellation: 1,
  });
});

test("connection failures retain stable diagnostic classes", () => {
  assert.equal(classifyDaemonConnectionFailure({
    poll: { responseStatus: 401 },
    status: { kind: "auth-expired" },
  }), "authentication");
  assert.equal(classifyDaemonConnectionFailure({
    poll: { responseStatus: 403 },
    status: { kind: "unavailable", reason: "forbidden" },
  }), "permissions");
  assert.equal(classifyDaemonConnectionFailure({
    poll: { responseStatus: 426 },
    status: { kind: "unavailable", reason: "upgrade" },
  }), "compatibility");
  assert.equal(classifyDaemonConnectionFailure({
    poll: { responseStatus: 423 },
    status: { kind: "unavailable", reason: "busy" },
  }), "contention");
  assert.equal(classifyDaemonConnectionFailure({
    poll: { responseStatus: 504 },
    status: { kind: "unavailable", reason: "timeout" },
  }), "timeout");
  assert.equal(classifyDaemonConnectionFailure({
    poll: { responseStatus: 0 },
    status: { kind: "offline", targetMode: "local" },
  }), "transport");
});

test("Tauri observer is a no-op outside Tauri and warns at most once on persistence failure", async () => {
  const calls: unknown[] = [];
  const warnings: string[] = [];
  const outside = createTauriDaemonReliabilityObserver({
    tauriAvailable: () => false,
    invoke: async (...args) => calls.push(args),
  });
  outside(normalizeDaemonReliabilityMeasurement({
    operation: "frontend_reconnect",
    outcome: "success",
    readiness: "authenticated",
    durationMs: 1,
    attempts: 1,
    backoffMs: 0,
    timeoutMs: 1,
    crashCount: 0,
    restartCount: 0,
  }));
  assert.equal(calls.length, 0);

  const inside = createTauriDaemonReliabilityObserver({
    tauriAvailable: () => true,
    invoke: async () => {
      throw new Error("private details");
    },
    warn: (message) => warnings.push(message),
  });
  inside(normalizeDaemonReliabilityMeasurement({
    operation: "frontend_reconnect",
    outcome: "failure",
    failureClass: "transport",
    readiness: "none",
    durationMs: 1,
    attempts: 1,
    backoffMs: 5_000,
    timeoutMs: 30_000,
    crashCount: 0,
    restartCount: 0,
  }));
  inside(normalizeDaemonReliabilityMeasurement({
    operation: "frontend_reconnect",
    outcome: "failure",
    failureClass: "transport",
    readiness: "none",
    durationMs: 2,
    attempts: 2,
    backoffMs: 10_000,
    timeoutMs: 30_000,
    crashCount: 0,
    restartCount: 0,
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(warnings, [
    "[cave] daemon reliability measurement persistence is unavailable",
  ]);
});

test("budget evaluation requires both authenticated success rate and successful latency", () => {
  const summaries = aggregateDaemonReliability([
    measurement({ operation: "native_startup", durationMs: 1_000 }),
    measurement({ operation: "frontend_reconnect", durationMs: 1_000 }),
    measurement({ operation: "supervised_recovery", durationMs: 1_000 }),
  ]);
  const result = evaluateDaemonReliabilityBudgets(summaries, {
    native_startup: { minimumSuccessRate: 1, maximumSuccessfulP95Ms: 1_000 },
    frontend_reconnect: { minimumSuccessRate: 1, maximumSuccessfulP95Ms: 1_000 },
    supervised_recovery: { minimumSuccessRate: 1, maximumSuccessfulP95Ms: 1_000 },
  });
  assert.equal(result.pass, true);
});
