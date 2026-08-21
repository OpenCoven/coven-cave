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
   * Every form is machine-checked, because a `source` nobody verifies is a
   * dangling pointer that reads exactly like a live delegation:
   * - `performance-report` — `<fixture file>#<profile>`, and the profile must
   *   exist in that file.
   * - `postbuild` — `<gate script> (<constant>)`, and the constant must really
   *   be defined by that script.
   * - `pending` — prose naming the issue that owns the gap, UNLESS the number
   *   is derived from something in this repository, in which case it takes the
   *   same `<file> (<constant>)` form and the limit must equal that constant.
   *   See `budgetSourceDerivation`.
   */
  source: string;
};

/**
 * The `<file> (<SYMBOL>)` derivation a `source` names, or `null` for prose.
 *
 * `postbuild` sources have been resolved this way since the catalogue recorded
 * 900 KB for a gate whose own default was 2800 KB. A `pending` source was the
 * one that stayed prose: `cli.doctor.p95-ms` read "matches EXEC_TIMEOUT_MS in
 * src/app/api/coven/exec/route.ts" — a claim about a specific constant, with
 * nothing to notice when that constant moved. Prose is fine for a number no
 * code owns yet (a shell-boot deadline nothing measures), but the moment an
 * entry names a file in this repository it has to say so in a form a test can
 * resolve, and `performance-budgets.test.ts` refuses any source that names a
 * repository file without using this one.
 */
export function budgetSourceDerivation(
  source: string,
): { file: string; symbol: string } | null {
  // Positional groups, not named ones: this project's tsc target predates
  // ES2018 and rejects `(?<name>…)`.
  const match = /^([\w./-]+\.(?:mjs|cjs|js|ts|tsx)) \(([A-Za-z_][\w.]*)\)$/.exec(source);
  return match ? { file: match[1], symbol: match[2] } : null;
}

const LIST_FIXTURE = "fixtures/phase-6/performance-fixtures.json#phase-6-list-10k";

/**
 * These are ceilings that catch a collapse, not targets to optimise toward —
 * the report's own 20% regression comparison is what catches slow erosion. Only
 * Cave's own code is budgeted: the benchmark's raw readdir+parse control loop
 * is deliberately absent, since policing it would measure the harness.
 *
 * ## The timing budgets grade the median, not the p95
 *
 * `phase-6-list-10k` runs 5 iterations, and the 95th percentile of 5 samples is
 * the largest of them — verified, not assumed: the benchmark's `percentile()`
 * returns the maximum for every n ≤ 20. So "cold scan p95 ≤ 3,000 ms" was
 * really "slowest of five ≤ 3,000 ms", and one descheduled iteration is enough
 * to decide it. A run on a busy box produced a cold p95 of 16,058 ms against a
 * p50 of 1,840 ms *in the same run* — a 5x breach of that ceiling from
 * scheduling noise alone, with the workload unchanged. A shared `ubuntu-24.04`
 * runner is a busy box, and a nightly gate that goes red on noise is an outage
 * rather than a budget (the `WORKTREE_WARNING_BUDGET` lesson, `cave-qpwx0`).
 *
 * Raising the sample count is not the escape: a true p95 needs n ≥ 21 merely to
 * stop being the maximum and ~100 to have any resolution, and one iteration of
 * this fixture costs 8-10 s, so 100 would be ~17 minutes inside a 30-minute job
 * that also seeds 10,000 files and runs the reliability benchmark. The median
 * of 5 is the statistic this sample count actually supports, and it absorbs two
 * stalled iterations. The p95 is still measured and still reported — it just
 * does not decide whether the nightly is red.
 *
 * ## What the ceilings are seeded from
 *
 * Reference machine, `phase-6-list-10k`, 43.6 MB scanned every time:
 *
 * | run                        | cold p50 | cold p95 | warm p50 | warm p95 |
 * | -------------------------- | -------- | -------- | -------- | -------- |
 * | first seeding, 2026-08-21  |        — |  1039 ms |        — |    82 ms |
 * | idle                       |  1364 ms |  1398 ms |   156 ms |   157 ms |
 * | 3 benchmarks concurrently  |  2603 ms |  2686 ms |   156 ms |   159 ms |
 *
 * The p95/p50 ratio is 1.02-1.04 whenever nothing stalls, which is why the
 * original 3,000 ms ceiling read as generous — against an idle single run it
 * was. Against three concurrent runs the *median* already reaches 2,603 ms, so
 * 3,000 ms left 15% headroom on a machine merely doing three things at once.
 *
 * The cold ceiling is therefore 5,000 ms: 1.9x the slowest median measured. The
 * warm ceiling stays 750 ms — the warm median moved 156 → 156 ms under the same
 * contention, and a warm scan that stopped hitting cache would cost the cold
 * number and breach immediately.
 *
 * ⚠️ **5,000 ms does not by itself catch a total regression to full-transcript
 * parsing, and an earlier draft of this comment claimed it did.** The claim was
 * that 5,000 ms sits under the 6,411-6,900 ms the benchmark's own control loop
 * cost on the seeding runs, so undoing the optimisation would still trip it.
 * That anchor is not machine-independent: the control loop costs whatever the
 * machine costs. A quieter run of the same reference machine measured a
 * full-parse median of 3,891.97 ms against a cold median of 922.92 ms, so a
 * cold scan back at full-parse speed would read ~3,892 ms and PASS.
 *
 * Nothing else here closes that gap. `cold-scan.bytes` reads the identical
 * 43,608,890 bytes in both loops (the optimisation removed parsing, not
 * reading); `cache-hit-rate` is taken from the warm loop, so a cold regression
 * does not move it; and the 20% baseline comparison does flag it, but the
 * nightly runs without `--fail-on-regression`, so the run still exits 0.
 *
 * Tightening the ceiling is not the repair — a limit under 3,892 ms leaves
 * ~25-34% headroom over the 2,603 ms contended median and reinstates the
 * noise-driven red nightly that moving off p95 was for. The durable fix is a
 * budget relative to the control loop measured in the same run; that needs a
 * second budget kind and is tracked as `cave-4e1`.
 */
export const PERFORMANCE_BUDGETS: readonly PerformanceBudget[] = [
  {
    id: "conversation-list.cold-scan.p50-ms",
    surface: "list",
    label: "10k conversation list, cold metadata scan median",
    unit: "ms",
    direction: "lower-is-better",
    limit: 5_000,
    gate: "performance-report",
    source: LIST_FIXTURE,
  },
  {
    id: "conversation-list.warm-cache.p50-ms",
    surface: "route",
    label: "Cave conversation read route, warm cache median",
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
    // Not an independently approved number: it is the exec route's own timeout,
    // so a `coven doctor` slower than this is already a failed request rather
    // than a slow one. Recorded in resolvable form so the two cannot drift.
    source: "src/app/api/coven/exec/route.ts (EXEC_TIMEOUT_MS)",
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
 * anything: "10k conversation list, cold metadata scan median ≤ 5,000 ms" says
 * nothing whatsoever about a hundred-conversation run.
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
