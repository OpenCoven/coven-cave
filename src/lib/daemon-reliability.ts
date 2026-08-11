import type { DaemonStatusPollResult } from "./daemon-status-classification.ts";
import { isTauri } from "./tauri-platform.ts";

export const DAEMON_RELIABILITY_SCHEMA_VERSION = 1 as const;

export const DAEMON_RELIABILITY_OPERATIONS = [
  "native_startup",
  "frontend_reconnect",
  "supervised_recovery",
] as const;
export type DaemonReliabilityOperation = typeof DAEMON_RELIABILITY_OPERATIONS[number];

export const DAEMON_RELIABILITY_OUTCOMES = [
  "success",
  "failure",
  "blocked",
  "cancelled",
  "unverified",
] as const;
export type DaemonReliabilityOutcome = typeof DAEMON_RELIABILITY_OUTCOMES[number];

export const DAEMON_RELIABILITY_FAILURE_CLASSES = [
  "contention",
  "compatibility",
  "permissions",
  "transport",
  "authentication",
  "timeout",
  "process_exit",
  "cancellation",
  "unknown",
] as const;
export type DaemonReliabilityFailureClass =
  typeof DAEMON_RELIABILITY_FAILURE_CLASSES[number];

export type DaemonReliabilityReadiness =
  | "authenticated"
  | "transport"
  | "none";

export type DaemonReliabilityMeasurementInput = {
  operation: DaemonReliabilityOperation;
  outcome: DaemonReliabilityOutcome;
  failureClass?: DaemonReliabilityFailureClass;
  readiness: DaemonReliabilityReadiness;
  durationMs: number;
  attempts: number;
  backoffMs: number;
  timeoutMs: number;
  crashCount: number;
  restartCount: number;
};

export type DaemonReliabilityMeasurement = DaemonReliabilityMeasurementInput & {
  schemaVersion: typeof DAEMON_RELIABILITY_SCHEMA_VERSION;
  recordedAtUnixMs: number;
  source: "native" | "frontend" | "benchmark";
};

