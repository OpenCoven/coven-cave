import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(new URL("./researcher-surface.tsx", import.meta.url), "utf8");
const deskTab = readFileSync(new URL("./research-tab-desk.tsx", import.meta.url), "utf8");
const promptTab = readFileSync(new URL("./research-tab-prompt.tsx", import.meta.url), "utf8");
const libraryTab = readFileSync(new URL("./research-tab-library.tsx", import.meta.url), "utf8");
const studioTab = readFileSync(new URL("./research-tab-studio.tsx", import.meta.url), "utf8");
const resourcesTab = readFileSync(new URL("./research-tab-resources.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./research-mission-composer.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./research-mission-list.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./research-mission-detail.tsx", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./research-evidence-ledger.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./use-research-missions.ts", import.meta.url), "utf8");
const clientLib = readFileSync(new URL("../../lib/research-mission-client.ts", import.meta.url), "utf8");
const missionsLib = readFileSync(new URL("../../lib/research-missions.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

// ── Tab host (cave-dl74 Phase A) ─────────────────────────────────────────────

test("surface is a five-tab host over one shared missions hook", () => {
  assert.match(surface, /useResearchMissions/);
  // One hook instance feeds every tab — tabs never re-fetch on their own.
  assert.match(surface, /const research = useResearchMissions\(context\.activeFamiliar\.id\)/);
  for (const tab of ["ResearchTabPrompt", "ResearchTabDesk", "ResearchTabLibrary", "ResearchTabStudio", "ResearchTabResources"]) {
    assert.match(surface, new RegExp(`<${tab}`));
  }
  assert.doesNotMatch(surface, /RESEARCHER_INITIAL_STATE/);
  // The tab-host contract is exported for the tab components to consume.
  assert.match(surface, /export type ResearchDeskTab = "prompt" \| "desk" \| "library" \| "studio" \| "resources"/);
  assert.match(surface, /export type ResearchTabProps/);
});

test("tab strip uses the shared Tabs tablist with wired panels", () => {
  // Shared Tabs component provides role=tablist/tab semantics + roving arrows.
  assert.match(surface, /<Tabs<ResearchDeskTab>/);
  assert.match(surface, /ariaLabel="Research desk views"/);
  assert.match(surface, /idPrefix="research-desk"/);
  // The active panel is a real tabpanel labelled by its tab.
  assert.match(surface, /role="tabpanel"/);
  assert.match(surface, /id=\{`research-desk-panel-\$\{activeTab\}`\}/);
  assert.match(surface, /aria-labelledby=\{`research-desk-tab-\$\{activeTab\}`\}/);
  assert.match(css, /\.research-desk__tabs/);
});

test("tab selection persists under cave:research:tab with an SSR guard", () => {
  assert.match(surface, /cave:research:tab/);
  assert.match(surface, /if \(typeof window === "undefined"\) return null/);
  assert.match(surface, /window\.localStorage\.getItem\(TAB_STORAGE_KEY\)/);
  assert.match(surface, /window\.localStorage\.setItem\(TAB_STORAGE_KEY, next\)/);
  // Stored garbage never becomes a tab.
  assert.match(surface, /isResearchDeskTab\(stored\) \? stored : null/);
});

test("default tab is desk when missions exist, else prompt — never persisted", () => {
  assert.match(surface, /tab \?\? \(research\.loading \|\| research\.missions\.length > 0 \? "desk" : "prompt"\)/);
  // Only explicit selections write to storage: the persist call lives in
  // selectTab, and the default is a derived fallback, not a setTab call.
  assert.match(surface, /const selectTab = useCallback\(\(next: ResearchDeskTab\) => \{\s*setTab\(next\);/);
});

test("engine status derives honestly from the daemon and live missions", () => {
  assert.match(surface, /context\.runtimeState\.daemonRunning/);
  assert.match(surface, /new Set\(\["running", "planning", "queued"\]\)/);
  assert.match(surface, /Engine ready · \$\{liveCount\} run\$\{liveCount === 1 \? "" : "s"\} live/);
  // Daemon down degrades honestly instead of pretending readiness.
  assert.match(surface, /Engine offline · runs stay retryable/);
  assert.match(surface, /data-tone=\{daemonRunning \? "ok" : "warn"\}/);
  // Tone is a class/dot + words, not color alone.
  assert.match(css, /\.research-desk__engine\[data-tone="warn"\] \.research-desk__engine-dot/);
});

test("desk tab flags waiting checkpoints only while the desk is not active", () => {
  assert.match(surface, /mission\.status === "checkpoint"/);
  assert.match(surface, /checkpointWaiting && activeTab !== "desk"/);
  // The dot carries sr-only text so the flag is not visual-only.
  assert.match(surface, /research-desk__tab-dot" aria-hidden/);
  assert.match(surface, /sr-only"> — a run is waiting at a checkpoint/);
  assert.match(css, /\.research-desk__tab-dot/);
});

test("onNavigate selects missions and routes Prompt modes per the contract", () => {
  assert.match(surface, /if \(opts\?\.missionId\) select\(opts\.missionId\)/);
  assert.match(surface, /if \(opts\?\.mode !== undefined\) setPromptMode\(opts\.mode\)/);
  assert.match(surface, /initialMode=\{promptMode \?\? undefined\}/);
  assert.match(promptTab, /initialMode\?: ResearchMissionMode/);
});

test("all five tab CSS modules are imported after the workspaces sheet", () => {
  // The effective globals.css keeps the facade's @import lines as inert
  // metadata (scripts/css-source-contract.cjs), so ordering is checkable.
  const workspaces = css.indexOf("surface-role-workspaces.css");
  assert.ok(workspaces !== -1);
  for (const name of ["desk", "prompt", "library", "studio", "resources"]) {
    const index = css.indexOf(`surface-research-${name}.css`);
    assert.ok(
      index > workspaces,
      `surface-research-${name}.css must be imported after surface-role-workspaces.css`,
    );
  }
});

// ── Desk tab composition (behavior preserved from the pre-tab surface) ──────

test("desk tab composes the mission workspace and keeps action wiring", () => {
  assert.match(deskTab, /ResearchMissionList/);
  assert.match(deskTab, /ResearchMissionDetail/);
  assert.match(deskTab, /research\.act/);
  assert.match(deskTab, /research\.schedule/);
  assert.match(deskTab, /research\.controlAutomation/);
  // Load errors surface with a retry, outside any hidden panel.
  assert.match(deskTab, /research-desk__error" role="alert"/);
  assert.match(deskTab, /void research\.load\(\)/);
  // Sessions open against the active familiar.
  assert.match(deskTab, /context\.openSession\(sessionId, context\.activeFamiliar\.id\)/);
});

test("prompt tab composes the composer + link shelf and follows starts to the desk", () => {
  assert.match(promptTab, /ResearchMissionComposer/);
  assert.match(promptTab, /ResearchLinkShelf/);
  assert.match(promptTab, /daemonRunning=\{context\.runtimeState\.daemonRunning\}/);
  assert.match(promptTab, /onNavigate\("desk", \{ missionId: result\.mission\.id \}\)/);
});

test("placeholder tabs report real counts only — no fabricated content", () => {
  assert.match(libraryTab, /mission\.artifacts\.length > 0/);
  assert.match(studioTab, /mission\.artifacts\.length > 0/);
  assert.match(resourcesTab, /mission\.sources\.length/);
  for (const stub of [libraryTab, studioTab, resourcesTab]) {
    assert.doesNotMatch(stub, /is being assembled|coming soon/i);
  }
});

// ── Composer / intake ────────────────────────────────────────────────────────

test("intake is minimal — the composer is the hero, no marketing copy column", () => {
  assert.doesNotMatch(promptTab, /research-desk__intake-copy/);
  assert.doesNotMatch(promptTab, /From intent to evidence/);
  // The intent question is asked exactly once: placeholder text, sr-only label.
  assert.match(composer, /className="sr-only">What should we investigate\?/);
  assert.match(composer, /placeholder="What should we investigate\?"/);
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

test("composer enforces the shared minimum intent requirement", () => {
  // Submit stays disabled and the guard bails until the trimmed intent meets
  // the same RESEARCH_INTENT_MIN_LENGTH the server validator enforces.
  assert.match(composer, /disabled=\{trimmedIntent\.length < RESEARCH_INTENT_MIN_LENGTH\}/);
  assert.match(composer, /trimmed\.length < RESEARCH_INTENT_MIN_LENGTH \|\| submitting/);
  // Too-short input explains itself accessibly instead of failing silently.
  assert.match(composer, /id="research-intent-minimum"/);
  assert.match(composer, /aria-invalid=\{Boolean\(error\) \|\| intentTooShort\}/);
  assert.match(composer, /"research-intent-minimum"\s*:\s*"research-plan-review"/);
  assert.match(css, /\.research-intent-minimum/);
});

test("the plan summary pill is the bounds toggle — honest, labeled, focusing", () => {
  // One quiet pill states the whole plan (mode · iterations · minutes · sources)…
  assert.match(composer, /className="research-plan-summary"/);
  assert.match(composer, /\{MODE_LABELS\[effectiveMode\]\} · \{bounds\.maxIterations\}/);
  // …explains Auto routing in its tooltip instead of a prose chip…
  assert.match(composer, /title=\{mode === "auto" \? inferred\.reason : "Selected manually"\}/);
  // …and toggles the bounds editor with real disclosure semantics, focusing
  // the first input when opening.
  assert.match(composer, /aria-expanded=\{boundsOpen\}/);
  assert.match(composer, /aria-controls="research-bounds-editor"/);
  assert.match(composer, /boundsOpen \? setBoundsOpen\(false\) : focusBound\("research-bound-minutes"\)/);
  assert.match(composer, /setBoundsOpen\(true\);\s*requestAnimationFrame\(\(\) => document\.getElementById\(inputId\)\?\.focus\(\)\)/);
  for (const id of ["research-bound-minutes", "research-bound-iterations", "research-bound-sources"]) {
    assert.match(composer, new RegExp(`id="${id}"`));
  }
  // The toggle must look pressable and expose focus + expanded states.
  assert.match(css, /\.research-plan-summary \{[^}]*cursor: pointer/);
  assert.match(css, /\.research-plan-summary:focus-visible/);
  assert.match(css, /\.research-plan-summary\[aria-expanded="true"\]/);
});


test("mission list uses roving tabindex keyboard navigation", () => {
  // Roving covers exactly the rendered rows: active always, archived only
  // while the disclosure group is expanded.
  assert.match(list, /resolveRovingId\(visibleIds, current, selectedId\)/);
  assert.match(list, /nextRovingId\(visibleIds, rovingId, event\.key as RovingKey\)/);
  assert.match(list, /tabIndex=\{mission\.id === rovingId \? 0 : -1\}/);
  assert.match(list, /onKeyDown=\{onListKeyDown\}/);
  assert.match(list, /buttonRefs\.current\.get\(id\)\?\.focus\(\)/);
  assert.match(list, /research-mission-row focus-ring/);
});

test("archived missions collapse into a disclosure group below active work", () => {
  // Partition: archived rows leave the working ledger…
  assert.match(list, /mission\.status === "archived" \? archived : active/);
  // …the header counts active missions only…
  assert.match(list, /<span>\{activeMissions\.length\}<\/span>/);
  // …and the group is a real count-labeled disclosure.
  assert.match(list, /aria-expanded=\{archivedOpen\}/);
  assert.match(list, /research-mission-nav__group-toggle focus-ring/);
  assert.match(list, /research-mission-nav__group-count">\{archivedMissions\.length\}/);
  // Selecting an archived mission keeps its row reachable by opening the group
  // exactly once per selection — re-collapse survives poll refreshes.
  assert.match(list, /autoOpenedFor\.current === selectedId\) return/);
  assert.match(list, /archivedMissions\.some\(\(mission\) => mission\.id === selectedId\)[\s\S]{0,80}setArchivedOpen\(true\)/);
  // An all-archived ledger says so instead of claiming there are no missions.
  assert.match(list, /No active missions\./);
  assert.match(css, /\.research-mission-nav__group-toggle/);
  // Auto-selection never lands inside the collapsed group.
  assert.match(clientLib, /mission\.status !== "archived"/);
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
  // Detail must re-render on a minute tick so the running wall-clock reading
  // and relative stamps advance between mission polls (cave-2hdg).
  assert.match(detail, /import \{ useMinuteTick \} from "@\/lib\/use-minute-tick"/);
  assert.match(detail, /useMinuteTick\(\)/);
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
  assert.match(deskTab, /research\.act/);
});

test("the action bar reads decision-first with a consequence-labeled Continue", () => {
  // Why the run stopped renders before what to do about it: the stop and
  // decision banners sit above the action row in source order.
  const bannerIndex = detail.indexOf("research-mission-stop");
  const actionsIndex = detail.indexOf("research-mission-actions");
  assert.ok(bannerIndex !== -1 && actionsIndex !== -1 && bannerIndex < actionsIndex);
  // Continue says which iteration it starts (researchContinueLabel is
  // behaviorally tested in the lib suite) and demotes itself when any runner
  // stop gate — iteration, wall-clock, cost policy, spend — already refuses.
  assert.match(detail, /researchContinueLabel\(mission\)/);
  assert.match(detail, /continueInfo\.gated \? "ghost" : "primary"/);
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
  assert.match(deskTab, /research\.schedule/);
  assert.match(deskTab, /research\.controlAutomation/);
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
  assert.match(composer, /aria-invalid=\{Boolean\(error\) \|\| intentTooShort\}/);
  assert.match(composer, /role="alert"/);
  assert.match(ledger, /<Tabs<"artifacts" \| "sources">/);
  assert.match(ledger, /role="tabpanel"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@container research-desk \(max-width: 760px\)/);
});
