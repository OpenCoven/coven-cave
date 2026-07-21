import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deskTab = readFileSync(new URL("./research-tab-desk.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./research-mission-list.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./research-mission-detail.tsx", import.meta.url), "utf8");
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

test("running and completed blocks stay honest about their data", () => {
  // Live activity lists real step reports; absence is said, not faked.
  assert.match(detail, /iteration\?\.steps\?\.length \? \(/);
  assert.match(detail, /No step detail reported yet/);
  assert.doesNotMatch(detail, /1[34]:\d\d/); // no fake clock times
  // Completed abstract is the iteration summary; meta counts are real; the
  // design's findings chips are not derivable and are skipped.
  assert.match(detail, /research-desk-block__abstract"?>\{iteration\.summary\}/);
  assert.match(detail, /\{mission\.sources\.length\} sources · \{sourceCounts\.used\} used/);
  assert.doesNotMatch(detail, /Finding 1|compFindings/);
});

// ── Evidence delta triage: exact ledger source-update mechanism ─────────────

test("Keep/Reject/Verify map onto the ledger's update-source action", () => {
  assert.match(detail, /action: "update-source",\s*sourceId: source\.id,\s*patch: \{ status: "used" \}/);
  assert.match(detail, /action: "update-source",\s*sourceId: source\.id,\s*patch: \{ status: "rejected" \}/);
  // Verify keeps the source conflicting and appends a note instead of
  // changing status.
  assert.match(detail, /status: "conflicting",\s*note: source\.note \? `\$\{source\.note\}\\n\$\{VERIFY_NOTE\}` : VERIFY_NOTE/);
  // Re-verifying is inert: the button disables once the marker is present.
  assert.match(detail, /\(source\.note \?\? ""\)\.includes\(VERIFY_NOTE\)/);
  // Triage actions only appear where they make sense.
  assert.match(detail, /source\.status === "conflicting" \|\| source\.status === "candidate"/);
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

test("plain text filters the runs rail and is never dropped silently", () => {
  // "/find rest" and plain text both feed the list filter.
  assert.match(deskTab, /\/\^\\\/find\\s\+\(\.\*\)\$\/i/);
  assert.match(deskTab, /findMatch \? findMatch\[1\] : isCommandText \? "" : query/);
  assert.match(deskTab, /filter=\{listFilter\}/);
  // The Prompt hand-off is explicit and honest — the tab contract carries a
  // mode, not a draft, and the hint says so.
  assert.match(deskTab, /Open in Prompt ↗/);
  assert.match(deskTab, /isn’t carried over/);
  assert.match(list, /filter\?: string/);
  assert.match(list, /`\$\{mission\.title\} \$\{mission\.intent\}`\.toLowerCase\(\)\.includes\(query\)/);
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

// ── Right rail: state switching + reachable ledger ──────────────────────────

test("the right rail switches panels by mission state", () => {
  // checkpoint/paused → evidence delta; live → streaming sources;
  // failed/completed/other settled → artifact cards.
  assert.match(detail, /mission\.status === "checkpoint" \|\| mission\.status === "paused"/);
  assert.match(detail, /new Set<ResearchMission\["status"\]>\(\["queued", "planning", "running"\]\)/);
  assert.match(detail, /const showArtifactRail = !isCheckpointLike && !isLive/);
  assert.match(detail, /Evidence delta — pass/);
  assert.match(detail, /Sources streaming in/);
  assert.match(detail, /Artifacts from pass/);
  // Streaming list highlights the most recent source without faking times.
  assert.match(detail, /is-latest/);
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

test("the full evidence ledger stays reachable inside the rail disclosure", () => {
  assert.match(detail, /research-desk-rail__ledger/);
  assert.match(detail, /<ResearchEvidenceLedger mission=\{mission\} onAction=\{onAction\} onOpenUrl=\{onOpenUrl\} \/>/);
  // The ledger keeps its own tab ids — pinned by researcher-surface.test.ts.
  assert.match(ledger, /idPrefix="research-output"/);
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

// ── Responsive collapses re-declared for the desk-tab overrides ─────────────

test("desk-tab responsive collapses match the existing container breakpoints", () => {
  assert.match(css, /@container research-desk \(max-width: 900px\) \{[\s\S]*?\.research-desk-tab \.research-desk__workspace \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /@container research-desk \(max-width: 760px\) \{[\s\S]*?\.research-desk-tab \.research-mission-detail__body \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.research-desk-rail \{ border-left: 0; border-top: 1px solid var\(--border\); \}/);
});