export type DaemonReliabilityDistribution = {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

export type DaemonReliabilityOperationSummary = {
  count: number;
  eligibleCount: number;
  successCount: number;
  failureCount: number;
  unverifiedCount: number;
  blockedCount: number;
  cancelledCount: number;
  successRate: number | null;
  durationMs: DaemonReliabilityDistribution;
  successfulDurationMs: DaemonReliabilityDistribution;
  failureClassCounts: Partial<Record<DaemonReliabilityFailureClass, number>>;
};

export type DaemonReliabilityBudget = {
  minimumSuccessRate: number;
  maximumSuccessfulP95Ms: number;
};

export const DAEMON_RELIABILITY_BUDGETS: Record<
  DaemonReliabilityOperation,
  DaemonReliabilityBudget
> = {
  native_startup: {
    minimumSuccessRate: 0.95,
    maximumSuccessfulP95Ms: 60_000,
  },
  frontend_reconnect: {
    minimumSuccessRate: 0.99,
    maximumSuccessfulP95Ms: 30_000,
  },
  supervised_recovery: {
    minimumSuccessRate: 0.90,
    maximumSuccessfulP95Ms: 90_000,
  },
};

const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_DELAY_MS = 24 * 60 * 60 * 1_000;
const MAX_COUNT = 1_000;

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

export function normalizeDaemonReliabilityMeasurement(
  input: DaemonReliabilityMeasurementInput,
): DaemonReliabilityMeasurementInput {
  const outcome = input.failureClass === "contention"
    ? "blocked"
    : input.outcome === "success" && input.readiness !== "authenticated"
    ? "unverified"
    : input.outcome;
  const failureClass = outcome === "success" ? undefined : input.failureClass;
  const readiness = outcome === "success"
    ? "authenticated"
    : outcome === "unverified" && input.readiness === "transport"
    ? "transport"
    : "none";
  return {
    operation: input.operation,
    outcome,
    ...(failureClass ? { failureClass } : {}),
    readiness,
    durationMs: boundedInteger(input.durationMs, MAX_DURATION_MS),
    attempts: boundedInteger(input.attempts, MAX_COUNT),
    backoffMs: boundedInteger(input.backoffMs, MAX_DELAY_MS),
    timeoutMs: boundedInteger(input.timeoutMs, MAX_DELAY_MS),
    crashCount: boundedInteger(input.crashCount, MAX_COUNT),
    restartCount: boundedInteger(input.restartCount, MAX_COUNT),
  };
}

export function classifyDaemonConnectionFailure(input: {
  poll: { responseStatus: number };
  status: DaemonStatusPollResult;
}): DaemonReliabilityFailureClass | undefined {
  if (input.status.kind === "running") return undefined;
  if (input.status.kind === "auth-expired" || input.poll.responseStatus === 401) {
    return "authentication";
  }
  if (input.poll.responseStatus === 403) return "permissions";
  if (input.poll.responseStatus === 409 || input.poll.responseStatus === 423) {
    return "contention";
  }
  if (input.poll.responseStatus === 426) return "compatibility";
  if (
    input.poll.responseStatus === 408 ||
    input.poll.responseStatus === 504
  ) {
    return "timeout";
  }
  return "transport";
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? null;
}

export function daemonReliabilityDistribution(
  values: number[],
): DaemonReliabilityDistribution {
  if (values.length === 0) {
    return { count: 0, p50: null, p95: null, max: null };
  }
  return {
    count: values.length,
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

export function aggregateDaemonReliability(
  measurements: DaemonReliabilityMeasurement[],
): Record<DaemonReliabilityOperation, DaemonReliabilityOperationSummary> {
  return Object.fromEntries(DAEMON_RELIABILITY_OPERATIONS.map((operation) => {
    const records = measurements.filter((record) => record.operation === operation);
    const eligible = records.filter((record) =>
      record.outcome !== "blocked" && record.outcome !== "cancelled"
    );
    const successes = eligible.filter((record) =>
      record.outcome === "success" && record.readiness === "authenticated"
    );
    const failures = eligible.filter((record) => record.outcome === "failure");
    const failureClassCounts: Partial<Record<DaemonReliabilityFailureClass, number>> = {};
    for (const record of records) {
      if (!record.failureClass) continue;
      failureClassCounts[record.failureClass] =
        (failureClassCounts[record.failureClass] ?? 0) + 1;
    }
    const summary: DaemonReliabilityOperationSummary = {
      count: records.length,
      eligibleCount: eligible.length,
      successCount: successes.length,
      failureCount: failures.length,
      unverifiedCount: eligible.filter((record) => record.outcome === "unverified").length,
      blockedCount: records.filter((record) => record.outcome === "blocked").length,
      cancelledCount: records.filter((record) => record.outcome === "cancelled").length,
      successRate: eligible.length === 0 ? null : successes.length / eligible.length,
      durationMs: daemonReliabilityDistribution(eligible.map((record) => record.durationMs)),
      successfulDurationMs: daemonReliabilityDistribution(
        successes.map((record) => record.durationMs),
      ),
      failureClassCounts,
    };
    return [operation, summary];
  })) as Record<DaemonReliabilityOperation, DaemonReliabilityOperationSummary>;
}

export function evaluateDaemonReliabilityBudgets(
  summaries: Record<DaemonReliabilityOperation, DaemonReliabilityOperationSummary>,
  budgets = DAEMON_RELIABILITY_BUDGETS,
) {
  const operations = Object.fromEntries(
    DAEMON_RELIABILITY_OPERATIONS.map((operation) => {
      const summary = summaries[operation];
      const budget = budgets[operation];
      const successRatePass = summary.successRate !== null &&
        summary.successRate >= budget.minimumSuccessRate;
      const latencyPass = summary.successfulDurationMs.p95 !== null &&
        summary.successfulDurationMs.p95 <= budget.maximumSuccessfulP95Ms;
      return [operation, {
        pass: successRatePass && latencyPass,
        successRatePass,
        latencyPass,
        budget,
      }];
    }),
  ) as Record<DaemonReliabilityOperation, {
    pass: boolean;
    successRatePass: boolean;
    latencyPass: boolean;
    budget: DaemonReliabilityBudget;
  }>;
  return {
    pass: Object.values(operations).every((operation) => operation.pass),
    operations,
  };
}

type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export function createTauriDaemonReliabilityObserver(options: {
  invoke?: Invoke;
  tauriAvailable?: () => boolean;
  warn?: (message: string) => void;
} = {}): (measurement: DaemonReliabilityMeasurementInput) => void {
  const tauriAvailable = options.tauriAvailable ?? isTauri;
  const warn = options.warn ?? ((message) => console.warn(message));
  let warned = false;

  return (measurement) => {
    if (!tauriAvailable()) return;
    const input = normalizeDaemonReliabilityMeasurement(measurement);
    const persist = async () => {
      try {
        const invoke = options.invoke ?? (await import("@tauri-apps/api/core")).invoke;
        await invoke("record_daemon_reliability_measurement", { input });
      } catch {
        if (warned) return;
        warned = true;
        warn("[cave] daemon reliability measurement persistence is unavailable");
      }
    };
    void persist();
  };
}
