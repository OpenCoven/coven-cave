import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  budgetFixtureProfile,
  budgetSourceDerivation,
  enforcedFixtureProfiles,
  evaluatePerformanceBudgets,
  PERFORMANCE_BUDGET_GATES,
  PERFORMANCE_BUDGET_SCHEMA_VERSION,
  PERFORMANCE_BUDGET_SURFACES,
  PERFORMANCE_BUDGETS,
  type PerformanceBudget,
} from "./performance-budgets.ts";

function budget(overrides: Partial<PerformanceBudget> = {}): PerformanceBudget {
  return {
    id: "test.metric",
    surface: "list",
    label: "Test metric",
    unit: "ms",
    direction: "lower-is-better",
    limit: 100,
    gate: "performance-report",
    source: "test",
    ...overrides,
  };
}

test("every surface named by the hardening plan carries at least one budget", () => {
  for (const surface of PERFORMANCE_BUDGET_SURFACES) {
    assert.ok(
      PERFORMANCE_BUDGETS.some((entry) => entry.surface === surface),
      `no budget covers the ${surface} surface`,
    );
  }
});

/**
 * The build gates whose numbers this catalogue delegates to.
 *
 * Written down so the check below cannot be satisfied by the catalogue
 * agreeing with itself. The list is cross-checked against the files the
 * `postbuild` entries actually name, so neither side can drift alone.
 *
 * ⚠️ Known limit, stated rather than papered over: a brand-new gate script that
 * nothing in the catalogue references yet is invisible to this test. Detecting
 * that would mean guessing which `scripts/*.mjs` constants are budgets, which
 * is a heuristic, not a gate. Adding a build-time budget means adding it here.
 */
const DELEGATED_BUILD_GATES = [
  "scripts/bundle-budget.mjs",
  "scripts/sidecar-runtime-closure.mjs",
  "scripts/standalone-budget.mjs",
];

/**
 * Budget constants a gate script defines, derived from the script itself.
 *
 * `bundle-budget.mjs` runs its whole check at import time and calls
 * process.exit, so its knobs are read out of the source by the exact
 * `Number(process.env.X)` shape all five budgets use — narrower than every
 * `process.env` read, so an unrelated env var is not mistaken for a ceiling.
 * The other two export frozen objects and are simply imported.
 */
async function gateBudgetSymbols(file: string): Promise<string[]> {
  const url = new URL(`../../${file}`, import.meta.url);
  if (file === "scripts/bundle-budget.mjs") {
    const contents = await readFile(url, "utf8");
    return [
      ...new Set(
        [...contents.matchAll(/Number\(process\.env\.([A-Z][A-Z0-9_]*)\)/g)].map(
          (match) => match[1],
        ),
      ),
    ];
  }
  const namespace = (await import(url.href)) as Record<string, unknown>;
  return Object.entries(namespace).flatMap(([name, value]) =>
    name.endsWith("_BUDGETS") && value && typeof value === "object"
      ? Object.keys(value as Record<string, unknown>).map((key) => `${name}.${key}`)
      : [],
  );
}

test("every budget constant the delegated build gates define has a catalogue entry", async () => {
  // "Every surface has at least one budget" was the whole completeness check,
  // and a surface passes that with one of its five ceilings recorded — which is
  // what shipped: 2 of the 9 build-gate numbers, with the bundle surface
  // reading as covered while four of its five budgets were absent. A directory
  // that is silently partial is the exact failure this module was written to
  // end, so assert the gates' own constants rather than a per-surface floor.
  const delegated = PERFORMANCE_BUDGETS.filter((entry) => entry.gate === "postbuild").map(
    (entry) => {
      const derivation = budgetSourceDerivation(entry.source);
      assert.ok(derivation, `${entry.id}: source must read "<gate script> (<constant>)"`);
      return derivation;
    },
  );
  assert.deepEqual(
    [...new Set(delegated.map((derivation) => derivation.file))].sort(),
    [...DELEGATED_BUILD_GATES].sort(),
    "the gates this test enumerates and the gates the catalogue delegates to must be the same set",
  );

  for (const file of DELEGATED_BUILD_GATES) {
    const recorded = new Set(
      delegated.filter((derivation) => derivation.file === file).map((d) => d.symbol),
    );
    for (const symbol of await gateBudgetSymbols(file)) {
      assert.ok(
        recorded.has(symbol),
        `${file} enforces ${symbol}, but no catalogue entry records it — the ` +
          `directory would report that surface as covered while it is not`,
      );
    }
  }
});

