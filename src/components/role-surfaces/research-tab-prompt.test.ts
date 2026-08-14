import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  defaultResearchPlan,
  inferResearchMissionMode,
} from "../../lib/research-mission-routing.ts";
import { buildPromptEnhancement } from "../../lib/prompt-enhancer.ts";

const promptTab = readFileSync(new URL("./research-tab-prompt.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./research-mission-composer.tsx", import.meta.url), "utf8");
// The prompt sheet rides with the mode-gated surface (bundle budget, #3264
// pattern), so selector pins read the sheet itself, not the root globals.
const css = readFileSync(new URL("../../styles/globals/surface-research-prompt.css", import.meta.url), "utf8");

// ── Intake validation (unchanged contract from the pre-redesign composer) ────

test("intent keeps the shared min-length gate with aria-invalid wiring", () => {
  // Submit stays disabled and the guard bails below RESEARCH_INTENT_MIN_LENGTH…
  assert.match(composer, /disabled=\{trimmedIntent\.length < RESEARCH_INTENT_MIN_LENGTH\}/);
  assert.match(composer, /trimmed\.length < RESEARCH_INTENT_MIN_LENGTH \|\| submitting/);
  // …and too-short input explains itself accessibly.
  assert.match(composer, /aria-invalid=\{Boolean\(error\) \|\| intentTooShort\}/);
  assert.match(composer, /id="research-intent-minimum"/);
  assert.match(composer, /"research-intent-minimum"\s*:\s*"research-plan-review"/);
  // Start failures stay visible as alerts; the daemon-offline note is honest.
  assert.match(composer, /role="alert"/);
  assert.match(composer, /The local daemon is offline\./);
  assert.match(composer, /daemonRunning/);
  assert.match(promptTab, /daemonRunning=\{context\.runtimeState\.daemonRunning\}/);
});

// ── Mode cards: inference-backed auto pick, manual override, reset ───────────

test("mode cards are backed by the real routing inference", () => {
  assert.match(composer, /inferResearchMissionMode\(intent\)/);
  assert.match(composer, /mode === "auto" \? inferred\.mode : mode/);
  // Deep loop is the display name for autoresearch — no fifth fake mode.
  assert.match(composer, /autoresearch: "Deep loop"/);
  assert.match(composer, /RESEARCH_MISSION_MODES\.map/);
  // Auto pick highlights, manual click overrides, reset returns to auto.
  assert.match(composer, /\{manual \? "✓ selected" : "auto pick"\}/);
  assert.match(composer, /data-selected=\{selected\}/);
  assert.match(composer, /aria-pressed=\{manual && selected\}/);
  assert.match(composer, /Reset to Auto/);
  assert.match(composer, /setMode\("auto"\)/);
  // Cross-tab navigation preselects a mode as a manual choice.
  assert.match(composer, /if \(initialMode\) setMode\(initialMode\)/);
  assert.match(promptTab, /initialMode\?: ResearchMissionMode/);
  assert.match(promptTab, /initialMode=\{initialMode\}/);
  assert.match(css, /\.research-mode-card\[data-selected="true"\]/);
});

test("mode card meta derives from the real default plans, not design copy", () => {
  // modeCardMeta reads defaultResearchPlan — numbers can never drift from the
  // plans the server actually applies.
  assert.match(composer, /const bounds = defaultResearchPlan\(mode\)\.bounds/);
  // The design's hand-written paper meta ("2 passes · 90 min · 20 sources")
  // contradicts the real plan (1 pass · 90 min · 8 sources) — it must not ship.
  assert.doesNotMatch(composer, /2 passes · 90 min · 20 sources/);
  const paper = defaultResearchPlan("paper").bounds;
  assert.equal(paper.maxIterations, 1);
  assert.equal(paper.sourceTarget, 8);
});

test("routing inference behaves as the cards advertise", () => {
  assert.equal(inferResearchMissionMode("write a literature review of RAG evals").mode, "paper");
  assert.equal(inferResearchMissionMode("map the landscape of agent frameworks").mode, "sweep");
  assert.equal(inferResearchMissionMode("keep researching until the loop converges").mode, "autoresearch");
  assert.equal(inferResearchMissionMode("what is the best option?").mode, "brief");
});

