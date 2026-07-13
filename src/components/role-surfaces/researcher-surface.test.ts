import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(new URL("./researcher-surface.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./research-mission-composer.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./research-mission-list.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./research-mission-detail.tsx", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./research-evidence-ledger.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./use-research-missions.ts", import.meta.url), "utf8");
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
});

test("mission list and evidence trajectory expose semantic state", () => {
  assert.match(list, /aria-current=\{selected/);
  assert.match(detail, /aria-label="Research progress"/);
  assert.match(detail, /Open session/);
  assert.match(ledger, /Open in Grimoire/);
});

test("checkpoint lifecycle controls are explicit and server-backed", () => {
  assert.match(detail, /allowedResearchActions/);
  assert.match(detail, /Continue/);
  assert.match(detail, /Finish now/);
  assert.match(detail, /Refine direction/);
  assert.match(surface, /research\.act/);
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
  assert.match(detail, /Cost unavailable/);
  assert.match(detail, /hasReportedCost/);
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
