// @ts-nocheck
import assert from "node:assert/strict";
import { suitePassRateTrend, diffRuns, failureClusters } from "./eval-analytics.ts";

const caseRes = (caseId, name, pass, graders = []) => ({
  caseId, name, input: "", output: "", latencyMs: 1, graders, pass, score: pass ? 1 : 0,
});
const run = (id, startedAt, results) => ({
  id, suiteId: "s1", suiteName: "S", familiarId: "f", startedAt, results,
  summary: {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    passRate: results.length ? results.filter((r) => r.pass).length / results.length : 0,
    avgScore: 0, avgLatencyMs: 1,
  },
});

// ── suitePassRateTrend: chronological (x asc), y = passRate, empties dropped ───
const trend = suitePassRateTrend([
  run("r2", "2026-06-02T00:00:00Z", [caseRes("c1", "C1", true), caseRes("c2", "C2", false)]),
  run("r1", "2026-06-01T00:00:00Z", [caseRes("c1", "C1", true), caseRes("c2", "C2", true)]),
  run("r0", "2026-06-03T00:00:00Z", []), // empty run dropped
]);
assert.equal(trend.length, 2, "empty run dropped");
assert.ok(trend[0].x < trend[1].x, "sorted oldest-first");
assert.equal(trend[0].y, 1, "first run 2/2 passed");
assert.equal(trend[1].y, 0.5, "second run 1/2 passed");

// ── diffRuns: regression / fix / added / removed / pass / fail ─────────────────
const before = run("a", "2026-06-01T00:00:00Z", [
  caseRes("keep-pass", "Keep pass", true),
  caseRes("regress", "Regress", true),
  caseRes("fix", "Fix", false),
  caseRes("gone", "Gone", true),
]);
const after = run("b", "2026-06-02T00:00:00Z", [
  caseRes("keep-pass", "Keep pass", true),
  caseRes("regress", "Regress", false),
  caseRes("fix", "Fix", true),
  caseRes("new", "New", false),
]);
const diff = diffRuns(before, after);
const byId = Object.fromEntries(diff.map((d) => [d.caseId, d.status]));
assert.equal(byId["regress"], "regressed");
assert.equal(byId["fix"], "fixed");
assert.equal(byId["gone"], "removed");
assert.equal(byId["new"], "added");
assert.equal(byId["keep-pass"], "pass");
assert.equal(diff[0].status, "regressed", "regressions sort first");

// ── failureClusters: per-case failures + flakiness + per-grader fails ─────────
const g = (kind, pass) => ({ kind, label: kind, pass, score: pass ? 1 : 0, detail: "" });
const clusters = failureClusters([
  run("r1", "2026-06-01T00:00:00Z", [caseRes("flaky", "Flaky", true, [g("contains", true)]), caseRes("bad", "Bad", false, [g("regex", false)])]),
  run("r2", "2026-06-02T00:00:00Z", [caseRes("flaky", "Flaky", false, [g("contains", false)]), caseRes("bad", "Bad", false, [g("regex", false)])]),
  run("r3", "2026-06-03T00:00:00Z", [caseRes("flaky", "Flaky", true, [g("contains", true)]), caseRes("bad", "Bad", false, [g("regex", false)])]),
]);
const bad = clusters.byCase.find((c) => c.caseId === "bad");
const flaky = clusters.byCase.find((c) => c.caseId === "flaky");
assert.equal(bad.failures, 3, "bad failed all 3 runs");
assert.equal(flaky.flaky, true, "flaky alternated pass/fail (>=2 transitions)");
assert.equal(bad.flaky, false, "consistently failing is not flaky");
assert.equal(clusters.byCase[0].caseId, "bad", "most failures first");
assert.equal(clusters.byGrader[0].kind, "regex", "regex grader failed most");

console.log("eval-analytics.test.ts passed");