test("catalogue entries are well formed and uniquely identified", () => {
  const seen = new Set<string>();
  for (const entry of PERFORMANCE_BUDGETS) {
    assert.ok(!seen.has(entry.id), `duplicate budget id ${entry.id}`);
    seen.add(entry.id);
    assert.ok(PERFORMANCE_BUDGET_GATES.includes(entry.gate), `${entry.id} has an unknown gate`);
    assert.ok(entry.source.trim().length > 0, `${entry.id} must name what owns its number`);
    if (entry.gate === "postbuild") {
      // The gate owns the number. A copy here drifts silently and misreports
      // the very thing the catalogue exists to make legible.
      assert.equal(entry.limit, null, `${entry.id} must not restate its gate's limit`);
    } else {
      assert.ok(
        entry.limit !== null && Number.isFinite(entry.limit) && entry.limit > 0,
        `${entry.id} needs a positive limit`,
      );
    }
    if (entry.ratioOf) {
      // A ratio is only judgeable where the run supplies both operands, so the
      // kind belongs to the gate that evaluates metrics and nowhere else.
      assert.equal(entry.gate, "performance-report", `${entry.id}: only an enforced budget can divide`);
      assert.equal(entry.unit, "percent", `${entry.id}: a ratio is a percentage`);
      assert.notEqual(
        entry.ratioOf.numerator,
        entry.ratioOf.denominator,
        `${entry.id}: dividing a metric by itself grades nothing`,
      );
      for (const operand of [entry.ratioOf.numerator, entry.ratioOf.denominator]) {
        assert.notEqual(entry.id, operand, `${entry.id}: a ratio must not name itself as an operand`);
      }
    }
  }
});

test("a performance-report entry with no limit fails rather than silently passing", () => {
  const evaluation = evaluatePerformanceBudgets([{ id: "test.metric", value: 5 }], [
    budget({ limit: null }),
  ]);
  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.results[0].verdict, "unmeasured");
});

test("every budget enforced here names the fixture that produces it", async () => {
  const fixtures = JSON.parse(
    await readFile(new URL("../../fixtures/phase-6/performance-fixtures.json", import.meta.url), "utf8"),
  );
  for (const entry of PERFORMANCE_BUDGETS) {
    if (entry.gate !== "performance-report") continue;
    const [file, profile] = entry.source.split("#");
    assert.equal(file, "fixtures/phase-6/performance-fixtures.json", `${entry.id} names an unknown fixture file`);
    assert.ok(fixtures.profiles[profile], `${entry.id} names missing profile ${profile}`);
  }
});

test("every fixture profile describes a workload rather than merely existing", async () => {
  // "The profile exists" was the whole check, and existing is not the same as
  // describing a workload: a profile missing `transcriptBytes` writes
  // `"x".repeat(undefined)` — 10,000 empty transcripts — and the benchmark
  // exited 0 with every budget green, because the numbers a workload that small
  // produces are inside ceilings seeded for a real one. The benchmark now
  // refuses such a profile at load; this catches it a whole nightly earlier.
  const fixtures = JSON.parse(
    await readFile(new URL("../../fixtures/phase-6/performance-fixtures.json", import.meta.url), "utf8"),
  ) as { profiles: Record<string, Record<string, unknown>> };
  const profiles = Object.entries(fixtures.profiles ?? {});
  assert.ok(profiles.length > 0, "the fixture file defines no profiles");
  for (const [name, profile] of profiles) {
    for (const key of ["fileCount", "transcriptBytes", "iterations"]) {
      const value = profile[key];
      assert.ok(
        typeof value === "number" && Number.isFinite(value) && value > 0,
        `profile ${name} needs a positive ${key}, has ${JSON.stringify(value)}`,
      );
    }
  }
});