// ── Slash-command palette: trigger, keyboard contract, real actions only ─────

test("slash palette opens on a trailing token and completes via keyboard", () => {
  // Trigger: a trailing "/word" token (design logic 785–811).
  assert.ok(composer.includes(String.raw`text.match(/(^|\s)\/([a-z]*)$/i)`));
  // Tab/Enter complete (preventDefault so Enter never newlines mid-complete)…
  assert.match(composer, /event\.key === "Tab" \|\| event\.key === "Enter"/);
  assert.match(composer, /event\.preventDefault\(\);\s*runCommand\(menuItems\[menuIndex\]\)/);
  // …↑↓ wrap around…
  assert.match(composer, /\(menuIndex \+ 1\) % menuItems\.length/);
  assert.match(composer, /\(menuIndex - 1 \+ menuItems\.length\) % menuItems\.length/);
  // …and Esc dismisses until the draft changes again.
  assert.match(composer, /event\.key === "Escape"/);
  assert.match(composer, /setMenuDismissed\(true\)/);
  assert.match(composer, /setMenuDismissed\(false\)/);
});

test("slash palette is an accessible listbox tied to the textarea", () => {
  assert.match(composer, /aria-haspopup="listbox"/);
  assert.match(composer, /aria-expanded=\{menuOpen\}/);
  assert.match(composer, /aria-controls="research-cmd-menu"/);
  assert.match(composer, /id="research-cmd-menu" role="listbox"/);
  assert.match(composer, /role="option"/);
  assert.match(composer, /aria-selected=\{index === menuIndex\}/);
  assert.match(composer, /aria-activedescendant=\{menuOpen \? `research-cmd-\$\{menuItems\[menuIndex\]\.cmd\.slice\(1\)\}` : undefined\}/);
  assert.match(css, /\.research-cmd-menu__item\[aria-selected="true"\]/);
});

test("commands run real actions and never leave the token in the intent", () => {
  // Completion strips the slash token instead of inserting command text.
  assert.match(composer, /stripSlashToken\(intent\)/);
  // Mode commands select a mode; /improve improves; /suggest rotates real
  // chips; /save jumps to Resources.
  for (const cmd of ['"/brief"', '"/sweep"', '"/paper"', '"/deep"', '"/improve"', '"/suggest"', '"/save"']) {
    assert.ok(composer.includes(cmd), `${cmd} must be offered`);
  }
  assert.match(composer, /run: "save"/);
  assert.match(composer, /onOpenResources\?\.\(\)/);
  assert.match(promptTab, /onOpenResources=\{\(\) => onNavigate\("resources"\)\}/);
  // The design's /task, /find and /chat have no real destination from the
  // intake (no board-create wiring, no runs rail here, no session yet) — they
  // must not ship as dead commands.
  assert.doesNotMatch(composer, /"\/task"|"\/find"|"\/chat"/);
});

// ── ✦ Improve: real enhance route, busy state, honest failure ────────────────

