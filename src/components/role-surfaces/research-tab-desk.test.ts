import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deskTab = readFileSync(new URL("./research-tab-desk.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./research-mission-list.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./research-mission-detail.tsx", import.meta.url), "utf8");
const pane = readFileSync(new URL("./use-research-pane.ts", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./research-evidence-ledger.tsx", import.meta.url), "utf8");
// The desk sheet rides with the mode-gated surface (bundle budget, #3264
// pattern), so selector pins read the sheet itself, not the root globals.
const css = readFileSync(new URL("../../styles/globals/surface-research-desk.css", import.meta.url), "utf8");

// ── Stepper: 6 displayed phases, reconciled statuses ─────────────────────────

test("stepper shows the six phases scope→publish with reconciled statuses", () => {
  // Display omits the runner's trigger phase; statuses still come from the
  // shared terminal-truthful reconciler over exactly the displayed ids.
  assert.match(detail, /\["scope", "Scope"\]/);
  assert.match(detail, /\["publish", "Publish"\]/);
  assert.doesNotMatch(detail, /\["trigger"/);
  assert.match(detail, /researchPhaseStatuses\(mission, PHASE_IDS\)/);
  // Stale step details never contradict a reconciled status, and every node
  // carries its status as text (not glyph/color alone).
  assert.match(detail, /const reconciled = status !== \(step\?\.status \?\? "pending"\)/);
  assert.match(detail, /\{reconciled \? status : step\?\.detail \|\| status\}/);
  // Node marks: ✓ succeeded, ✕ failed; running glows via CSS.
  assert.match(detail, /status === "succeeded" \? \([\s\S]{0,80}ph:check/);
  assert.match(detail, /status === "failed" \? \([\s\S]{0,80}ph:x/);
  assert.match(css, /\.research-desk-step--running \.research-desk-step__node/);
  // Reduced motion stops the running pulse.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.research-desk-step--running \.research-desk-step__node \{ animation: none; \}/);
});

test("bounds row keeps the shared readings with not-color-only badges", () => {
  assert.match(detail, /researchBoundReadings\(mission\)\.map/);
  assert.match(detail, /research-bound--\$\{reading\.tone\}/);
  assert.match(detail, /research-bound-badge/);
  assert.match(detail, /<span className="sr-only"> — \{reading\.detail\}<\/span>/);
  // Pass note sits with the bounds row and derives from real iteration data.
  assert.match(detail, /research-desk-stepper__pass/);
  assert.match(detail, /pass \$\{iteration\.number\} of \$\{mission\.bounds\.maxIterations\}/);
});

// ── Checkpoint delta: derived-only tiles, omit when missing ─────────────────

test("checkpoint tiles derive from real data and are omitted when missing", () => {
  // Per-iteration source attribution does not exist in the mission model, so
  // the ledger total ships instead of an invented "+N new sources".
  assert.match(detail, /sources gathered so far/);
  assert.doesNotMatch(detail, /new sources gathered/);
  // Conflicting tile only renders when the count is non-zero…
  assert.match(detail, /sourceCounts\.conflicting > 0 \? \(/);
  // …the draft-version tile only when a working artifact exists…
  assert.match(detail, /artifact\.state === "working"/);
  assert.match(detail, /\{draftArtifact \? \(/);
  assert.match(detail, /v\{draftArtifact\.iteration\}/);
  // …and the note paragraph only when the iteration wrote a summary.
  assert.match(detail, /\{iteration\?\.summary \? \(/);
  // No fabricated design copy.
  assert.doesNotMatch(detail, /pricing pages for two hosted harnesses/);
});

test("checkpoint direction can be drafted agentically without auto-continuing", () => {
  assert.match(detail, /generateResearchRefineDirection/);
  assert.match(detail, /Draft with familiar/);
  assert.match(detail, /Redraft with familiar/);
  assert.match(detail, /Reading the checkpoint and choosing the highest-value next pass…/);
  assert.match(detail, /directionRef\.current === baseDraft/);
  assert.match(detail, /Direction ready — your edits were kept\./);
  assert.match(detail, /Apply direction/);
  assert.match(detail, /Keep mine/);
  assert.match(detail, /maxLength=\{RESEARCH_DIRECTION_MAX_LENGTH\}/);
  assert.match(
    detail,
    /onClick=\{\(\) => void runAction\(\{ action: "refine", direction \}\)\}/,
  );
  assert.doesNotMatch(
    detail,
    /generateResearchRefineDirection\([\s\S]{0,800}?runAction\(\{ action: "refine"/,
  );
  assert.match(css, /\.research-desk-refine__actions \{/);
  assert.match(css, /\.research-desk-refine__suggestion \{/);
});

test("running and completed blocks stay honest about their data", () => {
  // Live activity lists real step reports; absence is said, not faked.
  assert.match(detail, /iteration\?\.steps\?\.length \? \(/);
  assert.match(detail, /No step detail reported yet/);
  assert.doesNotMatch(detail, /1[34]:\d\d/); // no fake clock times
  // Completed abstract is the iteration summary; meta counts are real; the
  // design's findings chips are not derivable and are skipped.
  // …rendered through the line-clamp so a long abstract stays compact with a
  // "View more" toggle, but it is still the raw iteration summary.
  assert.match(detail, /<ClampedText className="research-desk-block__abstract" text=\{iteration\.summary\} \/>/);
  assert.match(detail, /\{mission\.sources\.length\} sources · \{sourceCounts\.used\} used/);
  assert.doesNotMatch(detail, /Finding 1|compFindings/);
});

test("run failures disclose persisted diagnostics without fabricating a cause", () => {
  assert.match(detail, /View diagnostics/);
  assert.match(detail, /<Modal[\s\S]*?breadcrumb=\{\["Research", "Diagnostics"\]\}/);
  assert.match(detail, /researchDiagnosticTrace\(mission\)/);
  assert.match(detail, /Copy trace JSON/);
  assert.match(detail, /copyDiagnosticTrace/);
  // Bind the transient copy confirmation to its mission at render time: an
  // effect-only reset would paint the next mission as copied for one frame.
  assert.match(detail, /const diagnosticsCopied = diagnosticsCopiedFor === missionId/);
  assert.match(detail, /setDiagnosticsCopiedFor\(startedFor\)/);
  assert.match(detail, /setActionError\(null\);\n    const copied = await copyText\(traceJson\)/);
  assert.match(detail, /\{actionError \? <p className="research-mission-error" role="alert">\{actionError\}<\/p> : null\}/);
  assert.match(detail, /actionError && !diagnosticsOpen/);
  assert.match(detail, /Daemon trace: not recorded/);
  assert.match(detail, /\["Error", mission\.lastError \?\? "No current error"\]/);
  assert.match(detail, /\["Flow run", iteration\?\.flowRunId \?\? "No flow run recorded"\]/);
  assert.match(detail, /\["Session", sessionId \?\? "No session recorded"\]/);
  assert.match(detail, /primaryArtifact\.relativePath/);
  assert.match(detail, /\["Sources", `\$\{mission\.sources\.length\} recorded/);
  assert.match(css, /\.research-mission-diagnostics/);
  assert.match(css, /\.research-mission-diagnostics__timeline/);
  assert.match(css, /\.research-mission-diagnostics__finding/);
  assert.match(css, /var\(--bg-sunken\)/);
  assert.match(css, /research-mission-diagnostics__phase[^\n]*var\(--radius-pill\)/);
  assert.doesNotMatch(css, /--radius-full/);
});

// ── Evidence triage: exact ledger source-update mechanism ──────────────────
// Triage lives in the ledger now — the rail's Sources pane IS the ledger, so
// the checkpoint verdicts ride the same source cards as the full list.

test("Keep/Reject/Verify map onto the ledger's update-source action", () => {
  assert.match(ledger, /action: "update-source",\s*sourceId: source\.id,\s*patch: \{ status: "used" \}/);
  assert.match(ledger, /action: "update-source",\s*sourceId: source\.id,\s*patch: \{ status: "rejected" \}/);
  // Verify keeps the source conflicting and appends a note instead of
  // changing status.
  assert.match(ledger, /status: "conflicting",\s*note: source\.note \? `\$\{source\.note\}\\n\$\{VERIFY_NOTE\}` : VERIFY_NOTE/);
  // Re-verifying is inert: the button disables once the marker is present.
  assert.match(ledger, /\(source\.note \?\? ""\)\.includes\(VERIFY_NOTE\)/);
  // Triage actions only appear at a checkpoint, on sources still awaiting a
  // verdict; the status control below them stays available always.
  assert.match(ledger, /triage && \(source\.status === "candidate" \|\| source\.status === "conflicting"\)/);
  assert.match(detail, /triage=\{isCheckpointLike\}/);
});

// ── Command bar: real destinations only ─────────────────────────────────────

test("desk commands map to real destinations only", () => {
  assert.match(deskTab, /onNavigate\("prompt", \{ mode: "brief" \}\)/);
  assert.match(deskTab, /onNavigate\("prompt", \{ mode: "sweep" \}\)/);
  assert.match(deskTab, /onNavigate\("prompt", \{ mode: "paper" \}\)/);
  // /deep is the deep loop — autoresearch, not a fabricated mode.
  assert.match(deskTab, /onNavigate\("prompt", \{ mode: "autoresearch" \}\)/);
  assert.match(deskTab, /onNavigate\("resources"\)/);
  // /chat only exists while the selected mission has a real session.
  assert.match(deskTab, /\.\.\.\(selectedSessionId \? \[\{/);
  // No /task — there is no board-create destination reachable from the desk.
  assert.doesNotMatch(deskTab, /"\/task"/);
});

test("desk toolbar is truthful, scoped, and keyboard reachable", () => {
  assert.match(deskTab, /<SearchInput/);
  assert.match(deskTab, /placeholder="Filter runs…"/);
  assert.match(deskTab, /aria-label="Filter research runs"/);
  assert.match(deskTab, /aria-keyshortcuts="\/"/);
  assert.match(deskTab, />\s*New research\s*<\/Button>/);
  assert.match(deskTab, /ResearchMissionScope/);
  assert.match(
    deskTab,
    /researchMissionScopeCounts\(\s*filterResearchMissionsByText\(research\.missions, listFilter\)/,
  );
  assert.match(
    deskTab,
    /aria-label=\{`\$\{item\.label\}, \$\{scopeCounts\[item\.id\]\} \$\{scopeCounts\[item\.id\] === 1 \? "run" : "runs"\}`\}/,
  );
  assert.match(deskTab, /window\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(
    deskTab,
    /target\?\.closest\("input, textarea, select, \[contenteditable='true'\]"\)/,
  );
  assert.match(
    deskTab,
    /document\.querySelector\('\[role="dialog"\]\[aria-modal="true"\]'\)/,
  );
});

test("focus mode persists per familiar and announces both states", () => {
  assert.match(
    deskTab,
    /useEffect\(\(\) => \{\s*setQuery\(""\);\s*setScope\("all"\);\s*setFocusMode\(readFocusMode\(familiarId\)\);/,
  );
  assert.match(deskTab, /FOCUS_STORAGE_PREFIX[\s\S]*familiarId/);
  assert.match(deskTab, /window\.localStorage\.getItem/);
  assert.match(deskTab, /window\.localStorage\.setItem/);
  assert.match(
    deskTab,
    /announce\(next \? "Focus mode enabled\." : "Workspace rails restored\."\)/,
  );
  assert.match(deskTab, /focusMode \? "Show workspace" : "Focus run"/);
});

test("plain text filters the runs rail and creation stays one action away", () => {
  // "/find rest" and plain text both feed the list filter.
  assert.match(deskTab, /\/\^\\\/find\\s\+\(\.\*\)\$\/i/);
  assert.match(deskTab, /findMatch \? findMatch\[1\] : isCommandText \? "" : query/);
  assert.match(deskTab, /filter=\{listFilter\}/);
  // New research is an always-visible, honest destination; the filter no
  // longer masquerades as a question composer or grows a hand-off hint.
  assert.match(deskTab, /onNavigate\("prompt"\)/);
  assert.doesNotMatch(deskTab, /Open in Prompt ↗|isn’t carried over/);
  assert.match(list, /filter\?: string/);
  assert.match(list, /filterResearchMissionsByText\(missions, filter\)/);
  // A filtered-empty rail says the filter is why.
  assert.match(list, /No runs match/);
});

test("runs rail header derives the amber checkpoint line from real missions", () => {
  assert.match(list, /mission\.status === "checkpoint"/);
  assert.match(list, /checkpointMissions\.length > 0 \? \(/);
  assert.match(list, /checkpoint\{checkpointMissions\.length === 1 \? "" : "s"\} waiting/);
  // The attention line derives from the FULL mission set — a rail filter must
  // not hide a waiting checkpoint.
  assert.match(list, /missions\.filter\(\(mission\) => mission\.status === "checkpoint"\)/);
  assert.match(css, /\.research-mission-nav__waiting/);
});

test("planning missions read as active work in the runs rail", () => {
  // planning is a working state — its status dot carries the same busy tone
  // as running/queued, never the muted idle dot.
  assert.match(list, /running: "busy"/);
  assert.match(list, /planning: "busy"/);
  assert.match(list, /queued: "busy"/);
});

test("mission navigation composes text scope and priority groups", () => {
  assert.match(list, /scope: ResearchMissionScope/);
  assert.match(list, /matchesResearchMissionScope\(mission, scope\)/);
  assert.match(list, /groupResearchMissions\(filteredMissions\)/);
  assert.match(list, /research-mission-nav__section-title/);
  assert.match(list, />\s*Clear filters\s*<\/Button>/);
  assert.match(list, /groups\.flatMap/);
});

// ── Right rail: state switching + reachable ledger ──────────────────────────

test("focus mode removes both rails without changing mission detail", () => {
  assert.match(detail, /showEvidence: boolean/);
  assert.match(detail, /\{showEvidence \? \(\s*<aside/);
  assert.match(detail, /data-evidence-open=\{showEvidence\}/);
  // Focus hides the rail outright; the independent collapse (next test) is a
  // second axis, so focus must win even with the evidence rail left open.
  assert.match(deskTab, /showEvidence=\{!focusMode && evidenceOpen\}/);
  assert.match(deskTab, /data-focus-mode=\{focusMode\}/);
  assert.match(
    css,
    /\.research-desk-tab \.research-desk__workspace\[data-focus-mode="true"\]/,
  );
  // Focus also hides the queue's spine and drag separator — leaving either
  // behind puts a stray 36px column beside a supposedly full-width run.
  assert.match(css, /data-focus-mode="true"\]\s*>\s*\.research-desk-handle/);
  assert.match(css, /data-focus-mode="true"\]\s*>\s*\.research-desk-spine/);
  // And it offers no collapse controls, because there is nothing to collapse.
  assert.match(deskTab, /onCollapseEvidence=\{focusMode \? undefined :/);
  assert.match(deskTab, /onOpenEvidence=\{focusMode \? undefined :/);
});

test("both desk rails resize, persist and collapse to a labelled spine", () => {
  // Width clamps on READ as well as write, so a stale or hand-edited
  // localStorage value can never wedge a rail off screen.
  assert.match(pane, /function readStoredWidth/);
  assert.match(pane, /Number\.isFinite\(parsed\) \? clamp\(parsed, min, max\) : initial/);
  // Pointer capture, not a bare mousemove listener: releasing outside the
  // window must still end the drag rather than gluing the rail to the cursor.
  assert.match(pane, /setPointerCapture/);
  assert.match(pane, /pointercancel/);
  // Keyboard parity — a drag handle no keyboard can reach is a rail no
  // keyboard user can size.
  assert.match(pane, /role: "separator"/);
  assert.match(pane, /tabIndex: 0/);
  assert.match(pane, /ArrowLeft/);
  assert.match(deskTab, /useResearchPane\(QUEUE_PANE\)/);
  assert.match(deskTab, /useResearchPane\(RAIL_PANE\)/);
  assert.match(deskTab, /queue\.separatorProps/);
  // The evidence rail grows leftward, so its drag direction is inverted —
  // sharing the queue's +1 would move it the wrong way under the cursor.
  assert.match(deskTab, /RAIL_PANE = \{[\s\S]*?direction: -1/);
  assert.match(deskTab, /railSeparatorProps=\{focusMode \? undefined : rail\.separatorProps\}/);
  assert.match(detail, /research-desk-handle--rail/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 0 var\(--research-rail-width, 320px\)/);
  // A collapsed rail still says what it holds, in words and in a count.
  assert.match(deskTab, /research-desk-spine__badge/);
  assert.match(deskTab, /aria-label=\{`Open the run queue/);
  assert.match(detail, /aria-label=\{`Open the evidence inspector/);
  assert.match(css, /\.research-desk__workspace\[data-queue-collapsed="true"\]/);
  assert.match(css, /\.research-mission-detail__body\[data-evidence-spine="true"\]/);
});

test("the right rail is one Artifacts|Sources toggle over a full-height pane", () => {
  // No stacked state panels: a single segmented toggle drives one pane that
  // takes the rail's remaining height, with the quick links pinned under it.
  assert.match(detail, /<Tabs<ResearchOutputTab>/);
  assert.match(detail, /variant="segment"/);
  assert.match(detail, /\{ id: "artifacts", label: "Artifacts", count: mission\.artifacts\.length \}/);
  assert.match(detail, /\{ id: "sources", label: "Sources", count: mission\.sources\.length \}/);
  assert.match(detail, /className="research-desk-rail__pane"/);
  assert.match(css, /\.research-desk-rail__pane \{[^}]*flex: 1;[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(css, /\.research-desk-rail__links \{[^}]*flex: none;/);
  // The old stacked panels are gone.
  assert.doesNotMatch(detail, /research-desk-rail__panel/);
  assert.doesNotMatch(detail, /Sources streaming in/);
});

test("run state picks the opening pane and the pane's context line", () => {
  // checkpoint/paused/live open on Sources (triage + arrivals); settled runs
  // open on what they produced. A mission switch re-derives it; a status
  // change inside one mission leaves the reader's choice alone.
  assert.match(detail, /missionStatus === "checkpoint" \|\| missionStatus === "paused" \|\| LIVE_STATUSES\.has\(missionStatus\)/);
  assert.match(detail, /\? "sources"\s*: "artifacts"/);
  assert.match(detail, /if \(railTabMission !== missionId\) \{\s*setRailTabMission\(missionId\);\s*setRailTab\(defaultRailTab\);\s*\}/);
  // The context the stacked panel titles used to carry survives as one hint.
  assert.match(detail, /Evidence delta — pass/);
  assert.match(detail, /targeted — streaming in, review anytime/);
  assert.match(detail, /highlightLatest=\{isLive\}/);
  // The streaming highlight marks the newest ledger entry without faking times.
  assert.match(ledger, /mission\.sources\[mission\.sources\.length - 1\]\.id/);
  assert.match(ledger, /is-latest/);
  assert.doesNotMatch(detail, /Reading: /);
});

test("quick links exist only when their destinations do", () => {
  // Chat link is gated on a real session id; resources always has a tab.
  assert.match(detail, /\{sessionId \? \([\s\S]{0,400}Discuss this run in chat/);
  assert.match(detail, /onShowResources/);
  assert.match(deskTab, /onShowResources=\{\(\) => onNavigate\("resources"\)\}/);
  // No "Create task" link — there is no board-create destination wired here.
  assert.doesNotMatch(detail, /Create task/);
});

test("the full evidence ledger is the rail pane, not a nested disclosure", () => {
  // One copy of the evidence: the ledger renders the open pane directly, so
  // there is no collapsed duplicate of the same artifacts/sources below it.
  assert.match(detail, /<ResearchEvidenceLedger\s+mission=\{mission\}[\s\S]{0,300}tab=\{railTab\}/);
  assert.doesNotMatch(detail, /research-desk-rail__ledger/);
  // The tablist moved to the rail, so the ledger renders panels only — their
  // ids still match the rail toggle's idPrefix.
  assert.match(detail, /idPrefix="research-output"/);
  assert.doesNotMatch(ledger, /<Tabs/);
  assert.match(ledger, /id="research-output-panel-artifacts"/);
  assert.match(ledger, /id="research-output-panel-sources"/);
});

// ── Action bar ──────────────────────────────────────────────────────────────

test("the action bar stays decision-first, sticky, with end actions split right", () => {
  // The stop/decision banner precedes the action bar in source order.
  const bannerIndex = detail.indexOf("research-mission-stop");
  const actionsIndex = detail.indexOf("research-mission-actions");
  assert.ok(bannerIndex !== -1 && actionsIndex !== -1 && bannerIndex < actionsIndex);
  // Actions still come from the shared gate, with the consequence-labeled
  // Continue demoting itself when a stop gate refuses.
  assert.match(detail, /allowedResearchActions\(mission\)/);
  assert.match(detail, /continueInfo\.gated \? "ghost" : "primary"/);
  // Cancel/Archive detach to the right edge of the bar.
  assert.match(detail, /new Set\(\["cancel", "archive"\]\)/);
  assert.match(detail, /\{mainActions\.map\(renderActionButton\)\}/);
  assert.match(detail, /\{endActions\.map\(renderActionButton\)\}/);
  assert.match(detail, /research-mission-actions__spacer/);
  assert.match(css, /\.research-desk-tab \.research-mission-actions \{[^}]*position: sticky/);
  // No kbd chip — the desk registers no keyboard shortcut to claim.
  assert.doesNotMatch(detail, /⌘/);
});

// ── Action failures: surfaced, mission-scoped, never wedge the bar ──────────

test("detail action failures surface into the error line and clear busy", () => {
  // Every action path funnels through the shared settle helper:
  // { ok: false } from the hook is the primary error path…
  assert.match(detail, /const message = result\.error \?\? fallbackError/);
  assert.match(detail, /setActionError\(message\);\s*announce\(message\)/);
  // …a transport throw lands in the same state (defense only — a throw skips
  // the ok branch, so a failure is never reported twice)…
  assert.match(detail, /catch \(error\) \{[\s\S]{0,120}error instanceof Error \? error\.message : fallbackError/);
  // …and the busy flag always clears for the mission that set it.
  assert.match(detail, /finally \{\s*if \(stillCurrent\(\)\) setBusy\(false\);\s*\}/);
  // Schedule and automation calls ride the same helper with honest fallbacks.
  assert.match(detail, /"Automation action failed",\s*\(\) => onAutomationAction\(automation\.id, action\)/);
  assert.match(detail, /"Research schedule could not be created",\s*\(\) => onSchedule\("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0"\)/);
});

test("an action settling after a mission switch is discarded", () => {
  // The settle handlers compare the id captured at start against the ref that
  // tracks the on-screen mission…
  assert.match(detail, /const missionIdRef = useRef\(missionId\)/);
  assert.match(detail, /const startedFor = mission\.id/);
  assert.match(detail, /const stillCurrent = \(\) => missionIdRef\.current === startedFor/);
  assert.match(detail, /if \(!stillCurrent\(\)\) return;/);
  // …and the switch itself resets busy alongside the other per-mission state
  // so the fresh mission never inherits a disabled action bar.
  assert.match(
    detail,
    /missionIdRef\.current = missionId;[\s\S]*?setBusy\(false\);\s*setDirectionDrafting\(false\);\s*setDirectionSuggestion\(null\);\s*setRetryRoot\(null\);\s*setActionError\(null\);\s*setDirection\(""\);\s*\}, \[missionId\]\)/,
  );
});

test("archived missions gate automation controls like the schedule button", () => {
  assert.match(detail, /const isArchived = mission\.status === "archived"/);
  // Pause/Resume schedule and Run now both disable once the mission archives.
  assert.match(detail, /disabled=\{busy \|\| isArchived\}/);
  assert.match(detail, /disabled=\{busy \|\| isArchived \|\| mission\.status === "completed"\}/);
});

// ── Responsive collapses re-declared for the desk-tab overrides ─────────────

test("desk-tab responsive collapses match the existing container breakpoints", () => {
  // Both the open and the collapsed grid must flatten together — flattening
  // only one leaves a 36px spine stacked above a full-width run.
  assert.match(css, /@container research-desk \(max-width: 900px\) \{[\s\S]*?\.research-desk-tab \.research-desk__workspace,\s*\.research-desk-tab \.research-desk__workspace\[data-queue-collapsed="true"\] \{\s*grid-template-columns: 1fr;/);
  assert.match(css, /@container research-desk \(max-width: 900px\) \{[\s\S]*?\.research-desk-handle \{ display: none; \}/);
  assert.match(css, /@container research-desk \(max-width: 760px\) \{[\s\S]*?\.research-desk-tab \.research-mission-detail__body,\s*\.research-desk-tab \.research-mission-detail__body\[data-evidence-spine="true"\] \{\s*grid-template-columns: 1fr;/);
  assert.match(
    css,
    /\.research-desk-rail \{[\s\S]*?border-left: 0;[\s\S]*?border-top: 1px solid var\(--border\);/,
  );
});

test("narrow desks bound secondary rails while preserving the run surface", () => {
  assert.match(
    css,
    /@container research-desk \(max-width: 900px\)[\s\S]*?max-height: calc\(var\(--space-10\) \* 4\)/,
  );
  assert.match(
    css,
    /@container research-desk \(max-width: 760px\)[\s\S]*?\.research-desk-rail \{[\s\S]*?max-height: 44vh/,
  );
  assert.match(
    css,
    /@container research-desk \(max-width: 560px\)[\s\S]*?\.research-desk-toolbar__main/,
  );
});

// ── Artifact actions: shared component mounted on rail + saved summary ──────

test("rail artifacts render shared artifact actions with publish on settled missions", () => {
  assert.match(ledger, /ResearchArtifactActions/);
  assert.match(ledger, /onPublish=\{settled \? publishArtifact : undefined\}/);
  assert.match(ledger, /action: "publish-artifact"/);
  assert.match(ledger, /Artifact published to the Grimoire\./);
});

test("desk shows a saved-artifacts summary with a copy-workspace-path affordance", () => {
  assert.match(detail, /fetchResearchWorkspacePath/);
  assert.match(detail, /artifacts published to the Grimoire\./);
  assert.match(detail, /working files saved in the mission workspace\./);
  assert.match(detail, /Copy workspace path/);
  assert.match(detail, /Workspace path copied/);
});
