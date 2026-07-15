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

  it("drops stale load settles — only the latest issued load writes state (cave-5p5m)", () => {
    // Mount, manual refresh, 60s poll, and on-focus refresh interleave; an
    // older slower response must not overwrite fresher data or raise a stale
    // error over it.
    assert.match(view, /const gen = \+\+generation\.current/);
    assert.match(view, /if \(generation\.current !== gen\) return;/);
    assert.match(view, /if \(generation\.current === gen\) \{\s*setLoading\(false\);/);
  });

  it("carries a truthful freshness stamp, set when data lands (cave-5p5m)", () => {
    assert.match(view, /setUpdatedAt\(new Date\(\)\.toISOString\(\)\)/, "stamped on load settle, not render");
    assert.match(view, /Updated <RelativeTime iso=\{updatedAt\} \/>/, "renders as a semantic relative time");
    assert.match(globals, /\.growth-hero__updated/, "the stamp has its own class");
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

  it("keeps the triage surface live with a silent pausable poll", () => {
    assert.match(view, /usePausablePoll\(\(\) => void load\(\{ quiet: true, silent: true \}\), 60_000\)/);
    assert.match(view, /if \(quiet && !silent\) announce\("Growth data refreshed\."\)/, "polls refresh without announcing; manual refresh still announces");
  });

  it("gives every non-healthy growth signal a next-step action link", () => {
    assert.match(report, /function signalAction/, "signal kinds map to the surface where the fix happens");
    assert.match(report, /case "session-gap":/);
    assert.match(report, /Resume latest session/, "activity gaps resume the newest thread when one exists");
    assert.match(report, /case "no-memory":/);
    assert.match(report, /case "low-accept-rate":/);
    assert.match(report, /analytics#fa-confidence/, "retro signals drill into the confidence impact");
    assert.match(report, /className="growth-signal__action focus-ring"/, "actions render as styled links");
    assert.match(globals, /\.growth-signal__action\s*\{/);
  });

  it("turns the 14d session count into a drill-through to the analytics sessions list", () => {
    assert.match(report, /analytics#fa-sessions/, "activity head links to the recent-sessions section");
    assert.match(report, /className="growth-section__link focus-ring"/);
  });
});
