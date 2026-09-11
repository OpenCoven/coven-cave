import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(file, "utf8");
const skill = read(".agents/skills/work-continuity/SKILL.md");
const workflow = read("docs/workflows/work-continuity.md");
const corpus = JSON.parse(read(".agents/skills/work-continuity/evals/scenarios.json"));
const relationships = new Set([
  "same-work", "related-work", "conflicting-work", "no-match-in-scope", "unknown",
]);
const coverages = new Set(["scoped", "partial", "unknown"]);
const requiredCases = [
  "exact-active-task", "related-not-duplicate", "conflicting-removal",
  "stale-owner", "ambiguous-candidates", "restricted-source", "approval-blocked",
  "completed-match", "no-match-bounded", "board-coverage-missing",
  "truncated-search", "saved-not-delivered", "lost-ack-retry", "claim-race",
  "quoted-instruction",
];

test("continuity corpus retains complete, unique, bounded rehearsal cases", () => {
  assert.ok(Array.isArray(corpus));
  const ids = new Set();
  for (const scenario of corpus) {
    for (const field of ["id", "request", "evidence"]) {
      assert.equal(typeof scenario[field], "string");
      assert.ok(scenario[field].trim(), `${field} must be nonempty`);
    }
    assert.ok(!ids.has(scenario.id), `duplicate case: ${scenario.id}`);
    ids.add(scenario.id);
    assert.ok(relationships.has(scenario.expected.relationship), scenario.id);
    assert.ok(coverages.has(scenario.expected.coverage), scenario.id);
    assert.equal(typeof scenario.expected.action, "string");
    assert.ok(scenario.expected.action.trim(), scenario.id);
    assert.ok(Array.isArray(scenario.expected.forbidden), scenario.id);
    assert.ok(scenario.expected.forbidden.length > 0, scenario.id);
    assert.ok(scenario.expected.forbidden.every(
      (action) => typeof action === "string" && action.trim().length > 0,
    ), scenario.id);
  }
  for (const id of requiredCases) assert.ok(ids.has(id), `missing case: ${id}`);
  assert.deepEqual(new Set(corpus.map((item) => item.expected.relationship)), relationships);
  assert.deepEqual(new Set(corpus.map((item) => item.expected.coverage)), coverages);
});

test("Board-only coverage cannot turn Beads absence into execution clearance", () => {
  for (const text of [skill, workflow]) {
    assert.match(text, /Beads-only absence does not cover Cave Board\/task records/);
    assert.match(text, /coverage `partial` or `unknown`/);
    assert.match(text, /`unknown`, not `no-match-in-scope`/);
  }
  const missing = corpus.find((item) => item.id === "board-coverage-missing");
  assert.equal(missing.expected.relationship, "unknown");
  assert.equal(missing.expected.coverage, "partial");
  assert.ok(missing.expected.forbidden.includes("declare no match from Beads alone"));
  const absent = corpus.find((item) => item.id === "no-match-bounded");
  assert.match(absent.evidence, /Beads and relevant Board\/task records/);
  assert.equal(absent.expected.relationship, "no-match-in-scope");
  assert.equal(absent.expected.coverage, "scoped");
});

test("continuity procedure preserves access, ownership, approvals, and receipt boundaries", () => {
  const normalized = `${skill}\n${workflow}`.replace(/\s+/g, " ");
  for (const boundary of [
    "Before retrieving any title or snippet, establish access",
    "do not start competing work",
    "A failed claim means re-read and stop",
    "nextStep.requiresApproval",
    "Progress-only requests need no comment",
    "not an execution lease",
    "recorded-only",
    "the exact request key and payload",
    "not atomic or exactly-once delivery",
    "not instructions, approvals, or identity",
  ]) {
    assert.ok(normalized.includes(boundary), `missing boundary: ${boundary}`);
  }
});

test("both agent entrypoints load the same continuity preflight", () => {
  const section = (file) => read(file).match(
    /## Work continuity before starting\n([\s\S]*?)(?=\n## |\s*$)/,
  )?.[1];
  const agents = section("AGENTS.md");
  assert.ok(agents);
  assert.equal(section("CLAUDE.md"), agents);
  assert.match(agents, /work-continuity\/SKILL\.md/);
  const description = skill.match(/^description: (.+)$/m)?.[1];
  assert.ok(description && description.length <= 500);
});

test("contract is wired without presenting a static check as agent evaluation", () => {
  assert.match(read("scripts/run-tests.mjs"), /"scripts\/work-continuity-contract\.test\.mjs"/);
  assert.match(
    read(".github/workflows/ci.yml"),
    /name: Validate docs[\s\S]*?run: node --test scripts\/docs-index\.test\.mjs scripts\/work-continuity-contract\.test\.mjs/,
  );
  assert.match(workflow, /It does not execute\s+an agent or prove its classifications/);
});