test("every delegated budget names a constant its gate really owns", async () => {
  // A `postbuild` entry carries no limit, so its `source` is the ONLY thing
  // tying it to the gate that owns the number — and a source naming a symbol
  // that does not exist turns the entry into a dangling pointer that no test
  // and no report can tell apart from a live delegation. Matching the string
  // textually is not enough: `STANDALONE_BUDGETS.bytes` (the shipped value
  // until this test existed; the real key is `unpackedBytes`) still appears
  // word-for-word in that file's own comments and log strings.
  for (const entry of PERFORMANCE_BUDGETS) {
    if (entry.gate !== "postbuild") continue;
    const derivation = budgetSourceDerivation(entry.source);
    assert.ok(derivation, `${entry.id}: source must read "<gate script> (<constant>)"`);
    const { file, symbol } = derivation;
    assert.ok(file.endsWith(".mjs"), `${entry.id}: a build gate is an .mjs script, not ${file}`);
    const url = new URL(`../../${file}`, import.meta.url);
    const contents = await readFile(url, "utf8");

    if (symbol.includes(".")) {
      // An exported object: resolve the whole path, so a renamed key cannot
      // keep passing just because the object it used to live on still exists.
      const [root, ...keys] = symbol.split(".");
      const namespace = (await import(url.href)) as Record<string, unknown>;
      let value = namespace[root];
      assert.notEqual(value, undefined, `${entry.id}: ${file} does not export ${root}`);
      for (const key of keys) {
        value = (value as Record<string, unknown> | undefined)?.[key];
      }
      assert.notEqual(value, undefined, `${entry.id}: ${file} defines no ${symbol}`);
    } else {
      // An env knob the gate reads for its ceiling. `bundle-budget.mjs` runs its
      // whole check at import time and calls process.exit, so this one is
      // matched on the exact read rather than imported.
      assert.ok(
        contents.includes(`process.env.${symbol}`),
        `${entry.id}: ${file} never reads process.env.${symbol}`,
      );
    }
  }
});

test("a pending budget derived from repository code is pinned to that constant", async () => {
  // The last source that was asserted against nothing. `cli.doctor.p95-ms` read
  // "cave-o8gc4: matches EXEC_TIMEOUT_MS in src/app/api/coven/exec/route.ts" —
  // a claim about a specific constant, in prose, with no gate to notice when
  // that constant moved. It is the same drift class as the 900 KB entry against
  // a 2800 KB gate, one gate short of being caught, and it survived three
  // review rounds precisely because prose reads exactly like a live delegation.
  //
  // So: prose is allowed only for a number nothing in this repository owns. The
  // moment a source names a repository file it must use the resolvable form,
  // and the limit must equal what that file actually declares.
  const repositoryFile = /[\w./-]+\.(?:mjs|cjs|js|ts|tsx)\b/;
  let checked = 0;
  for (const entry of PERFORMANCE_BUDGETS) {
    if (entry.gate !== "pending") continue;
    const derivation = budgetSourceDerivation(entry.source);
    if (!derivation) {
      assert.ok(
        !repositoryFile.test(entry.source),
        `${entry.id}: source names a repository file in prose (${entry.source}); ` +
          `write it as "<file> (<CONSTANT>)" so this test can resolve it`,
      );
      continue;
    }
    const contents = await readFile(new URL(`../../${derivation.file}`, import.meta.url), "utf8");
    // Positional groups, not named ones: this project's tsc target predates
    // ES2018 and rejects `(?<name>…)`.
    const declaration = new RegExp(
      `(?:const|let|var)\\s+${derivation.symbol}\\s*(?::[^=]+)?=\\s*([0-9][0-9_]*)\\s*;`,
    ).exec(contents);
    assert.ok(
      declaration,
      `${entry.id}: ${derivation.file} declares no numeric ${derivation.symbol}`,
    );
    assert.equal(
      entry.limit,
      Number(declaration[1].replaceAll("_", "")),
      `${entry.id} is ${entry.limit}, but ${derivation.file} declares ` +
        `${derivation.symbol} = ${declaration[1]} — move both or neither`,
    );
    checked += 1;
  }
  assert.ok(checked > 0, "no pending budget resolves a constant; the check above proves nothing");
});

