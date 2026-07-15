import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(new URL("./researcher-surface.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./research-mission-composer.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./research-mission-list.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./research-mission-detail.tsx", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./research-evidence-ledger.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./use-research-missions.ts", import.meta.url), "utf8");
const missionsLib = readFileSync(new URL("../../lib/research-missions.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

test("surface is mission-first and no longer stores a pretend research desk", () => {
  assert.match(surface, /useResearchMissions/);
  assert.match(surface, /ResearchMissionComposer/);
  assert.match(surface, /ResearchMissionList/);
  assert.match(surface, /ResearchMissionDetail/);
  assert.doesNotMatch(surface, /RESEARCHER_INITIAL_STATE/);
});

test("composer makes Auto routing and finite bounds reviewable", () => {
  assert.match(composer, /What should we investigate\?/);
  assert.match(composer, /Start research/);
  assert.match(composer, /inferResearchMissionMode/);
  assert.match(composer, /Auto/);
  assert.match(composer, /maxIterations/);
  // Bound inputs clamp to the same limits the server enforces.
  assert.match(composer, /RESEARCH_BOUND_LIMITS/);
  assert.doesNotMatch(composer, /max=\{1440\}/);
});

test("mission list and evidence trajectory expose semantic state", () => {
  assert.match(list, /aria-current=\{selected/);
  assert.match(detail, /aria-label="Research progress"/);
  assert.match(detail, /Open session/);
  assert.match(ledger, /Open in Grimoire/);
});

test("the mission header does not print the intent twice", () => {
  // Short intents become the title verbatim (missionTitle), so the intent
  // paragraph only renders when it adds information beyond the title.
  assert.match(detail, /\{researchIntentAddsContext\(mission\) \? <p>\{mission\.intent\}<\/p> : null\}/);
});

test("evidence trajectory statuses come from the shared terminal-truthful reconciler", () => {
  // The old local heuristic trusted stale step snapshots over terminal mission
  // status (completed missions rendered "Scope running / rest pending") and
  // pinned every failure on scope. The reconciled statuses are computed by
  // researchPhaseStatuses (behaviorally tested in research-missions.test.ts).
  assert.match(detail, /researchPhaseStatuses\(mission, PHASE_IDS\)/);
  assert.doesNotMatch(detail, /function phaseStatus\(/);
  assert.doesNotMatch(detail, /mission\.status === "failed" && phase === "scope"/);
  // Stale step details must not contradict a reconciled status.
  assert.match(detail, /const reconciled = status !== \(step\?\.status \?\? "pending"\)/);
  assert.match(detail, /\{reconciled \? status : step\?\.detail \|\| status\}/);
});

test("timestamps are relative and schedules read as prose, not raw data", () => {
  assert.match(list, /relativeTime\(mission\.updatedAt\)/);
  assert.match(detail, /relativeTime\(mission\.updatedAt\)/);
  assert.match(detail, /describeResearchSchedule\(mission\.automation\.rrule\)/);
  assert.match(detail, /relativeTime\(mission\.automation\.lastRunAt\)/);
  assert.match(ledger, /relativeTime\(artifact\.updatedAt\)/);
  // Uppercase/capitalize chrome must not distort the relative-time text.
  assert.match(css, /\.research-mission-row__meta time \{[^}]*text-transform: none/);
  assert.match(css, /\.research-mission-detail__eyebrow time \{[^}]*text-transform: none/);
});

test("ledger errors stay visible regardless of the active output tab", () => {
  // The error paragraph renders between the tab strip and the first tab panel,
  // not inside a panel that may be hidden.
  assert.match(
    ledger,
    /\{error \? <p className="research-mission-error" role="alert">\{error\}<\/p> : null\}\s*<section\s+id="research-output-panel-artifacts"/,
  );
});

test("checkpoint lifecycle controls are explicit and server-backed", () => {
  assert.match(detail, /allowedResearchActions/);
  assert.match(detail, /Continue/);
  assert.match(detail, /Finish now/);
  assert.match(detail, /Refine direction/);
  assert.match(surface, /research\.act/);
});

test("the action bar reads decision-first with a consequence-labeled Continue", () => {
  // Why the run stopped renders before what to do about it: the stop and
  // decision banners sit above the action row in source order.
  const bannerIndex = detail.indexOf("research-mission-stop");
  const actionsIndex = detail.indexOf("research-mission-actions");
  assert.ok(bannerIndex !== -1 && actionsIndex !== -1 && bannerIndex < actionsIndex);
  // Continue says which iteration it starts (researchContinueLabel is
  // behaviorally tested in the lib suite) and demotes itself when the runner
  // would refuse a beyond-plan iteration.
  assert.match(detail, /researchContinueLabel\(mission\)/);
  assert.match(detail, /continueInfo\.beyondPlan \? "ghost" : "primary"/);
  assert.match(detail, /"aria-label": continueInfo\.description, title: continueInfo\.description/);
  assert.match(detail, /continueInfo\.label/);
});

test("retry adapts to project-root failures with a visible config", () => {
  // Failure class detection drives the retry payload…
  assert.match(detail, /rootFailure = mission\.status === "failed" && \/project root\/i\.test\(mission\.lastError \?\? ""\)/);
  assert.match(detail, /\{ action: "retry", projectRoot: null \}/);
  assert.match(detail, /projectRoot: retryRoot\.trim\(\) \|\| null/);
  // …the button label says what the retry will actually do…
  assert.match(detail, /Retry in workspace/);
  assert.match(detail, /Retry with new root/);
  assert.match(detail, /runAction\(action === "retry" \? plannedRetry : \{ action \}\)/);
  // …and the root is editable with an honest workspace fallback.
  assert.match(detail, /id="research-retry-root"/);
  assert.match(detail, /Leave empty to run in the mission workspace/);
  assert.match(css, /\.research-retry-config input/);
});

test("autoresearch schedules use standard paused Automation controls", () => {
  assert.match(detail, /Create schedule/);
  assert.match(detail, /Run now/);
  assert.match(detail, /Pause schedule/);
  assert.match(detail, /Resume schedule/);
  assert.match(surface, /research\.schedule/);
  assert.match(surface, /research\.controlAutomation/);
});

test("unknown research cost is shown honestly", () => {
  // The quiet em dash keeps its honest explanation for tooltips and screen
  // readers (researchBoundReadings, behaviorally tested in the lib suite).
  assert.match(missionsLib, /value: "—"/);
  assert.match(missionsLib, /Cost unavailable — the harness has not reported spend\./);
  assert.match(missionsLib, /hasReportedCost/);
});

test("bound meter over/met states are visible beyond color alone", () => {
  // Readings come from the shared gate-vs-target reconciler…
  assert.match(detail, /researchBoundReadings\(mission\)\.map/);
  // …tone lands as a class, prose lands as title + off-screen text…
  assert.match(detail, /research-bound--\$\{reading\.tone\}/);
  assert.match(detail, /title=\{reading\.detail\}/);
  assert.match(detail, /<span className="sr-only"> — \{reading\.detail\}<\/span>/);
  // …and the badge word makes over/met legible without color.
  assert.match(detail, /research-bound-badge/);
  assert.match(css, /\.research-bound--over dd/);
  assert.match(css, /\.research-bound--met dd/);
  assert.match(css, /\.research-bound-badge/);
});

test("polling is abortable, foreground-aware, and container responsive", () => {
  assert.match(hook, /AbortController/);
  assert.match(hook, /usePausablePoll/);
  assert.match(css, /\.research-desk\s*\{[\s\S]*?container-type:\s*inline-size/);
  assert.match(css, /@container research-desk/);
});

test("forms expose errors and narrow outputs become keyboard tabs", () => {
  assert.match(composer, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(composer, /role="alert"/);
  assert.match(ledger, /<Tabs<"artifacts" \| "sources">/);
  assert.match(ledger, /role="tabpanel"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@container research-desk \(max-width: 760px\)/);
});
