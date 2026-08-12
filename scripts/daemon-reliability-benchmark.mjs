import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  aggregateDaemonReliability,
  DAEMON_RELIABILITY_BUDGETS,
  DAEMON_RELIABILITY_FAILURE_CLASSES,
  DAEMON_RELIABILITY_OPERATIONS,
  DAEMON_RELIABILITY_OUTCOMES,
  evaluateDaemonReliabilityBudgets,
  normalizeDaemonReliabilityMeasurement,
} from "../src/lib/daemon-reliability.ts";

const FIXTURE_KEYS = new Set([
  "schemaVersion",
  "recordedAtUnixMs",
  "source",
  "operation",
  "outcome",
  "failureClass",
  "readiness",
  "durationMs",
  "attempts",
  "backoffMs",
  "timeoutMs",
  "crashCount",
  "restartCount",
]);
const READINESS_VALUES = new Set(["authenticated", "transport", "none"]);
const SOURCE_VALUES = new Set(["native", "frontend", "benchmark"]);

function record(operation, outcome, readiness, durationMs, options = {}) {
  const timeoutMs = operation === "frontend_reconnect"
    ? 30_000
    : operation === "supervised_recovery"
    ? 90_000
    : 60_000;
  return {
    schemaVersion: 1,
    recordedAtUnixMs: 0,
    source: "benchmark",
    operation,
    outcome,
    readiness,
    durationMs,
    attempts: options.attempts ?? 1,
    backoffMs: options.backoffMs ?? 0,
    timeoutMs: options.timeoutMs ?? timeoutMs,
    crashCount: options.crashCount ?? 0,
    restartCount: options.restartCount ?? 0,
    ...(options.failureClass ? { failureClass: options.failureClass } : {}),
  };
}

export function deterministicDaemonReliabilityScenarios() {
  const records = [];
  for (let index = 0; index < 95; index += 1) {
    records.push(record(
      "native_startup",
      "success",
      "authenticated",
      2_000 + (index % 12) * 1_000,
      { timeoutMs: 60_000 },
    ));
  }
  records.push(
    record("native_startup", "failure", "none", 5_000, {
      failureClass: "compatibility",
    }),
    record("native_startup", "failure", "none", 4_000, {
      failureClass: "permissions",
    }),
    record("native_startup", "failure", "none", 60_000, {
      failureClass: "timeout",
    }),
    record("native_startup", "unverified", "transport", 3_000),
    record("native_startup", "blocked", "none", 250, {
      failureClass: "contention",
    }),
    record("native_startup", "blocked", "none", 250, {
      failureClass: "contention",
    }),
  );

  for (let index = 0; index < 200; index += 1) {
    records.push(record(
      "frontend_reconnect",
      "success",
      "authenticated",
      500 + (index % 20) * 500,
      {
        attempts: 1 + (index % 3),
        backoffMs: index % 3 === 0 ? 5_000 : 0,
        timeoutMs: 30_000,
      },
    ));
  }
  records.push(
    record("frontend_reconnect", "failure", "none", 4_000, {
      failureClass: "authentication",
      timeoutMs: 30_000,
    }),
    record("frontend_reconnect", "failure", "none", 30_000, {
      failureClass: "transport",
      timeoutMs: 30_000,
    }),
    record("frontend_reconnect", "blocked", "none", 1_000, {
      failureClass: "contention",
      timeoutMs: 30_000,
    }),
    record("frontend_reconnect", "cancelled", "none", 500, {
      failureClass: "cancellation",
      timeoutMs: 30_000,
    }),
  );

  for (let index = 0; index < 27; index += 1) {
    records.push(record(
      "supervised_recovery",
      "success",
      "authenticated",
      3_000 + (index % 6) * 5_000,
      {
        attempts: 1 + (index % 4),
        backoffMs: [250, 2_250, 6_250, 14_250][index % 4],
        crashCount: 1,
        restartCount: 1,
        timeoutMs: 90_000,
      },
    ));
  }
  records.push(
    record("supervised_recovery", "failure", "none", 60_000, {
      failureClass: "process_exit",
      attempts: 4,
      backoffMs: 14_250,
      crashCount: 1,
      timeoutMs: 90_000,
    }),
    record("supervised_recovery", "failure", "none", 90_000, {
      failureClass: "timeout",
      attempts: 4,
      backoffMs: 14_250,
      crashCount: 1,
      timeoutMs: 90_000,
    }),
    record("supervised_recovery", "unverified", "transport", 10_000, {
      attempts: 1,
      backoffMs: 250,
      crashCount: 1,
      restartCount: 1,
      timeoutMs: 90_000,
    }),
    record("supervised_recovery", "blocked", "none", 250, {
      failureClass: "contention",
      crashCount: 1,
      timeoutMs: 90_000,
    }),
    record("supervised_recovery", "cancelled", "none", 2_000, {
      failureClass: "cancellation",
      crashCount: 1,
      timeoutMs: 90_000,
    }),
  );
  return records;
}