test("a measurement inside the limit passes with positive headroom", () => {
  const evaluation = evaluatePerformanceBudgets([{ id: "test.metric", value: 40 }], [budget()]);
  assert.equal(evaluation.schemaVersion, PERFORMANCE_BUDGET_SCHEMA_VERSION);
  assert.equal(evaluation.pass, true);
  assert.equal(evaluation.results[0].verdict, "pass");
  assert.equal(evaluation.results[0].headroom, 60);
  assert.equal(evaluation.results[0].headroomPct, 60);
});

test("a measurement over the ceiling breaches with negative headroom", () => {
  const evaluation = evaluatePerformanceBudgets([{ id: "test.metric", value: 150 }], [budget()]);
  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.breachCount, 1);
  assert.equal(evaluation.results[0].verdict, "breach");
  assert.equal(evaluation.results[0].headroom, -50);
});

test("higher-is-better budgets treat the limit as a floor", () => {
  const floor = budget({ direction: "higher-is-better", limit: 95, unit: "percent" });
  assert.equal(
    evaluatePerformanceBudgets([{ id: "test.metric", value: 99 }], [floor]).results[0].verdict,
    "pass",
  );
  assert.equal(
    evaluatePerformanceBudgets([{ id: "test.metric", value: 90 }], [floor]).results[0].verdict,
    "breach",
  );
});

test("exactly at the limit passes — the budget is a ceiling, not an exclusive bound", () => {
  const evaluation = evaluatePerformanceBudgets([{ id: "test.metric", value: 100 }], [budget()]);
  assert.equal(evaluation.results[0].verdict, "pass");
  assert.equal(evaluation.results[0].headroom, 0);
});

test("an enforced budget with no measurement fails closed", () => {
  const evaluation = evaluatePerformanceBudgets([], [budget()]);
  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.unmeasuredCount, 1);
  assert.equal(evaluation.results[0].verdict, "unmeasured");
});

test("a non-finite measurement counts as unmeasured rather than passing", () => {
  // A crashed benchmark can still emit a field; NaN must not read as "within".
  const evaluation = evaluatePerformanceBudgets([{ id: "test.metric", value: Number.NaN }], [budget()]);
  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.results[0].verdict, "unmeasured");
});

test("pending and postbuild budgets are reported without failing the run", () => {
  const evaluation = evaluatePerformanceBudgets([], [
    budget({ id: "pending.metric", gate: "pending" }),
    budget({ id: "delegated.metric", gate: "postbuild" }),
  ]);
  assert.equal(evaluation.pass, true);
  assert.equal(evaluation.pendingCount, 1);
  assert.equal(evaluation.delegatedCount, 1);
  assert.equal(evaluation.enforcedCount, 0);
});

/**
 * The workload the enforced limits were approved against.
 *
 * A budget's `source` ties it to a profile by NAME, and the name survives any
 * edit to what that profile contains. Shrinking `phase-6-list-10k` to 200
 * conversations and running the report reproduced the exact line this catalogue
 * exists to prevent — `10k conversation list, cold metadata scan median | 30.07
 * ms | ≤ 5000.00 ms | pass`, with `budgetPass: true`, `status: "pass"` and exit 0
 * — because the benchmark still reported `profile: "phase-6-list-10k"`.
 *
 * Neither existing guard can see that. The profile check compares names, and
 * the swept-dimension stamp only watches `CAVE_BENCH_*` overrides; a committed
 * fixture edit trips neither. The scale is therefore as much a part of the
 * approved budget as the limit is, and is pinned here so shrinking the fixture
 * costs a deliberate edit instead of a silently green nightly.
 *
 * `iterations` is pinned for a second reason: the enforced timing budgets grade
 * the MEDIAN, and a median is only robust because there are five samples under
 * it. Editing the profile to `iterations: 1` leaves the median equal to the one
 * sample taken — the noise-sensitive "slowest of the run" number the budgets
 * were moved off — and every other guard here is blind to it, because the
 * profile name is unchanged and no `CAVE_BENCH_*` override exists to stamp.
 */
