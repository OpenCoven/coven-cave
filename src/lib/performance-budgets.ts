/**
 * The catalogue of Cave's approved production performance budgets.
 *
 * Every other budget in this repository is a size or a count — bundle bytes,
 * standalone file counts, sidecar closure entries — and each one is enforced by
 * its own script with its own constants. Nothing enumerated them, so "are all
 * approved production budgets machine-enforced?" could not be answered without
 * reading every gate, and a surface with no gate at all (a shell boot deadline,
 * a stream memory ceiling) was indistinguishable from one that passed.
 *
 * This module is that enumeration. Each entry names the gate that enforces it,
 * so the catalogue stays a directory rather than becoming a second, competing
 * gate over budgets that `postbuild` already owns.
 */

export const PERFORMANCE_BUDGET_SCHEMA_VERSION = 1 as const;

/** The surfaces the phase-6 hardening plan budgets. */
export const PERFORMANCE_BUDGET_SURFACES = [
  "shell",
  "list",
  "stream",
  "route",
  "bundle",
  "package",
  "cli",
] as const;
export type PerformanceBudgetSurface = typeof PERFORMANCE_BUDGET_SURFACES[number];

/**
 * Where a budget is actually enforced.
 *
 * - `performance-report` — evaluated by `scripts/cave-performance-report.mjs`
 *   against the metrics that run's benchmarks produced.
 * - `postbuild` — already enforced by a build-time gate; recorded here so the
 *   catalogue is complete, and deliberately NOT re-evaluated, because two gates
 *   over one number drift apart.
 * - `pending` — the value is approved and recorded, but no fixture produces the
 *   measurement yet. Reported on every run so the gap stays visible instead of
 *   reading as a pass.
 */
export const PERFORMANCE_BUDGET_GATES = [
  "performance-report",
  "postbuild",
  "pending",
] as const;
export type PerformanceBudgetGate = typeof PERFORMANCE_BUDGET_GATES[number];

export type PerformanceBudgetUnit = "ms" | "bytes" | "percent";
export type PerformanceBudgetDirection = "lower-is-better" | "higher-is-better";

export type PerformanceBudget = {
  /** Matches the metric id the performance report emits, when one exists. */
  id: string;
  surface: PerformanceBudgetSurface;
  label: string;
  unit: PerformanceBudgetUnit;
  direction: PerformanceBudgetDirection;
  /**
   * Ceiling for `lower-is-better`, floor for `higher-is-better`.
   *
   * `null` for a `postbuild` entry, and deliberately so: that gate owns the
   * number, and copying it here would create the second definition that
   * `scripts/budget-headroom.mjs` was extracted to avoid. A copy is not
   * inert — the first draft of this catalogue recorded 900 KB for the home
   * first-load budget while the gate's own default was 2800 KB, so the
   * directory misreported the very thing it exists to make legible.
   */
  limit: number | null;
  gate: PerformanceBudgetGate;
  /**
   * The fixture, gate, or issue that owns this number.
   *
   * Two of the three forms are machine-checked, because a `source` nobody
   * verifies is a dangling pointer that reads exactly like a live delegation:
   * - `performance-report` — `<fixture file>#<profile>`, and the profile must
   *   exist in that file.
   * - `postbuild` — `<gate script> (<constant>)`, and the constant must really
   *   be defined by that script.
   */
  source: string;
};

const LIST_FIXTURE = "fixtures/phase-6/performance-fixtures.json#phase-6-list-10k";

/**
 * Seeded on 2026-08-21 from a measured `phase-6-list-10k` run on the reference
 * machine (cold scan 1,039 ms p95 over 43.6 MB; warm scan 82 ms p95 over
 * 0 bytes; 100% cache hit rate), then given roughly 3x headroom so a slower
 * shared CI runner does not turn a healthy run red.
 *
 * These are ceilings that catch a collapse, not targets to optimise toward —
 * the report's own 20% regression comparison is what catches slow erosion. Only
 * Cave's own code is budgeted: the benchmark's raw readdir+parse control loop
 * is deliberately absent, since policing it would measure the harness.
 */
