import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
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
    assert.ok(Number.isFinite(entry.limit) && entry.limit > 0, `${entry.id} needs a positive limit`);
    assert.ok(entry.source.trim().length > 0, `${entry.id} must name what owns its number`);
  }
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

test("the shipped catalogue passes against its own seeded measurements", () => {
  // The seed values recorded in the module's comment, so a future edit that
  // tightens a limit past the measurement it was seeded from fails here.
  const evaluation = evaluatePerformanceBudgets([
    { id: "conversation-list.cold-scan.p95-ms", value: 1_039.39 },
    { id: "conversation-list.cold-scan.bytes", value: 43_608_890 },
    { id: "conversation-list.warm-cache.p95-ms", value: 82.16 },
    { id: "conversation-list.warm-cache.bytes", value: 0 },
    { id: "conversation-list.cache-hit-rate", value: 100 },
  ]);
  assert.equal(evaluation.pass, true, "seeded measurements must satisfy the shipped budgets");
  assert.equal(evaluation.breachCount, 0);
  assert.equal(evaluation.unmeasuredCount, 0);
});