const SEEDED_WORKLOAD = { fileCount: 10_000, transcriptBytes: 4_096, iterations: 5 };

test("the seeded fixture still describes the workload the limits were approved for", async () => {
  const fixtures = JSON.parse(
    await readFile(new URL("../../fixtures/phase-6/performance-fixtures.json", import.meta.url), "utf8"),
  ) as { profiles: Record<string, Record<string, unknown>> };
  const profileNames = enforcedFixtureProfiles();
  assert.equal(profileNames.length, 1, "the enforced budgets must agree on one profile");
  const [profileName] = profileNames;
  const profile = fixtures.profiles?.[profileName];
  assert.ok(profile, `the fixture file defines no ${profileName} profile`);
  for (const [key, expected] of Object.entries(SEEDED_WORKLOAD)) {
    assert.equal(
      profile[key],
      expected,
      `${profileName}.${key} is ${JSON.stringify(profile[key])}, but every enforced limit was ` +
        `seeded against ${expected} — reseed the limits in the same commit or restore the fixture`,
    );
  }
});

/**
 * The SLOWEST `phase-6-list-10k` readings measured, not the fastest.
 *
 * Seeding from the quiet single run (cold median 1,364 ms) is what made the
 * original 3,000 ms ceiling look like 3x headroom; running three copies of the
 * benchmark at once on the same machine put the cold median at 2,603 ms, which
 * left 15% — a nightly one busy runner away from red. A ceiling is only honest
 * against the worst legitimate run we have actually observed, so that is what
 * the shipped limits are asserted to clear.
 *
 * ⚠️ This is a worst-case ENVELOPE, not one run's output. The absolute readings
 * come from the three-concurrent set that produced the 2,603 ms cold median;
 * the control median comes from a later three-concurrent set (4,718.10 ms
 * against a 1,809.08 ms cold median, a 38.34% ratio). Pairing the slowest cold
 * median with the fastest recorded control median implies a 55.2% ratio —
 * worse than either run actually measured, which is the safe direction to be
 * wrong in for a ceiling test. Do not read 55.2% as an observation.
 */
const SLOWEST_MEASURED_RUN = [
  { id: "conversation-list.cold-scan.p50-ms", value: 2_603.31 },
  { id: "conversation-list.full-parse.p50-ms", value: 4_718.10 },
  { id: "conversation-list.cold-scan.bytes", value: 43_608_890 },
  { id: "conversation-list.warm-cache.p50-ms", value: 156.28 },
  { id: "conversation-list.warm-cache.bytes", value: 0 },
  { id: "conversation-list.cache-hit-rate", value: 100 },
];

test("the shipped catalogue passes against the slowest run it was seeded from", () => {
  // Recorded in the module's own table, so a future edit that tightens a limit
  // past a measurement it was seeded from fails here rather than in a nightly.
  const evaluation = evaluatePerformanceBudgets(SLOWEST_MEASURED_RUN, PERFORMANCE_BUDGETS, {
    fixtureProfile: "phase-6-list-10k",
  });
  assert.equal(evaluation.pass, true, "seeded measurements must satisfy the shipped budgets");
  assert.equal(evaluation.breachCount, 0);
  assert.equal(evaluation.unmeasuredCount, 0);
});