export const PERFORMANCE_BUDGETS: readonly PerformanceBudget[] = [
  {
    id: "conversation-list.cold-scan.p95-ms",
    surface: "list",
    label: "10k conversation list, cold metadata scan p95",
    unit: "ms",
    direction: "lower-is-better",
    limit: 3_000,
    gate: "performance-report",
    source: LIST_FIXTURE,
  },
  {
    id: "conversation-list.warm-cache.p95-ms",
    surface: "route",
    label: "Cave conversation read route, warm cache p95",
    unit: "ms",
    direction: "lower-is-better",
    limit: 750,
    gate: "performance-report",
    source: LIST_FIXTURE,
  },
  {
    // The cold scan reads every conversation once; the ceiling is what stops
    // that growing super-linearly with the fixture.
    id: "conversation-list.cold-scan.bytes",
    surface: "list",
    label: "10k conversation list, cold scan bytes",
    unit: "bytes",
    direction: "lower-is-better",
    limit: 64 * 1024 * 1024,
    gate: "performance-report",
    source: LIST_FIXTURE,
  },
  {
    // The metadata cache is what keeps a warm 10k list from re-reading every
    // transcript, so a bytes ceiling here is the memory-boundedness check.
    // Measured at 0 — any nonzero value means the cache stopped serving.
    id: "conversation-list.warm-cache.bytes",
    surface: "list",
    label: "10k conversation list, warm cache bytes per scan",
    unit: "bytes",
    direction: "lower-is-better",
    limit: 8 * 1024 * 1024,
    gate: "performance-report",
    source: LIST_FIXTURE,
  },
  {
    id: "conversation-list.cache-hit-rate",
    surface: "list",
    label: "10k conversation list, metadata cache hit rate",
    unit: "percent",
    direction: "higher-is-better",
    limit: 95,
    gate: "performance-report",
    source: LIST_FIXTURE,
  },
  {
    id: "bundle.home.first-load-kb",
    surface: "bundle",
    label: "Home route first-load JS",
    unit: "bytes",
    direction: "lower-is-better",
    limit: null,
    gate: "postbuild",
    source: "scripts/bundle-budget.mjs (BUNDLE_MAX_HOME_KB)",
  },
  {
    id: "package.standalone.bytes",
    surface: "package",
    label: "Next standalone artifact size",
    unit: "bytes",
    direction: "lower-is-better",
    limit: null,
    gate: "postbuild",
    source: "scripts/standalone-budget.mjs (STANDALONE_BUDGETS.unpackedBytes)",
  },
  {
    id: "shell.warm-boot.p95-ms",
    surface: "shell",
    label: "Warm shell boot to interactive p95",
    unit: "ms",
    direction: "lower-is-better",
    limit: 3_000,
    gate: "pending",
    source: "cave-o8gc4: warm/offline shell timing harness is not built yet",
  },
  {
    id: "shell.offline-boot.p95-ms",
    surface: "shell",
    label: "Offline shell boot to interactive p95",
    unit: "ms",
    direction: "lower-is-better",
    limit: 5_000,
    gate: "pending",
    source: "cave-o8gc4: warm/offline shell timing harness is not built yet",
  },
  {
    id: "stream.10k-event.input-blocking-p95-ms",
    surface: "stream",
    label: "10k-event stream, longest input-blocking task p95",
    unit: "ms",
    direction: "lower-is-better",
    limit: 200,
    gate: "pending",
    source: "cave-o8gc4: 10k-event stream fixture is not built yet",
  },
  {
    id: "cli.doctor.p95-ms",
    surface: "cli",
    label: "coven doctor wall clock p95",
    unit: "ms",
    direction: "lower-is-better",
    limit: 6_000,
    gate: "pending",
    source: "cave-o8gc4: matches EXEC_TIMEOUT_MS in src/app/api/coven/exec/route.ts",
  },
];

export type PerformanceBudgetVerdict = "pass" | "breach" | "unmeasured" | "pending" | "delegated";

export type PerformanceBudgetResult = {
  budget: PerformanceBudget;
  value: number | null;
  /** Distance to the limit in the budget's own unit; negative when breached. */
  headroom: number | null;
  headroomPct: number | null;
  verdict: PerformanceBudgetVerdict;
  /**
   * Why an `unmeasured` verdict happened, so a run can say which of the several
   * ways to not have a measurement it hit. `null` for every other verdict.
   */
  note: string | null;
};

export type PerformanceBudgetEvaluation = {
  schemaVersion: typeof PERFORMANCE_BUDGET_SCHEMA_VERSION;
  pass: boolean;
  results: PerformanceBudgetResult[];
  enforcedCount: number;
  breachCount: number;
  unmeasuredCount: number;
  pendingCount: number;
  delegatedCount: number;
};

export type PerformanceBudgetMetric = { id: string; value: number };

export type PerformanceBudgetEvaluationOptions = {
  /**
   * The fixture profile the run actually measured, from the benchmark's own
   * `fixture.profile`. `null` means the run did not identify its workload.
   */
  fixtureProfile?: string | null;
};

/**
 * The fixture profile a `performance-report` budget was seeded against.
 *
 * The profile half of `<fixture file>#<profile>` is what makes the number mean
 * anything: "10k conversation list, cold scan p95 ≤ 3,000 ms" says nothing
 * whatsoever about a hundred-conversation run.
 */
