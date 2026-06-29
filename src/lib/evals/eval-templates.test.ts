// Unit tests for the eval template catalog. Templates must be self-contained
// and instantiate into runnable suites (so `suiteRunBlockReason` is happy with a
// familiar selected).
import assert from "node:assert/strict";
import {
  EVAL_TEMPLATES,
  EVAL_TEMPLATE_CATEGORIES,
  CATEGORY_LABELS,
  findEvalTemplate,
  templatesByCategory,
  instantiateTemplate,
  type EvalTemplate,
} from "./eval-templates.ts";
import { suiteRunBlockReason, type GraderKind } from "./eval-model.ts";

const VALID_KINDS: GraderKind[] = [
  "contains",
  "not_contains",
  "regex",
  "equals",
  "json_has",
  "latency_under",
  "llm_judge",
];

const REQUIRED_CAVE_TEMPLATE_IDS = [
  "cave-code-review-risks",
  "cave-tool-use-reliability",
  "cave-project-context-fidelity",
  "cave-action-summary-json",
  "cave-pr-merge-readiness",
  "cave-test-failure-triage",
  "cave-permission-blockers",
  "cave-memory-hygiene",
  "cave-thread-freshness",
  "cave-response-confidence",
  "cave-eval-loop-recovery",
  "cave-fast-status-update",
  "cave-familiar-voice",
] as const;

const GENERIC_BENCHMARK_TEMPLATE_IDS = [
  "factual-accuracy",
  "math-reasoning",
  "multilingual",
  "latency-slo",
] as const;

// Catalog is non-trivial and ids are unique.
assert.ok(EVAL_TEMPLATES.length >= 12, "catalog ships a comprehensive set of templates");
const ids = EVAL_TEMPLATES.map((t) => t.id);
assert.equal(new Set(ids).size, ids.length, "template ids are unique");
for (const requiredId of REQUIRED_CAVE_TEMPLATE_IDS) {
  assert.ok(ids.includes(requiredId), `catalog includes Cave-native template ${requiredId}`);
}
for (const genericId of GENERIC_BENCHMARK_TEMPLATE_IDS) {
  assert.ok(!ids.includes(genericId), `catalog does not keep generic benchmark template ${genericId}`);
}

// Every category in the index has a label.
for (const cat of EVAL_TEMPLATE_CATEGORIES) {
  assert.equal(CATEGORY_LABELS[cat.id], cat.label, `category ${cat.id} has a matching label`);
}

// Every template's category is declared in the index.
const knownCategories = new Set(EVAL_TEMPLATE_CATEGORIES.map((c) => c.id));
for (const template of EVAL_TEMPLATES) {
  assert.ok(knownCategories.has(template.category), `template ${template.id} uses a known category`);
}

// Structural validity of each template.
for (const template of EVAL_TEMPLATES) {
  assert.ok(template.name.trim().length > 0, `${template.id} has a name`);
  assert.ok(template.description.trim().length > 0, `${template.id} has a description`);
  assert.ok(template.icon.startsWith("ph:"), `${template.id} has a phosphor icon`);
  assert.ok(template.cases.length >= 1, `${template.id} has at least one case`);
  for (const c of template.cases) {
    assert.ok(c.name.trim().length > 0, `${template.id} case has a name`);
    assert.ok(c.input.trim().length > 0, `${template.id} case has a non-empty input`);
    assert.ok(c.graders.length >= 1, `${template.id} case has at least one grader`);
    for (const g of c.graders) {
      assert.ok(VALID_KINDS.includes(g.kind), `${template.id} grader uses a valid kind: ${g.kind}`);
      if (g.kind === "llm_judge") {
        assert.ok((g.rubric ?? "").trim().length > 0, `${template.id} judge grader has a rubric`);
      } else {
        // value-bearing graders need a value (latency carries ms in value too).
        assert.ok(typeof g.value === "string", `${template.id} grader value is a string`);
      }
      if (g.kind === "regex") {
        assert.doesNotThrow(() => new RegExp(g.value), `${template.id} regex grader compiles: ${g.value}`);
      }
      if (g.kind === "latency_under") {
        assert.ok(Number.isFinite(Number(g.value)), `${template.id} latency grader has numeric ms`);
      }
    }
  }
}

// Instantiation produces a runnable suite (deterministic id/now factories).
let counter = 0;
const makeId = (prefix: string) => `${prefix}-${counter++}`;
for (const template of EVAL_TEMPLATES) {
  const suite = instantiateTemplate(template, { makeId, now: "2026-01-01T00:00:00.000Z", familiarId: "fam-1" });
  assert.equal(suite.name, template.name, "suite carries the template name");
  assert.equal(suite.familiarId, "fam-1", "suite carries the chosen familiar");
  assert.equal(suite.cases.length, template.cases.length, "all cases are cloned");
  // Cloned cases get fresh ids and don't share grader object references.
  const caseIds = suite.cases.map((c) => c.id);
  assert.equal(new Set(caseIds).size, caseIds.length, "cloned case ids are unique");
  assert.notStrictEqual(suite.cases[0].graders[0], template.cases[0].graders[0], "graders are deep-cloned");
  // A familiar is selected, so the only block reason possible is content — assert none.
  assert.equal(suiteRunBlockReason(suite, suite.familiarId), null, `${template.id} instantiates to a runnable suite`);
}

// Lookups.
assert.ok(findEvalTemplate(EVAL_TEMPLATES[0].id), "findEvalTemplate resolves a known id");
assert.equal(findEvalTemplate("does-not-exist"), undefined, "findEvalTemplate returns undefined for unknown id");

// Grouping preserves the index order and contains every template once.
const groups = templatesByCategory();
const grouped = groups.flatMap((g: { templates: EvalTemplate[] }) => g.templates);
assert.equal(grouped.length, EVAL_TEMPLATES.length, "grouping includes every template exactly once");

console.log("eval-templates.test.ts OK");
