// Unit tests for the pure eval domain model. Run as a plain node script
// (matches the repo's node:assert/strict convention).
import assert from "node:assert/strict";
import {
  gradeDeterministic,
  graderNeedsModel,
  applyJudgeVerdict,
  buildCaseResult,
  summarizeResults,
  suiteRunBlockReason,
  graderLabel,
  type EvalCase,
  type EvalSuite,
  type Grader,
} from "./eval-model.ts";

function mkCase(over: Partial<EvalCase> = {}): EvalCase {
  return { id: "c1", name: "case", input: "hi", graders: [], ...over };
}

// ---- contains / not_contains ----
{
  const r = gradeDeterministic({ kind: "contains", value: "hello" }, "well hello there", 10);
  assert.equal(r.pass, true, "contains finds substring");
  assert.equal(r.score, 1);
  const miss = gradeDeterministic({ kind: "contains", value: "bye" }, "hello", 10);
  assert.equal(miss.pass, false, "contains misses absent substring");
  const ci = gradeDeterministic({ kind: "contains", value: "HELLO", caseInsensitive: true }, "hello", 10);
  assert.equal(ci.pass, true, "contains honors caseInsensitive");
  const excl = gradeDeterministic({ kind: "not_contains", value: "error" }, "all good", 10);
  assert.equal(excl.pass, true, "not_contains passes when absent");
}

// ---- equals / regex ----
{
  assert.equal(gradeDeterministic({ kind: "equals", value: "  yes " }, "yes", 5).pass, true, "equals trims");
  assert.equal(gradeDeterministic({ kind: "regex", value: "^\\d{3}-\\d{4}$" }, "555-1234", 5).pass, true, "regex matches");
  assert.equal(gradeDeterministic({ kind: "regex", value: "(" }, "x", 5).pass, false, "invalid regex fails gracefully");
}

// ---- json_has ----
{
  const out = 'sure! ```json\n{"result":{"items":[{"id":7}]}}\n``` done';
  assert.equal(gradeDeterministic({ kind: "json_has", value: "result.items.0.id" }, out, 5).pass, true, "json_has digs into fenced json");
  assert.equal(gradeDeterministic({ kind: "json_has", value: "result.missing" }, out, 5).pass, false, "json_has fails on missing path");
  assert.equal(gradeDeterministic({ kind: "json_has", value: "a" }, "not json", 5).pass, false, "json_has fails on non-json");
}

// ---- latency_under ----
{
  assert.equal(gradeDeterministic({ kind: "latency_under", value: "1000" }, "x", 500).pass, true, "latency under limit passes");
  assert.equal(gradeDeterministic({ kind: "latency_under", value: "1000" }, "x", 1500).pass, false, "latency over limit fails");
}

// ---- llm_judge deferral ----
{
  const g: Grader = { kind: "llm_judge", value: "", rubric: "answer is polite" };
  assert.equal(graderNeedsModel(g), true, "judge needs a model call");
  const pending = gradeDeterministic(g, "whatever", 5);
  assert.equal(pending.pass, false, "deterministic pass is false until judged");
  const judged = applyJudgeVerdict(g, 0.8, "polite enough");
  assert.equal(judged.pass, true, "judge verdict >= 0.5 passes");
  assert.equal(judged.score, 0.8);
  assert.equal(applyJudgeVerdict(g, 0.3, "rude").pass, false, "judge verdict < 0.5 fails");
  assert.equal(graderNeedsModel({ kind: "contains", value: "x" }), false, "deterministic graders need no model");
}

// ---- buildCaseResult AND semantics ----
{
  const c = mkCase({ graders: [{ kind: "contains", value: "a" }, { kind: "contains", value: "b" }] });
  const allPass = buildCaseResult(c, "ab", 10, [
    gradeDeterministic(c.graders[0], "ab", 10),
    gradeDeterministic(c.graders[1], "ab", 10),
  ]);
  assert.equal(allPass.pass, true, "case passes when all graders pass");
  assert.equal(allPass.score, 1);
  const onePass = buildCaseResult(c, "a", 10, [
    gradeDeterministic(c.graders[0], "a", 10),
    gradeDeterministic(c.graders[1], "a", 10),
  ]);
  assert.equal(onePass.pass, false, "case fails when any grader fails");
  assert.equal(onePass.score, 0.5, "score is mean of grader scores");
  const errored = buildCaseResult(c, "", 0, [], "boom");
  assert.equal(errored.pass, false, "errored case never passes");
  assert.equal(errored.score, 0);
}

// ---- summarizeResults ----
{
  const c = mkCase({ graders: [{ kind: "contains", value: "x" }] });
  const results = [
    buildCaseResult(c, "x", 100, [gradeDeterministic(c.graders[0], "x", 100)]),
    buildCaseResult(c, "y", 300, [gradeDeterministic(c.graders[0], "y", 300)]),
  ];
  const s = summarizeResults(results);
  assert.equal(s.total, 2);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.passRate, 0.5);
  assert.equal(s.avgLatencyMs, 200);
  assert.deepEqual(summarizeResults([]), { total: 0, passed: 0, failed: 0, passRate: 0, avgScore: 0, avgLatencyMs: 0 }, "empty summary");
}

// ---- suiteRunBlockReason ----
{
  const base: EvalSuite = {
    id: "s1", name: "suite", cases: [], createdAt: "", updatedAt: "",
  };
  assert.match(suiteRunBlockReason(base, undefined) ?? "", /familiar/i, "blocks without familiar");
  assert.match(suiteRunBlockReason(base, "fam") ?? "", /at least one case/i, "blocks with no cases");
  const withBlank: EvalSuite = { ...base, cases: [mkCase({ input: "  " })] };
  assert.match(suiteRunBlockReason(withBlank, "fam") ?? "", /no input/i, "blocks blank input");
  const noGraders: EvalSuite = { ...base, cases: [mkCase({ input: "hi", graders: [] })] };
  assert.match(suiteRunBlockReason(noGraders, "fam") ?? "", /no graders/i, "blocks missing graders");
  const ok: EvalSuite = { ...base, cases: [mkCase({ input: "hi", graders: [{ kind: "contains", value: "x" }] })] };
  assert.equal(suiteRunBlockReason(ok, "fam"), null, "runnable suite has no block reason");
}

// ---- graderLabel ----
{
  assert.equal(graderLabel({ kind: "contains", value: "x" }), "Contains");
  assert.equal(graderLabel({ kind: "contains", value: "x", label: "Has greeting" }), "Has greeting");
}

console.log("eval-model.test.ts OK");