test("no enforced timing budget grades a statistic this sample count cannot support", () => {
  // `percentile(values, 0.95)` returns the maximum for every n ≤ 20, so at the
  // fixture's 5 iterations a "p95" ceiling is "slowest of five" — decidable by
  // one descheduled iteration. Measured: 16,058 ms p95 against 1,840 ms p50 in
  // the same run, a 5x breach of the old 3,000 ms ceiling from scheduling noise
  // with the workload unchanged. Enforce medians until the sample count is big
  // enough for a real percentile; the p95 is still measured and still reported.
  const percentile = (values: number[], percent: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percent))];
  };
  const sample = Array.from({ length: SEEDED_WORKLOAD.iterations }, (_, index) => index + 1);
  assert.equal(
    percentile(sample, 0.95),
    Math.max(...sample),
    "if p95 has stopped being the maximum, a p95 budget is defensible again",
  );
  for (const entry of PERFORMANCE_BUDGETS) {
    if (entry.gate !== "performance-report") continue;
    // A ratio budget grades no percentile of its own, but it inherits the
    // statistic of whatever it divides — "cold p95 / control p95" would be a
    // quotient of two maxima and just as decidable by one stalled iteration.
    for (const operand of entry.ratioOf ? [entry.ratioOf.numerator, entry.ratioOf.denominator] : []) {
      assert.ok(
        operand.endsWith(".p50-ms"),
        `${entry.id} divides ${operand}, which is not a median; a ratio of two ` +
          `maxima is as noise-decidable as the p95 ceilings this rule replaced`,
      );
    }
    if (entry.unit !== "ms") continue;
    assert.ok(
      entry.id.endsWith(".p50-ms"),
      `${entry.id} enforces a percentile the ${SEEDED_WORKLOAD.iterations}-iteration ` +
        `fixture cannot resolve; budget the median or raise the sample count past 100`,
    );
    assert.match(entry.label, /median/, `${entry.label} must name the statistic it enforces`);
  }
});

test("every enforced budget is seeded against exactly one shared fixture profile", () => {
  // The report defaults its benchmark to this profile, which it can only do
  // while the enforced budgets agree on one. A second profile is not wrong,
  // but it needs the report taught to run both before it lands.
  assert.deepEqual(enforcedFixtureProfiles(), ["phase-6-list-10k"]);
  for (const entry of PERFORMANCE_BUDGETS) {
    if (entry.gate === "performance-report") {
      assert.equal(budgetFixtureProfile(entry), "phase-6-list-10k", `${entry.id}`);
    } else {
      assert.equal(budgetFixtureProfile(entry), null, `${entry.id}`);
    }
  }
});

test("measurements from the wrong fixture scale count as unmeasured, not as a pass", () => {
  // The exact numbers a `default`-profile smoke run produced, which previously
  // reported "10k conversation list, cold metadata scan median | 38.07 ms |
  // ≤ 5000.00 ms | pass" — a green verdict on a budget nothing in that run
  // approached. A limit is a claim about a workload, not about a machine.
  const smoke = evaluatePerformanceBudgets(
    [
      { id: "conversation-list.cold-scan.p50-ms", value: 38.07 },
      { id: "conversation-list.cold-scan.bytes", value: 26_246_890 },
      { id: "conversation-list.warm-cache.p50-ms", value: 1.51 },
      { id: "conversation-list.warm-cache.bytes", value: 0 },
      { id: "conversation-list.cache-hit-rate", value: 100 },
    ],
    PERFORMANCE_BUDGETS,
    { fixtureProfile: "default" },
  );
  assert.equal(smoke.pass, false);
  assert.equal(smoke.breachCount, 0);
  assert.equal(smoke.unmeasuredCount, smoke.enforcedCount);
  assert.match(
    smoke.results.find((result) => result.budget.id === "conversation-list.cold-scan.p50-ms")!.note!,
    /seeded against the phase-6-list-10k fixture, but this run measured default/,
  );
});

const RATIO_BUDGET_ID = "conversation-list.cold-scan.share-of-full-parse-pct";

