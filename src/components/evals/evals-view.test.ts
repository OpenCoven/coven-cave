// @ts-nocheck
// Source-text test for the Evals surface: pins the wiring that makes the page
// functional (familiar scoping, API endpoints, run engine, grader editing).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./evals-view.tsx", import.meta.url), "utf8");

// Familiar scoping + picker
assert.match(source, /familiars: ResolvedFamiliar\[\]/, "view receives resolved familiars");
assert.match(source, /activeFamiliarId/, "view honors the active familiar scope");
assert.match(source, /aria-label="Familiar to evaluate"/, "renders a familiar picker");

// API endpoints (CRUD + runs)
assert.match(source, /fetch\("\/api\/evals\/suites"\)/, "loads suites from the API");
assert.match(source, /\/api\/evals\/suites/, "saves/deletes suites via the API");
assert.match(source, /\/api\/evals\/runs/, "lists and persists runs via the API");
assert.match(source, /method: "DELETE"/, "supports suite deletion");

// Run engine + readiness gate
assert.match(source, /runSuite\(/, "runs the suite through the client engine");
assert.match(source, /suiteRunBlockReason/, "gates Run on suite readiness");
assert.match(source, /disabled=\{Boolean\(blockReason\)\}/, "Run is disabled when blocked");
assert.match(source, /AbortController/, "a run can be stopped");

// Editor: cases + graders
assert.match(source, /Add case/, "can add cases");
assert.match(source, /Add check/, "can add graders to a case");
assert.match(source, /GRADER_OPTIONS/, "exposes the grader kinds");
assert.match(source, /llm_judge/, "supports the LLM-judge grader");

// Tabs + results
assert.match(source, /tab === "editor"/, "has an editor tab");
assert.match(source, /tab === "runs"/, "has a runs tab");
assert.match(source, /evals-result/, "renders per-case results");
assert.match(source, /PASS|FAIL/, "shows pass/fail per case");

// Empty state
assert.match(source, /EmptyState/, "shows an empty state when there are no suites");

console.log("evals-view.test.ts OK");
