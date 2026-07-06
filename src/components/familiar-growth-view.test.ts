// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const view = readFileSync(new URL("./familiar-growth-view.tsx", import.meta.url), "utf8");
const report = readFileSync(new URL("./familiar-growth-report.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Familiar growth view", () => {
  it("sorts the roster attention-first (stalled → quiet → steady → active)", () => {
    assert.match(view, /HEALTH_ORDER/);
    assert.match(view, /stalled: 0/);
    assert.match(view, /quiet: 1/);
    assert.match(view, /active: 3/);
  });

  it("summarizes roster health as triage chips in the hero", () => {
    assert.match(view, /growth-triage__chip/);
    assert.match(globals, /\.growth-triage__chip--stalled/);
    assert.match(globals, /\.growth-triage__chip--active/);
  });

  it("renders a 14-day pulse per roster row and in the report", () => {
    assert.match(view, /<PulseBars pulse=\{pulse\} size="sm"/);
    assert.match(report, /<PulseBars/);
    assert.match(report, /buildSessionPulse/);
  });

  it("shows week-over-week movement on the sessions tile", () => {
    assert.match(report, /pulseDelta/);
    assert.match(report, /<DeltaChip delta=\{weekDelta\.delta\}/);
    assert.match(report, /vs prior 7d/);
  });

  it("keeps the roster analytics link on a proper class (no ad-hoc utility strings)", () => {
    assert.match(view, /growth-familiar__analytics/);
    assert.doesNotMatch(view, /ml-\[54px\]/);
  });

  it("announces quiet refreshes to assistive tech", () => {
    assert.match(view, /useAnnouncer/);
    assert.match(view, /announce\("Growth data refreshed\."\)/);
  });

  it("marks the selected roster row for assistive tech", () => {
    assert.match(view, /aria-pressed=\{selectedItem\}/);
  });

  it("responds to pane width via container queries", () => {
    assert.match(globals, /container-name: growth/);
    assert.match(globals, /@container growth \(max-width: 920px\)/);
  });

  it("tints signal cards by severity with a left border (not color alone)", () => {
    assert.match(globals, /\.growth-signal--crit \{ border-left-color: var\(--color-danger\); \}/);
  });
});