function ratioBudget(overrides: Partial<PerformanceBudget> = {}): PerformanceBudget {
  return budget({
    id: "test.ratio",
    unit: "percent",
    limit: 75,
    ratioOf: { numerator: "test.numerator", denominator: "test.denominator" },
    ...overrides,
  });
}

test("a ratio budget grades one metric as a percentage of another", () => {
  const evaluation = evaluatePerformanceBudgets(
    [
      { id: "test.numerator", value: 994.7 },
      { id: "test.denominator", value: 4_096.1 },
    ],
    [ratioBudget()],
  );
  assert.equal(evaluation.results[0].verdict, "pass");
  assert.equal(evaluation.results[0].value?.toFixed(2), "24.28");
  assert.equal(evaluation.enforcedCount, 1);
});

test("a ratio budget ignores a raw metric that happens to share its id", () => {
  // The whole point of the derived id is that nothing the report emits can
  // satisfy it directly. If the evaluator fell back to an id lookup, a stray
  // metric would decide a budget whose operands were never measured.
  const evaluation = evaluatePerformanceBudgets([{ id: "test.ratio", value: 1 }], [ratioBudget()]);
  assert.equal(evaluation.results[0].verdict, "unmeasured");
  assert.match(evaluation.results[0].note!, /no run produced test\.numerator/);
});

test("a ratio budget over its ceiling breaches", () => {
  // The measured read-pool collapse: CONVERSATION_LIST_READ_CONCURRENCY 8 -> 1
  // put the cold median at 4,397.85 ms against a 3,926.19 ms control.
  const evaluation = evaluatePerformanceBudgets(
    [
      { id: "test.numerator", value: 4_397.85 },
      { id: "test.denominator", value: 3_926.19 },
    ],
    [ratioBudget()],
  );
  assert.equal(evaluation.results[0].verdict, "breach");
  assert.equal(evaluation.pass, false);
});

test("a ratio budget missing either operand fails closed", () => {
  for (const [present, missing] of [
    [{ id: "test.denominator", value: 10 }, "test.numerator"],
    [{ id: "test.numerator", value: 10 }, "test.denominator"],
  ] as const) {
    const evaluation = evaluatePerformanceBudgets([present], [ratioBudget()]);
    assert.equal(evaluation.pass, false, `${missing} absent must not pass`);
    assert.equal(evaluation.results[0].verdict, "unmeasured");
    assert.match(evaluation.results[0].note!, new RegExp(missing.replace(".", "\\.")));
  }
});

test("a ratio budget with an unjudgeable denominator fails closed rather than reading Infinity", () => {
  // `x / 0` is `Infinity`, which a lower-is-better comparison would call a
  // breach and a higher-is-better one would call a pass — both by accident. A
  // control loop that measured 0 ms did not prove anything; it broke.
  for (const denominator of [0, -1, Number.NaN]) {
    const evaluation = evaluatePerformanceBudgets(
      [
        { id: "test.numerator", value: 10 },
        { id: "test.denominator", value: denominator },
      ],
      [ratioBudget()],
    );
    assert.equal(evaluation.pass, false, `denominator ${denominator} must not be judged`);
    assert.equal(evaluation.results[0].verdict, "unmeasured");
  }
});

/**
 * Every cold-scan/control pair measured while seeding the relative budget, as
 * `[cold p50, control p50]`.
 *
 * The ratio is PLATFORM-sensitive — the read pool only pays off where per-file
 * I/O overhead dominates, and it dominates far less on Linux — so seeding it on
 * the review machine alone would have put the ceiling at 75% with the nightly's
 * own platform reading 63%. Both families are recorded, and the ceiling has to
 * clear all of the healthy ones while still failing all of the collapsed ones.
 * That pins the budget from BOTH sides: tightening past a healthy reading or
 * loosening past a collapse both fail here rather than in a nightly.
 */