test("Improve POSTs the draft to /api/prompt/enhance in research mode", () => {
  assert.match(composer, /fetch\("\/api\/prompt\/enhance"/);
  assert.match(composer, /method: "POST"/);
  assert.match(composer, /JSON\.stringify\(\{ draft, mode: "research" \}\)/);
  // Busy label per the design; the note region is a status live region.
  assert.match(composer, /"✦ Improving…" : "✦ Improve"/);
  assert.match(composer, /className="research-improve-note" role="status"/);
  // Too-short drafts disable the button (opacity via CSS, real disabled attr).
  assert.match(composer, /disabled=\{!improveReady \|\| improving\}/);
  assert.match(css, /\.research-improve:disabled \{[^}]*opacity/);
});

test("Improve failure and races stay honest — the draft is never clobbered", () => {
  // Route failure surfaces a visible message and leaves the draft alone.
  assert.ok(composer.includes("Improve failed (HTTP ${res.status}) — the draft is unchanged."));
  assert.ok(composer.includes("Improve is unreachable right now — the draft is unchanged."));
  // The settle rule: only apply the rewrite to the draft it was asked for.
  assert.match(composer, /settleEnhance\(draft, intentRef\.current\) === "apply"/);
  assert.match(composer, /kept your edits/);
});

test("the enhance route contract matches what Improve sends", () => {
  const ok = buildPromptEnhancement({ draft: "compare vector databases", mode: "research" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.label, "Research");
    assert.match(ok.enhanced, /Research and compare/);
  }
  // An empty draft is the 400 path the failure handling covers.
  const bad = buildPromptEnhancement({ draft: "", mode: "research" });
  assert.equal(bad.ok, false);
});

// ── Quick saves: attach state → candidate sources on the new mission ─────────

test("quick saves attach as candidate sources via the ledger's mechanism", () => {
  // Rows are real toggles; chips render with a remove affordance.
  assert.match(promptTab, /aria-pressed=\{isAttached\}/);
  assert.match(promptTab, /useResearchLinks\(\)/);
  assert.match(composer, /Related context \(\{attachedLinks\.length\}\):/);
  assert.match(composer, /onRemoveAttached\?\.\(link\.id\)/);
  // After start, each attached link becomes an attach-source action against
  // the NEW mission id — the same action the evidence ledger uses.
  assert.match(promptTab, /research\.act\(result\.mission\.id, \{\s*action: "attach-source"/);
  assert.match(promptTab, /sourceType: "web"/);
  assert.match(promptTab, /status: "candidate"/);
  // Attach happens before the desk hand-off, and the hand-off follows the
  // mission (the pre-redesign contract).
  const attachIndex = promptTab.indexOf('action: "attach-source"');
  const navigateIndex = promptTab.indexOf('onNavigate("desk", { missionId: result.mission.id })');
  assert.ok(attachIndex !== -1 && navigateIndex !== -1 && attachIndex < navigateIndex);
  // The panel links out to the full Resources tab.
  assert.match(promptTab, /All in Resources →/);
});

test("a failed attach never abandons a started mission", () => {
  // Once start() succeeds the spend is committed — the desk hand-off ALWAYS
  // happens. Attach failures are collected without aborting the loop and
  // surface as a partial-failure announcement, never as a generic "could not
  // start" that invites a duplicate-spend retry.
  assert.match(promptTab, /let failedAttaches = 0/);
  assert.match(promptTab, /\.catch\(\(\) => \(\{ ok: false as const \}\)\)/);
  assert.match(promptTab, /if \(!attach\.ok\) failedAttaches \+= 1/);
  assert.match(promptTab, /useAnnouncer/);
  assert.match(
    promptTab,
    /Mission started — \$\{failedAttaches\} link\$\{failedAttaches === 1 \? "" : "s"\} failed to attach\./,
  );
  // The announcement happens before the hand-off, and the hand-off is inside
  // the success branch but outside any per-link condition.
  const announceIndex = promptTab.indexOf("failed to attach.");
  const navigateIndex = promptTab.indexOf('onNavigate("desk", { missionId: result.mission.id })');
  assert.ok(announceIndex !== -1 && navigateIndex !== -1 && announceIndex < navigateIndex);
});

// ── Bounds editor: explicit submit only, dirty latch, clearable inputs ───────

test("Enter in a bounds field never starts a mission — it commits like blur", () => {
  // The number inputs live inside the mission form, so an unhandled Enter
  // would implicit-submit and start a PAID mission. Enter is intercepted and
  // commits the draft instead; the Start button and the textarea's palette
  // shortcuts keep their existing behavior.
  assert.match(composer, /const boundKeyDown = \(key: BoundKey\) =>/);
  assert.match(composer, /if \(event\.key !== "Enter"\) return;\s*event\.preventDefault\(\);\s*commitBound\(key\)/);
  for (const key of ["wallClockMinutes", "maxIterations", "sourceTarget", "checkpointEvery"]) {
    assert.match(composer, new RegExp(`onKeyDown=\\{boundKeyDown\\("${key}"\\)\\}`));
  }
});

test("hand-edited bounds survive auto-routing; explicit mode picks reset them", () => {
  // Auto mode re-derives the plan on every keystroke — editing a bound latches
  // it dirty so the plan effect stops overwriting the user's numbers…
  assert.match(composer, /boundsDirtyRef\.current = true/);
  assert.match(composer, /if \(boundsDirtyRef\.current\) return;\s*setBounds\(\{ \.\.\.plan\.bounds \}\);\s*setBoundDrafts\(\{\}\)/);
  // …while every explicit mode pick funnels through setMode, which clears the
  // latch so a deliberate switch still resets to the new plan's bounds.
  assert.match(composer, /const setMode = useCallback\(\(next: "auto" \| ResearchMissionMode\) => \{\s*boundsDirtyRef\.current = false;\s*setModeState\(next\);/);
});

test("bound inputs are clearable — raw drafts parse on blur/Enter/submit", () => {
  // Inputs render the raw draft while editing (parsing ""→1 on every
  // keystroke turned "clear, then type 5" into "15")…
  assert.match(composer, /boundDrafts\[key\] \?\? String\(bounds\[key\]\)/);
  for (const key of ["wallClockMinutes", "maxIterations", "sourceTarget", "checkpointEvery"]) {
    assert.match(composer, new RegExp(`onBlur=\\{\\(\\) => commitBound\\("${key}"\\)\\}`));
  }
  // …commits reuse the pre-existing clamp logic and server limits…
  assert.match(composer, /boundNumber\(raw, 1, RESEARCH_BOUND_LIMITS\[key\]\)/);
  assert.match(composer, /boundNumber\(raw, 1, RESEARCH_BOUND_LIMITS\.maxIterations\)/);
  assert.match(composer, /checkpointEvery: Math\.min\(current\.checkpointEvery, maxIterations\)/);
  assert.match(composer, /checkpointEvery: boundNumber\(raw, 1, current\.maxIterations\)/);
  // …and Start submits the resolved drafts, never a stale committed value.
  assert.match(composer, /const submittedBounds = resolveBounds\(\)/);
  assert.match(composer, /bounds: submittedBounds,/);
});

// ── Suggested angles: real data only ─────────────────────────────────────────

test("angle chips derive from real mission/link titles — never canned topics", () => {
  // Seeds are recent mission titles + saved-link titles…
  assert.match(promptTab, /research\.missions\s*\n?\s*\.filter\(\(mission\) => mission\.status !== "archived"\)/);
  assert.match(promptTab, /\.map\(\(mission\) => mission\.title\)/);
  assert.match(promptTab, /links\.links\.slice\(0, ANGLE_SEEDS_PER_POOL\)\.map\(\(link\) => link\.title\)/);
  // …empty seeds render nothing…
  assert.match(composer, /if \(unique\.length === 0\) return \[\];/);
  assert.match(composer, /\{angleChips\.length === 0 \? null : \(/);
  // …expansion uses the design's phrasing pattern on a REAL title…
  assert.match(composer, /Compare the leading approaches, quantify the tradeoffs with numbers from primary sources/);
  // …and none of the design's demo topics ship as fallbacks.
  for (const file of [composer, promptTab]) {
    assert.doesNotMatch(file, /Compare agent eval frameworks/);
    assert.doesNotMatch(file, /RAG vs long-context/);
    assert.doesNotMatch(file, /Agent memory: episodic/);
  }
  // The Suggest affordances only exist when seeds exist.
  assert.match(composer, /\{angleSeeds\.length > 0 \? \(\s*<button type="button" className="research-suggest"/);
});

// ── Layout: tokens, focus rings, container-responsive, reduced motion ────────

test("prompt tab styles are token-driven and container-responsive", () => {
  assert.match(css, /\.research-intake \{/);
  assert.match(css, /\.research-intake__card \{[^}]*var\(--research-accent\)/);
  assert.match(css, /\.research-intake button:focus-visible/);
  assert.match(css, /@container research-desk \(max-width: 900px\) \{\s*\.research-intake__modes-grid/);
  assert.match(css, /@container research-desk \(max-width: 560px\) \{\s*\.research-intake/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.research-intake \*/);
  // No Nocturne hexes in the prompt sheet's classes: the accent-glow card and
  // mode cards must ride the scoped research tokens.
  assert.match(css, /\.research-mode-card\[data-selected="true"\] \{[^}]*var\(--research-accent\)/);
});