export function budgetFixtureProfile(budget: PerformanceBudget): string | null {
  if (budget.gate !== "performance-report") return null;
  const profile = budget.source.split("#")[1];
  return profile && profile.trim() !== "" ? profile : null;
}

/** The distinct fixture profiles the enforced budgets were seeded against. */
export function enforcedFixtureProfiles(
  budgets: readonly PerformanceBudget[] = PERFORMANCE_BUDGETS,
): string[] {
  return [
    ...new Set(
      budgets
        .map((budget) => budgetFixtureProfile(budget))
        .filter((profile): profile is string => profile !== null),
    ),
  ];
}

function headroomOf(budget: PerformanceBudget, value: number, limit: number): {
  headroom: number;
  headroomPct: number;
  within: boolean;
} {
  const headroom = budget.direction === "lower-is-better" ? limit - value : value - limit;
  return {
    headroom,
    headroomPct: limit === 0 ? 0 : (headroom / Math.abs(limit)) * 100,
    within: headroom >= 0,
  };
}

/**
 * Judge measured metrics against the catalogue.
 *
 * Fails closed on an enforced budget whose metric is absent: a benchmark that
 * crashed emits no metric, and treating "no measurement" as "no breach" would
 * turn every such outage into a green run. That is the same asymmetry the
 * maintenance gate takes when a plane's entry is missing rather than false.
 * `pending` and `postbuild` entries never fail this evaluation — the first has
 * nothing to measure, and the second is enforced by the gate it names.
 *
 * A measurement taken at the wrong fixture scale is treated as no measurement,
 * for the same reason. Every enforced limit here is a number about a specific
 * workload, and grading a hundred-conversation smoke run against the 10k
 * ceilings produced a report reading "10k conversation list, cold metadata scan
 * p95 | 38.07 ms | ≤ 3000.00 ms | pass" — a green verdict on a budget nothing
 * in that run went near. `fixtureProfile` is therefore required to match, and
 * an unidentified fixture fails closed rather than defaulting to trusted.
 */
export function evaluatePerformanceBudgets(
  metrics: readonly PerformanceBudgetMetric[],
  budgets: readonly PerformanceBudget[] = PERFORMANCE_BUDGETS,
  { fixtureProfile = null }: PerformanceBudgetEvaluationOptions = {},
): PerformanceBudgetEvaluation {
  const measured = new Map(metrics.map((metric) => [metric.id, metric.value]));
  const unmeasured = (budget: PerformanceBudget, note: string): PerformanceBudgetResult => ({
    budget,
    value: null,
    headroom: null,
    headroomPct: null,
    verdict: "unmeasured",
    note,
  });
  const results = budgets.map((budget): PerformanceBudgetResult => {
    if (budget.gate === "pending") {
      return {
        budget,
        value: null,
        headroom: null,
        headroomPct: null,
        verdict: "pending",
        note: null,
      };
    }
    if (budget.gate === "postbuild") {
      return {
        budget,
        value: null,
        headroom: null,
        headroomPct: null,
        verdict: "delegated",
        note: null,
      };
    }
    if (budget.limit === null) {
      // A `performance-report` entry with no limit is a malformed catalogue
      // entry, not a pass — fail it the same way an absent measurement does.
      return unmeasured(budget, "the catalogue entry carries no limit to judge against");
    }
    const seededAgainst = budgetFixtureProfile(budget);
    if (seededAgainst !== null && fixtureProfile !== seededAgainst) {
      return unmeasured(
        budget,
        `seeded against the ${seededAgainst} fixture, but this run measured ` +
          `${fixtureProfile === null ? "an unidentified fixture" : `${fixtureProfile}`}`,
      );
    }
    const value = measured.get(budget.id);
    if (value === undefined || !Number.isFinite(value)) {
      return unmeasured(budget, "no run produced this metric");
    }
    const { headroom, headroomPct, within } = headroomOf(budget, value, budget.limit);
    return {
      budget,
      value,
      headroom,
      headroomPct,
      verdict: within ? "pass" : "breach",
      note: null,
    };
  });

  const countOf = (verdict: PerformanceBudgetVerdict) =>
    results.filter((result) => result.verdict === verdict).length;
  const breachCount = countOf("breach");
  const unmeasuredCount = countOf("unmeasured");

  return {
    schemaVersion: PERFORMANCE_BUDGET_SCHEMA_VERSION,
    pass: breachCount === 0 && unmeasuredCount === 0,
    results,
    enforcedCount: budgets.filter((budget) => budget.gate === "performance-report").length,
    breachCount,
    unmeasuredCount,
    pendingCount: countOf("pending"),
    delegatedCount: countOf("delegated"),
  };
}
