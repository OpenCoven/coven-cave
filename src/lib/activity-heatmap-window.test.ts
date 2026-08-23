import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activityHeatmapWindowDays } from "./activity-heatmap-window.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-14T18:00:00.000Z");
const daysBack = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

describe("activityHeatmapWindowDays", () => {
  it("uses 90 days for new or empty activity histories", () => {
    assert.equal(activityHeatmapWindowDays([], NOW), 90);
    assert.equal(activityHeatmapWindowDays([daysBack(89)], NOW), 90);
  });

  it("uses 180 days once the first activity is at least 90 days old", () => {
    assert.equal(activityHeatmapWindowDays([daysBack(90)], NOW), 180);
    assert.equal(activityHeatmapWindowDays([daysBack(179), daysBack(2)], NOW), 180);
  });

  it("uses 365 days once the first activity is at least 180 days old", () => {
    assert.equal(activityHeatmapWindowDays([daysBack(180)], NOW), 365);
    assert.equal(activityHeatmapWindowDays([daysBack(500), daysBack(1)], NOW), 365);
  });

  it("ignores invalid and future timestamps when determining age", () => {
    assert.equal(
      activityHeatmapWindowDays(["not-a-date", new Date(NOW + DAY_MS).toISOString(), daysBack(45)], NOW),
      90,
    );
  });
});
