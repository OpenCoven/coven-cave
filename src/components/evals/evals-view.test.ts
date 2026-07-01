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
assert.match(source, /EvalGroupsPanel/, "renders the eval groups management panel inside Evals");
assert.match(source, /\["groups", "Groups"\]/, "includes a Groups tab in the nav");
assert.match(source, /downloadRetroSnapshot/, "keeps sanitized eval-loop export available inside Evals");
assert.match(source, /"overview" \| "insights" \| "suites" \| "runs" \| "compare" \| "loops" \| "threads" \| "groups"/, "unified surface has analysis-first tabs");
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

// Template gallery: clone a ready-made suite from the catalog.
assert.match(source, /templatesByCategory/, "loads the template catalog grouped by category");
assert.match(source, /instantiateTemplate/, "clones a template into an editable draft suite");
assert.match(source, /createFromTemplate/, "wires a create-from-template handler");
assert.match(source, /TemplateGallery/, "renders the template gallery");
assert.match(source, /Start from template/, "empty state offers a template entry point");
assert.match(source, /evals-tpl-card/, "renders selectable template cards");

// Migrated eval-discuss threads surfaced here instead of the chat list.
assert.match(source, /fetch\("\/api\/sessions\/list"\)/, "loads sessions to find eval threads");
assert.match(source, /s\.origin === "eval"/, "filters to eval-origin threads");
assert.match(source, /className="evals-thread-row"/, "renders a list of eval discussion threads");
assert.match(source, /cave:agents-open-session/, "opening a thread reopens it in the chat surface");

// Insights + Compare additions
assert.match(source, /EvalsInsightsPanel/, "renders the Insights panel");
assert.match(source, /RunCompare/, "renders the run Compare view");
assert.match(source, /"insights"/, "has an insights tab");
assert.match(source, /"compare"/, "has a compare tab");
assert.match(source, /slaMinPassRate/, "suite editor wires the SLA field");

// Suite rail collapses to a drawer on small screens (toggle + backdrop).
assert.match(source, /const \[railOpen, setRailOpen\] = useState\(false\)/, "tracks the suite-rail drawer open state");
assert.match(source, /className="evals-rail-toggle"/, "renders the small-screen Suites drawer toggle");
assert.match(source, /aria-controls="evals-rail"/, "the toggle is associated with the rail");
assert.match(source, /id="evals-rail" className="evals-rail"/, "the rail is the toggle's controlled region");
assert.match(source, /evals--rail-open/, "root reflects the drawer open state");
assert.match(source, /setRailOpen\(false\); \/\/ close the drawer after picking a suite/, "picking a suite closes the drawer");
const css = readFileSync(new URL("../../styles/evals.css", import.meta.url), "utf8");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.evals-rail \{[\s\S]*?transform: translateX\(-101%\)/, "the rail slides off-canvas under the narrow breakpoint");
assert.match(css, /\.evals--rail-open \.evals-rail \{ transform: translateX\(0\)/, "opening the drawer slides the rail in");
assert.doesNotMatch(css, /@media \(max-width: 720px\)[\s\S]*?\.evals-rail \{ display: none;/, "the rail no longer just vanishes on small screens");

console.log("evals-view.test.ts OK");
