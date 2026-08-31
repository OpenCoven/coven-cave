import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// cave-y5tx2: plan/spec docs used to tell agentic workers that steps are tracked
// with checkbox syntax ("Steps use checkbox (`- [ ]`) syntax for tracking.").
// Roughly 86 of 97 plan docs shipped their work with zero boxes ticked, so an
// agent following that instruction concluded shipped work was unstarted — the
// confirmed instance is docs/specs/2026-07-21-ios-ultra-snappy-performance-plan.md
// (0/38 ticked; tasks 1-6 merged a month earlier in PR #3623). The headers now
// disclaim checkbox authority and point at code + merged PRs. These tests keep
// the misleading claim out and the disclaimer in.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The areas that carry the agentic-workers header (docs/plans and top-level
// docs/*.md like docs/content-gen-flow-plan.md are plan docs too).
const PLAN_AREAS = ["docs/specs", "docs/superpowers/plans", "docs/plans"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function collectPlanDocs() {
  const files = [];
  for (const area of PLAN_AREAS) {
    const dir = path.join(repoRoot, area);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() && entry.name.endsWith(".md")) files.push(path.join(area, entry.name));
    }
  }
  for (const entry of readdirSync(path.join(repoRoot, "docs"))) {
    if (entry.endsWith(".md") && entry !== "README.md") files.push(path.join("docs", entry));
  }
  return [...new Set(files)].sort();
}

const allDocs = walk(path.join(repoRoot, "docs")).map((f) => path.relative(repoRoot, f).split(path.sep).join("/"));
const planDocs = collectPlanDocs();

const textOf = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

// The old header claim: "Steps use checkbox (`- [ ]`) syntax for tracking."
const MISLEADING = /syntax for tracking/i;
const HEADER = "For agentic workers";
const CHECKBOX = /-\s*\[[ xX]\]/;
// Every doc that keeps checkboxes next to the agentic-workers header must say
// checkbox state is not authoritative. Two phrasings exist: the canonical one
// (cave-y5tx2) and the earlier "tracked in Beads, not a second task tracker"
// formulation used by docs/superpowers/plans/2026-07-09-ui-consistency-phase-0.md.
const DISCLAIMER = /not evidence of completion|not a second task tracker/i;

test("no docs/ markdown tells agentic workers checkbox syntax tracks progress (cave-y5tx2)", () => {
  const offenders = allDocs.filter((f) => MISLEADING.test(textOf(f)));
  assert.deepEqual(offenders, [],
    "checkbox state is not evidence of completion — code and merged PRs are authoritative (cave-y5tx2)");
});

test("plan docs with checkboxes and the agentic-workers header carry the disclaimer (cave-y5tx2)", () => {
  const offenders = planDocs.filter((f) => {
    const text = textOf(f);
    return CHECKBOX.test(text) && text.includes(HEADER) && !DISCLAIMER.test(text);
  });
  assert.deepEqual(offenders, [],
    "a doc that keeps checkboxes next to the agentic-workers header must disclaim checkbox authority (cave-y5tx2)");
});

// The acceptance case: a doc whose work has PARTIALLY shipped must not read as
// unstarted. The iOS ultra-snappy plan is 0/38 ticked while tasks 1-6 shipped
// in PR #3623 — exactly the misdirection this guard exists to prevent.
test("the partially-shipped iOS ultra-snappy plan cannot read as unstarted (cave-y5tx2)", () => {
  const target = "docs/specs/2026-07-21-ios-ultra-snappy-performance-plan.md";
  const text = textOf(target);
  assert.ok(!MISLEADING.test(text), "must not claim checkbox tracking");
  assert.ok(DISCLAIMER.test(text), "must disclaim checkbox authority");
  assert.ok(CHECKBOX.test(text), "keeps its (now disclaimed) step checkboxes");
});

console.log(`plan-doc-checkbox-hygiene.test.mjs: ${allDocs.length} docs scanned, ${planDocs.length} plan docs, no misleading checkbox-tracking claims`);