const MEASURED_HEALTHY_RATIOS: Record<string, [number, number]> = {
  "windows, idle": [994.7, 4_096.1],
  "windows, three benchmarks at once": [1_809.08, 4_718.1],
  "linux (wsl2), idle": [1_759.8, 2_787.94],
  "linux (wsl2), three benchmarks at once": [1_639.41, 3_117.21],
};

/** The same fixture with `CONVERSATION_LIST_READ_CONCURRENCY` set to 1. */
const MEASURED_COLLAPSED_RATIOS: Record<string, [number, number]> = {
  "windows, read pool 1": [4_397.85, 3_926.19],
  "linux (wsl2), read pool 1": [3_460.77, 2_718.62],
};

function ratioVerdict([cold, control]: [number, number]) {
  return evaluatePerformanceBudgets(
    [
      { id: "conversation-list.cold-scan.p50-ms", value: cold },
      { id: "conversation-list.full-parse.p50-ms", value: control },
    ],
    PERFORMANCE_BUDGETS.filter((entry) => entry.id === RATIO_BUDGET_ID),
    { fixtureProfile: "phase-6-list-10k" },
  ).results[0];
}

test("the shipped ratio ceiling clears every healthy run measured, on both platforms", () => {
  for (const [label, pair] of Object.entries(MEASURED_HEALTHY_RATIOS)) {
    const result = ratioVerdict(pair);
    assert.equal(
      result.verdict,
      "pass",
      `${label} measured ${result.value?.toFixed(2)}%, over the shipped ceiling — ` +
        `a healthy run must not be red`,
    );
  }
});

test("the shipped ratio ceiling still fails every collapsed run measured", () => {
  for (const [label, pair] of Object.entries(MEASURED_COLLAPSED_RATIOS)) {
    const result = ratioVerdict(pair);
    assert.equal(
      result.verdict,
      "breach",
      `${label} measured ${result.value?.toFixed(2)}% and passed — the ceiling has ` +
        `been loosened past the regression it exists to catch`,
    );
  }
});

test("the shipped ratio budget catches the collapse the absolute ceiling passes", () => {
  // Measured by executing it, not argued: setting
  // CONVERSATION_LIST_READ_CONCURRENCY to 1 in src/lib/cave-conversations.ts and
  // running phase-6-list-10k produced a cold median of 4,397.85 ms against a
  // 3,926.19 ms control median, with both loops reading the identical
  // 43,608,890 bytes. The 5,000 ms ceiling, the bytes ceiling and the warm-loop
  // hit rate all pass that run. The ratio is 112%.
  const collapsed = evaluatePerformanceBudgets(
    [
      { id: "conversation-list.cold-scan.p50-ms", value: 4_397.85 },
      { id: "conversation-list.full-parse.p50-ms", value: 3_926.19 },
      { id: "conversation-list.cold-scan.bytes", value: 43_608_890 },
      { id: "conversation-list.warm-cache.p50-ms", value: 156.28 },
      { id: "conversation-list.warm-cache.bytes", value: 0 },
      { id: "conversation-list.cache-hit-rate", value: 100 },
    ],
    PERFORMANCE_BUDGETS,
    { fixtureProfile: "phase-6-list-10k" },
  );
  const breached = collapsed.results.filter((result) => result.verdict === "breach");
  assert.deepEqual(
    breached.map((result) => result.budget.id),
    [RATIO_BUDGET_ID],
    "only the relative budget separates a collapsed read pool from a healthy scan",
  );
  assert.equal(
    collapsed.results.find((result) => result.budget.id === "conversation-list.cold-scan.p50-ms")!
      .verdict,
    "pass",
    "the absolute ceiling passing this run is the defect the ratio budget exists for",
  );
});

test("a run that does not identify its fixture fails closed", () => {
  // Absent data is not "no objection". The report reads the profile off the
  // benchmark's own output, so a missing one means the workload is unknown.
  const evaluation = evaluatePerformanceBudgets(SLOWEST_MEASURED_RUN);
  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.unmeasuredCount, evaluation.enforcedCount);
  assert.match(evaluation.results[0].note!, /an unidentified fixture/);
});
