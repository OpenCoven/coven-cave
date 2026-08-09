import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBeadsDeliveryOverview,
  classifyPlatform,
  classifyStale,
  type BeadDeliveryRow,
  type BeadStaleState,
} from "./beads-delivery.ts";

const NOW_MS = Date.parse("2026-08-09T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function row(
  id: string,
  status: BeadDeliveryRow["status"],
  updatedAt: string,
  labels: readonly string[],
): BeadDeliveryRow {
  return {
    id,
    title: id,
    status,
    priority: 2,
    updated_at: updatedAt,
    labels: [...labels],
  };
}

const rows = {
  open: row("open-ios", "open", new Date(NOW_MS - 2 * HOUR_MS).toISOString(), ["surface:ios", "ops"]),
  progress23h: row(
    "progress-23h-desktop",
    "in_progress",
    new Date(NOW_MS - 23 * HOUR_MS).toISOString(),
    ["surface:desktop", "familiar:kitty"],
  ),
  progress25h: row(
    "progress-25h-shared",
    "in_progress",
    new Date(NOW_MS - 25 * HOUR_MS).toISOString(),
    ["surface:shared"],
  ),
  progress8d: row(
    "progress-8d-missing",
    "in_progress",
    new Date(NOW_MS - 8 * DAY_MS).toISOString(),
    [],
  ),
  blocked: row(
    "blocked-conflicting",
    "blocked",
    new Date(NOW_MS - 4 * HOUR_MS).toISOString(),
    ["surface:ios", "surface:desktop", "surface:desktop"],
  ),
  deferred: row(
    "deferred-shared",
    "deferred",
    new Date(NOW_MS - 5 * HOUR_MS).toISOString(),
    ["surface:shared", "waiting"],
  ),
  closed: row(
    "closed-row",
    "closed",
    new Date(NOW_MS - 9 * DAY_MS).toISOString(),
    ["surface:desktop"],
  ),
} satisfies Record<string, BeadDeliveryRow>;

describe("beads delivery classification", () => {
  it("classifies platform ownership labels", () => {
    assert.equal(classifyPlatform(rows.open.labels), "ios");
    assert.equal(classifyPlatform(rows.progress23h.labels), "desktop");
    assert.equal(classifyPlatform(rows.progress25h.labels), "shared");
    assert.equal(classifyPlatform(rows.progress8d.labels), "missing");
    assert.equal(classifyPlatform(rows.blocked.labels), "conflicting");
  });

  it("classifies stale in_progress rows only", () => {
    assert.equal(classifyStale(rows.open, NOW_MS), "none");
    assert.equal(classifyStale(rows.progress23h, NOW_MS), "none");
    assert.equal(classifyStale(rows.progress25h, NOW_MS), "older_than_24h");
    assert.equal(classifyStale(rows.progress8d, NOW_MS), "older_than_7d");
    assert.equal(classifyStale(rows.blocked, NOW_MS), "none");
    assert.equal(classifyStale(rows.closed, NOW_MS), "none");
  });
});

describe("buildBeadsDeliveryOverview", () => {
  it("aggregates unfinished rows and bounds stale DTOs", () => {
    const overview = buildBeadsDeliveryOverview(
      Object.values(rows),
      [rows.open],
      NOW_MS,
    );

    assert.deepEqual(overview.totals, {
      remaining: 6,
      ready: 1,
      open: 1,
      inProgress: 3,
      blocked: 1,
      deferred: 1,
    });

    assert.deepEqual(overview.surfaceHygiene, {
      ios: 1,
      desktop: 1,
      shared: 2,
      missing: 1,
      conflicting: 1,
    });

    assert.deepEqual(overview.stale, {
      olderThan24h: 2,
      olderThan7d: 1,
      oldest: [
        {
          id: "progress-8d-missing",
          title: "progress-8d-missing",
          status: "in_progress",
          priority: 2,
          updatedAt: rows.progress8d.updated_at,
          stale: "older_than_7d" as BeadStaleState,
        },
        {
          id: "progress-25h-shared",
          title: "progress-25h-shared",
          status: "in_progress",
          priority: 2,
          updatedAt: rows.progress25h.updated_at,
          stale: "older_than_24h" as BeadStaleState,
        },
      ],
    });

    assert.equal(overview.generatedAt, new Date(NOW_MS).toISOString());
    assert.deepEqual(Object.keys(overview.stale.oldest[0] ?? {}).sort(), [
      "id",
      "priority",
      "stale",
      "status",
      "title",
      "updatedAt",
    ]);
  });

  it("limits the stale list to twenty items", () => {
    const limitedRows = Array.from({ length: 21 }, (_, index) =>
      row(
        `stale-${index + 1}`,
        "in_progress",
        new Date(NOW_MS - (index + 2) * DAY_MS).toISOString(),
        [],
      ),
    );

    const overview = buildBeadsDeliveryOverview(limitedRows, [], NOW_MS);

    assert.equal(overview.stale.oldest.length, 20);
    assert.equal(overview.stale.oldest[0]?.id, "stale-21");
    assert.equal(overview.stale.oldest.at(-1)?.id, "stale-2");
  });
});
