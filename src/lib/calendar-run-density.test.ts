import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectedCronRun } from "./calendar-cron-projection.ts";
import {
  RUN_DENSITY_BANDS,
  RUN_DENSITY_MAX_LEVEL,
  clusterLabel,
  clusterRunsByMinute,
  runCountLabel,
  runCountOn,
  runDensityBands,
} from "./calendar-run-density.ts";

const DAY = new Date(2026, 7, 25); // 25 Aug 2026, local

/** Local-time run on DAY at `hour`. Local on purpose — the calendar is local. */
function at(hour: number, minute = 0, over: Partial<ProjectedCronRun> = {}): ProjectedCronRun {
  return {
    automationId: "a1",
    name: "Daily brief",
    atIso: new Date(2026, 7, 25, hour, minute).toISOString(),
    ...over,
  };
}

describe("runDensityBands", () => {
  it("always returns all six bands so the axis does not slide", () => {
    const bands = runDensityBands([], DAY);
    assert.equal(bands.length, RUN_DENSITY_BANDS);
    assert.deepEqual(
      bands.map((b) => b.startHour),
      [0, 4, 8, 12, 16, 20],
    );
    assert.ok(bands.every((b) => b.count === 0 && b.level === 0));
  });

  it("buckets a run into its four-hour window", () => {
    const bands = runDensityBands([at(9)], DAY);
    assert.equal(bands[2].startHour, 8);
    assert.equal(bands[2].count, 1);
    assert.equal(bands.reduce((n, b) => n + b.count, 0), 1, "counted exactly once");
  });

  it("puts a run exactly on a boundary in the later band, not both", () => {
    // 12:00 belongs to 12:00–16:00. A half-open interval is the only way the
    // total stays equal to the number of runs.
    const bands = runDensityBands([at(12)], DAY);
    assert.equal(bands[2].count, 0, "not in 08:00–12:00");
    assert.equal(bands[3].count, 1, "in 12:00–16:00");
  });

  it("keeps the last hour of the day inside the final band", () => {
    const bands = runDensityBands([at(23, 59)], DAY);
    assert.equal(bands[5].count, 1);
  });

  it("clamps level so one busy bucket cannot flatten the rest", () => {
    const many = Array.from({ length: 12 }, () => at(9));
    const bands = runDensityBands(many, DAY);
    assert.equal(bands[2].count, 12, "the true count is preserved");
    assert.equal(bands[2].level, RUN_DENSITY_MAX_LEVEL, "the drawn level is clamped");
  });

  it("ignores runs from other days and unparseable instants", () => {
    const other = { ...at(9), atIso: new Date(2026, 7, 26, 9).toISOString() };
    const bad = { ...at(9), atIso: "not-a-date" };
    const bands = runDensityBands([at(9), other, bad], DAY);
    assert.equal(bands.reduce((n, b) => n + b.count, 0), 1);
  });

  it("names its own window, and says 'run' for one", () => {
    const bands = runDensityBands([at(9)], DAY);
    assert.equal(bands[2].label, "1 run 08:00–12:00");
    assert.equal(bands[0].label, "0 runs 00:00–04:00");
  });
});

describe("runCountOn", () => {
  it("counts only the given day", () => {
    const runs = [at(1), at(9), { ...at(9), atIso: new Date(2026, 7, 24, 9).toISOString() }];
    assert.equal(runCountOn(runs, DAY), 2);
  });

  it("agrees with the bands, so Week and Month cannot disagree about a day", () => {
    const runs = [at(0), at(5), at(9), at(9), at(23)];
    const total = runDensityBands(runs, DAY).reduce((n, b) => n + b.count, 0);
    assert.equal(runCountOn(runs, DAY), total);
  });
});

describe("runCountLabel", () => {
  it("returns null at zero so no empty affordance renders", () => {
    assert.equal(runCountLabel(0), null);
    assert.equal(runCountLabel(-1), null);
  });

  it("singularises one", () => {
    assert.equal(runCountLabel(1), "1 run");
    assert.equal(runCountLabel(3), "3 runs");
  });

  it("carries the frame's two different nouns", () => {
    // Week says "ritual runs", Month says "runs" — both come from the frame.
    assert.equal(runCountLabel(2, "ritual runs"), "2 ritual runs");
    assert.equal(runCountLabel(1, "ritual runs"), "1 ritual run");
  });
});

describe("clusterRunsByMinute", () => {
  it("collapses runs sharing a minute into one marker", () => {
    // Regression: measured in the browser, "Daily bug scan" and "Follow-up
    // monitor" rendered at the same offset and their labels sat on top of each
    // other. One marker per instant is the fix.
    const clusters = clusterRunsByMinute(
      [at(9, 0, { name: "Daily bug scan" }), at(9, 0, { name: "Follow-up monitor" })],
      DAY,
    );
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].minutes, 9 * 60);
    assert.equal(clusters[0].runs.length, 2);
  });

  it("keeps different minutes apart, in chronological order", () => {
    const clusters = clusterRunsByMinute([at(22), at(9, 30), at(9)], DAY);
    assert.deepEqual(clusters.map((c) => c.minutes), [9 * 60, 9 * 60 + 30, 22 * 60]);
  });

  it("does not merge across the hour boundary", () => {
    const clusters = clusterRunsByMinute([at(9, 59), at(10, 0)], DAY);
    assert.equal(clusters.length, 2);
  });

  it("ignores other days and unparseable instants", () => {
    const other = { ...at(9), atIso: new Date(2026, 7, 26, 9).toISOString() };
    const bad = { ...at(9), atIso: "nonsense" };
    assert.equal(clusterRunsByMinute([at(9), other, bad], DAY).length, 1);
  });

  it("loses no run: clusters account for exactly the day's runs", () => {
    const runs = [at(9), at(9), at(9, 30), at(22)];
    const clustered = clusterRunsByMinute(runs, DAY).reduce((n, c) => n + c.runs.length, 0);
    assert.equal(clustered, runCountOn(runs, DAY));
  });
});

describe("clusterLabel", () => {
  it("names a lone run plainly", () => {
    assert.equal(clusterLabel(clusterRunsByMinute([at(9, 0, { name: "Daily brief" })], DAY)[0]), "Daily brief");
  });

  it("counts the extras rather than overprinting them", () => {
    const c = clusterRunsByMinute(
      [at(9, 0, { name: "Daily brief" }), at(9, 0, { name: "B" }), at(9, 0, { name: "C" })],
      DAY,
    )[0];
    assert.equal(clusterLabel(c), "Daily brief +2");
  });
});