function parseArgs(argv) {
  const fixtureIndex = argv.indexOf("--fixture");
  if (fixtureIndex === -1) return { fixture: null };
  const fixture = argv[fixtureIndex + 1];
  if (!fixture) throw new Error("--fixture requires a JSON path");
  return { fixture };
}

function fixtureRecords(path) {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  return validateDaemonReliabilityRecords(parsed);
}

export function validateDaemonReliabilityRecords(input) {
  if (!Array.isArray(input)) throw new Error("fixture must be a JSON array");
  return input.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`fixture record ${index} must be an object`);
    }
    for (const key of Object.keys(value)) {
      if (!FIXTURE_KEYS.has(key)) {
        throw new Error(`fixture record ${index} contains unsupported field ${key}`);
      }
    }
    if (
      value.schemaVersion !== 1 ||
      !SOURCE_VALUES.has(value.source) ||
      !DAEMON_RELIABILITY_OPERATIONS.includes(value.operation) ||
      !DAEMON_RELIABILITY_OUTCOMES.includes(value.outcome) ||
      !READINESS_VALUES.has(value.readiness) ||
      (value.failureClass !== undefined &&
        !DAEMON_RELIABILITY_FAILURE_CLASSES.includes(value.failureClass))
    ) {
      throw new Error(`fixture record ${index} does not match reliability schema v1`);
    }
    for (
      const key of [
        "recordedAtUnixMs",
        "durationMs",
        "attempts",
        "backoffMs",
        "timeoutMs",
        "crashCount",
        "restartCount",
      ]
    ) {
      if (!Number.isFinite(value[key]) || value[key] < 0) {
        throw new Error(`fixture record ${index} has invalid ${key}`);
      }
    }
    return {
      schemaVersion: 1,
      recordedAtUnixMs: Math.round(value.recordedAtUnixMs),
      source: value.source,
      ...normalizeDaemonReliabilityMeasurement(value),
    };
  });
}

export function runDaemonReliabilityBenchmark(records, budgets = DAEMON_RELIABILITY_BUDGETS) {
  const summaries = aggregateDaemonReliability(records);
  const evaluation = evaluateDaemonReliabilityBudgets(summaries, budgets);
  return {
    schemaVersion: 1,
    baseline: "deterministic-fault-contract",
    records: records.length,
    pass: evaluation.pass,
    operations: Object.fromEntries(
      Object.entries(summaries).map(([operation, summary]) => [
        operation,
        {
          ...summary,
          budget: evaluation.operations[operation].budget,
          pass: evaluation.operations[operation].pass,
          checks: {
            successRate: evaluation.operations[operation].successRatePass,
            successfulP95: evaluation.operations[operation].latencyPass,
          },
        },
      ]),
    ),
  };
}

function main() {
  const { fixture } = parseArgs(process.argv.slice(2));
  const records = fixture
    ? fixtureRecords(fixture)
    : deterministicDaemonReliabilityScenarios();
  const result = runDaemonReliabilityBenchmark(records);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
