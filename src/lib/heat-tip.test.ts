// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { formatHeatDate, formatHeatTip } from "./heat-tip.ts";

describe("formatHeatDate", () => {
  it("formats an ISO day without timezone math", () => {
    assert.equal(formatHeatDate("2026-07-22"), "Jul 22, 2026");
    assert.equal(formatHeatDate("2025-12-31"), "Dec 31, 2025");
    assert.equal(formatHeatDate("2026-01-01"), "Jan 1, 2026");
  });
});

describe("formatHeatTip", () => {
  it("reads like GitHub's heatmap hover value", () => {
    assert.equal(formatHeatTip("2026-07-22", 3), "3 sessions on Jul 22, 2026");
    assert.equal(formatHeatTip("2026-07-22", 1), "1 session on Jul 22, 2026");
  });

  it("spells out empty days instead of showing a zero", () => {
    assert.equal(formatHeatTip("2026-07-22", 0), "No sessions on Jul 22, 2026");
  });
});

// ── Hover-tip hook wiring (source pins) ──────────────────────────────────────
const hook = readFileSync(new URL("../components/ui/heat-tip.tsx", import.meta.url), "utf8");

describe("useHeatTip wiring", () => {
  it("delegates hover per grid and reads the cell's data-tip", () => {
    assert.match(hook, /closest\?\.\("\[data-tip\]"\)/, "pointerover resolves the hovered cell by data-tip");
    assert.match(hook, /onPointerLeave: hide/, "leaving the grid hides the tip");
  });

  it("portals one styled tooltip to document.body so overflow ancestors cannot clip it", () => {
    assert.match(hook, /createPortal\(/);
    assert.match(hook, /document\.body/);
    assert.match(hook, /className="ui-tooltip"/, "reuses the ui-tooltip primitive");
  });

  it("dismisses on scroll/resize — fixed coordinates go stale", () => {
    assert.match(hook, /addEventListener\("scroll", hide, \{ capture: true, passive: true \}\)/);
    assert.match(hook, /addEventListener\("resize", hide\)/);
  });

  it("clamps into the viewport and flips below at the top edge", () => {
    assert.match(hook, /Math\.min\(Math\.max\(tipState\.x/, "horizontal clamp");
    assert.match(hook, /above >= EDGE_GAP \? above : tipState\.bottom \+/, "vertical flip");
  });
});

// ── Both "coven session activity" heatmaps carry the tip ─────────────────────
const bento = readFileSync(new URL("../components/dashboard/bento-dashboard.tsx", import.meta.url), "utf8");
const pfc = readFileSync(new URL("../components/profile-card.tsx", import.meta.url), "utf8");

describe("heatmap surfaces", () => {
  it("bento dashboard cells expose the hover value via data-tip (no sluggish native title)", () => {
    assert.match(bento, /useHeatTip\(\)/);
    assert.match(bento, /data-tip=\{c\.future \? undefined : formatHeatTip\(c\.date, c\.count\)\}/);
    assert.match(bento, /className="bd-heat-grid" \{\.\.\.heatTip\.gridProps\}/);
    assert.doesNotMatch(bento, /bd-heat-cell[\s\S]{0,200}?title=/, "heatmap cells no longer rely on the native title tooltip");
  });

  it("profile-card cells expose the hover value via data-tip", () => {
    assert.match(pfc, /useHeatTip\(\)/);
    assert.match(pfc, /data-tip=\{formatHeatTip\(cell\.key, cell\.count\)\}/);
    assert.match(pfc, /className="pfc-heatmap-grid" aria-hidden \{\.\.\.heatTip\.gridProps\}/);
    assert.doesNotMatch(pfc, /pfc-cell"[\s\S]{0,200}?title=/, "heatmap cells no longer rely on the native title tooltip");
  });
});
