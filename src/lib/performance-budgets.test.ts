import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  budgetFixtureProfile,
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
    const match = /^(?<file>[\w./-]+\.mjs) \((?<symbol>[A-Za-z_][\w.]*)\)$/.exec(entry.source);
    assert.ok(match?.groups, `${entry.id}: source must read "<gate script> (<constant>)"`);
    const { file, symbol } = match.groups;
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

const SEEDED_MEASUREMENTS = [
  { id: "conversation-list.cold-scan.p95-ms", value: 1_039.39 },
  { id: "conversation-list.cold-scan.bytes", value: 43_608_890 },
  { id: "conversation-list.warm-cache.p95-ms", value: 82.16 },
  { id: "conversation-list.warm-cache.bytes", value: 0 },
  { id: "conversation-list.cache-hit-rate", value: 100 },
];

test("the shipped catalogue passes against its own seeded measurements", () => {
  // The seed values recorded in the module's comment, so a future edit that
  // tightens a limit past the measurement it was seeded from fails here.
  const evaluation = evaluatePerformanceBudgets(SEEDED_MEASUREMENTS, PERFORMANCE_BUDGETS, {
    fixtureProfile: "phase-6-list-10k",
  });
  assert.equal(evaluation.pass, true, "seeded measurements must satisfy the shipped budgets");
  assert.equal(evaluation.breachCount, 0);
  assert.equal(evaluation.unmeasuredCount, 0);
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
  // reported "10k conversation list, cold metadata scan p95 | 38.07 ms |
  // ≤ 3000.00 ms | pass" — a green verdict on a budget nothing in that run
  // approached. A limit is a claim about a workload, not about a machine.
  const smoke = evaluatePerformanceBudgets(
    [
      { id: "conversation-list.cold-scan.p95-ms", value: 38.07 },
      { id: "conversation-list.cold-scan.bytes", value: 26_246_890 },
      { id: "conversation-list.warm-cache.p95-ms", value: 1.51 },
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
    smoke.results.find((result) => result.budget.id === "conversation-list.cold-scan.p95-ms")!.note!,
    /seeded against the phase-6-list-10k fixture, but this run measured default/,
  );
});

test("a run that does not identify its fixture fails closed", () => {
  // Absent data is not "no objection". The report reads the profile off the
  // benchmark's own output, so a missing one means the workload is unknown.
  const evaluation = evaluatePerformanceBudgets(SEEDED_MEASUREMENTS);
  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.unmeasuredCount, evaluation.enforcedCount);
  assert.match(evaluation.results[0].note!, /an unidentified fixture/);
});
