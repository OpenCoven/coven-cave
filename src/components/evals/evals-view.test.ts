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
assert.match(source, /\/api\/evals\/groups/, "loads eval groups from the API");
assert.match(source, /\/api\/evals\/thread-states/, "loads thread eval state snapshots from the API");
assert.match(source, /\/api\/evals\/queue/, "queues manual grouped eval runs via the API");
assert.match(source, /\/api\/retro-runs/, "loads eval-loop snapshot data into the unified Evals surface");
assert.match(source, /method: "DELETE"/, "supports suite deletion");

// Run engine + readiness gate
assert.match(source, /runSuite\(/, "runs the suite through the client engine");
assert.match(source, /suiteRunBlockReason/, "gates Run on suite readiness");
assert.match(source, /disabled=\{!draft \|\| Boolean\(blockReason\)\}/, "Run is disabled when blocked or no suite is selected");
assert.match(source, /AbortController/, "a run can be stopped");
assert.match(source, /deriveThreadEvalState/, "derives thread eval freshness");
assert.match(source, /rollupEvalGroup/, "rolls grouped eval state into status counts");
assert.match(source, /EvalLoopPanel/, "embeds eval-loop controls in the unified Evals surface");
assert.match(source, /EvalsAnalysisSummary/, "renders a rich analysis summary");
assert.match(source, /LoopAnalysisPanel/, "renders eval-loop analysis inside Evals");
assert.match(source, /ThreadFreshnessPanel/, "renders grouped thread freshness analysis inside Evals");
assert.match(source, /downloadRetroSnapshot/, "keeps sanitized eval-loop export available inside Evals");
assert.match(source, /"overview" \| "suites" \| "runs" \| "loops" \| "threads"/, "unified surface has analysis-first tabs");
assert.match(source, /Overview/, "includes an Overview tab");
assert.match(source, /Suites/, "includes a Suites tab");
assert.match(source, /Loops/, "includes a Loops tab");
assert.match(source, /Thread freshness/, "includes a Thread freshness tab");
assert.match(source, /Run stale evals/, "exposes a manual queue action for stale group evals");
assert.match(source, /evals-group-panel/, "renders grouped eval state");
assert.match(source, /evals-stale-reason/, "renders stale reasons");
assert.match(source, /evals-thread-detail-grid/, "renders detailed thread eval freshness evidence");
assert.match(source, /Evaluated through/, "shows which turn the thread eval covers");
assert.match(source, /Confidence events/, "shows confidence event coverage for thread eval freshness");
assert.match(source, /Rubric/, "shows rubric version evidence for thread eval freshness");
assert.match(source, /key=\{`\$\{state\.familiarId\}:\$\{state\.threadId\}`\}/, "thread eval state keys include familiar id");
assert.doesNotMatch(source, /familiarId: member\.familiarId \?\? snapshot\?\.familiarId \?\? group\.id/, "group id should not be used as a fake familiar id");
assert.doesNotMatch(source, /latestTurnId: snapshot\?\.evaluatedThroughTurnId/, "current thread turn should not be copied from the snapshot");
assert.match(source, /latestTurnId: member\.latestTurnId/, "current thread turn comes from group member metadata when available");

// Editor: cases + graders
assert.match(source, /Add case/, "can add cases");
assert.match(source, /Add check/, "can add graders to a case");
assert.match(source, /GRADER_OPTIONS/, "exposes the grader kinds");
assert.match(source, /llm_judge/, "supports the LLM-judge grader");

// Tabs + results
assert.match(source, /tab === "suites"/, "has a suites tab");
assert.match(source, /tab === "runs"/, "has a runs tab");
assert.match(source, /evals-result/, "renders per-case results");
assert.match(source, /PASS|FAIL/, "shows pass/fail per case");

// Empty state
assert.match(source, /EmptyState/, "shows an empty state when there are no suites");

console.log("evals-view.test.ts OK");
