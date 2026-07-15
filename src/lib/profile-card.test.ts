import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProfileCardModel,
  buildProfileHeatmap,
  busiestDay,
  compactCount,
  computeStreaks,
  cumulativeSeries,
  humanHandle,
  isHumanSession,
  rankCollaborators,
  subjectSessions,
  weeklySeries,
} from "@/lib/profile-card";
import type { SessionRow } from "@/lib/types";

const DAY_MS = 24 * 60 * 60_000;
/** Fixed clock: 2026-07-14T15:00Z — mid-window determinism for every test. */
const NOW = Date.UTC(2026, 6, 14, 15, 0, 0);

function iso(daysBack: number, hour = 12): string {
  return new Date(Date.UTC(2026, 6, 14, hour) - daysBack * DAY_MS).toISOString();
}

let seq = 0;
function session(over: Partial<SessionRow> = {}): SessionRow {
  seq += 1;
  return {
    id: `s-${seq}`,
    project_root: "/repo/a",
    harness: "codex",
    title: "test",
    status: "exited",
    exit_code: 0,
    archived_at: null,
    created_at: over.updated_at ?? iso(0),
    updated_at: iso(0),
    ...over,
  };
}

describe("isHumanSession attribution rule", () => {
  it("attributes explicit human initiators to the operator", () => {
    assert.equal(isHumanSession(session({ initiator: { kind: "human", label: "Val" } })), true);
  });

  it("never attributes generated or machine-initiated rows", () => {
    assert.equal(isHumanSession(session({ generated: true })), false);
    assert.equal(
      isHumanSession(session({ generated: true, initiator: { kind: "human", label: "Val" } })),
      false,
    );
    assert.equal(isHumanSession(session({ initiator: { kind: "familiar", label: "momo" } })), false);
    assert.equal(isHumanSession(session({ initiator: { kind: "system", label: "cron" } })), false);
  });

  it("defaults unattributed non-generated rows to the operator", () => {
    assert.equal(isHumanSession(session()), true);
    assert.equal(isHumanSession(session({ initiator: { kind: "unknown", label: "?" } })), true);
  });
});

describe("subjectSessions", () => {
  it("filters by familiar id for familiar cards", () => {
    const rows = [session({ familiarId: "momo" }), session({ familiarId: "zuko" }), session()];
    const subject = subjectSessions(rows, "familiar", "momo");
    assert.equal(subject.length, 1);
    assert.equal(subject[0].familiarId, "momo");
  });

  it("uses the attribution rule for the human card", () => {
    const rows = [
      session({ initiator: { kind: "human", label: "Val" } }),
      session({ initiator: { kind: "familiar", label: "momo" }, familiarId: "momo" }),
      session({ generated: true }),
    ];
    assert.equal(subjectSessions(rows, "human").length, 1);
  });
});

describe("buildProfileHeatmap", () => {
  it("spans a trailing 365-day window ending today, in full Sun→Sat columns", () => {
    const heatmap = buildProfileHeatmap([], NOW);
    assert.equal(heatmap.windowDays, 365);
    for (const week of heatmap.weeks) assert.equal(week.length, 7);
    const cells = heatmap.weeks.flat().filter((cell) => cell !== null);
    assert.equal(cells.length, 365);
    assert.equal(cells[cells.length - 1]?.key, "2026-07-14");
    assert.equal(cells[0]?.key, "2025-07-15");
    // 2026-07-14 is a Tuesday — the final column pads Wed..Sat with nulls.
    const lastWeek = heatmap.weeks[heatmap.weeks.length - 1];
    assert.equal(lastWeek.filter((cell) => cell === null).length, 4);
  });

  it("counts sessions per UTC day and ignores rows outside the window", () => {
    const rows = [
      session({ updated_at: iso(0) }),
      session({ updated_at: iso(0, 23) }),
      session({ updated_at: iso(2) }),
      session({ updated_at: iso(400) }), // outside — ignored
    ];
    const heatmap = buildProfileHeatmap(rows, NOW);
    assert.equal(heatmap.total, 3);
    assert.equal(heatmap.max, 2);
    assert.equal(heatmap.activeDays, 2);
    const today = heatmap.weeks.flat().find((cell) => cell?.key === "2026-07-14");
    assert.equal(today?.count, 2);
  });

  it("buckets levels against the window max (1..4, 0 stays 0)", () => {
    const rows: SessionRow[] = [];
    const addDay = (daysBack: number, count: number) => {
      for (let i = 0; i < count; i += 1) rows.push(session({ updated_at: iso(daysBack) }));
    };
    addDay(1, 8); // max
    addDay(2, 1); // ceil(1/8*4)=1
    addDay(3, 3); // ceil(3/8*4)=2
    addDay(4, 6); // ceil(6/8*4)=3
    const heatmap = buildProfileHeatmap(rows, NOW);
    const level = (key: string) =>
      heatmap.weeks.flat().find((cell) => cell?.key === key)?.level;
    assert.equal(level("2026-07-13"), 4);
    assert.equal(level("2026-07-12"), 1);
    assert.equal(level("2026-07-11"), 2);
    assert.equal(level("2026-07-10"), 3);
    assert.equal(level("2026-07-14"), 0);
  });

  it("labels each month once with no cramped leading label", () => {
    const heatmap = buildProfileHeatmap([], NOW);
    assert.ok(heatmap.monthLabels.length >= 12 && heatmap.monthLabels.length <= 13);
    for (const label of heatmap.monthLabels) {
      assert.match(label.label, /^[A-Z]{3}$/);
      assert.ok(label.index >= 0 && label.index < heatmap.weeks.length);
    }
    if (heatmap.monthLabels.length > 1) {
      assert.ok(heatmap.monthLabels[1].index - heatmap.monthLabels[0].index >= 3);
    }
  });
});

describe("streaks + busiest day + series", () => {
  it("computes the current streak ending today", () => {
    const rows = [0, 1, 2].map((d) => session({ updated_at: iso(d) }));
    const streaks = computeStreaks(buildProfileHeatmap(rows, NOW));
    assert.equal(streaks.current, 3);
    assert.equal(streaks.longest, 3);
  });

  it("lets a quiet today defer to yesterday instead of zeroing the streak", () => {
    const rows = [1, 2].map((d) => session({ updated_at: iso(d) }));
    assert.equal(computeStreaks(buildProfileHeatmap(rows, NOW)).current, 2);
  });

  it("breaks the current streak on a full quiet day and keeps the longest run", () => {
    const rows = [0, 3, 4, 5, 6].map((d) => session({ updated_at: iso(d) }));
    const streaks = computeStreaks(buildProfileHeatmap(rows, NOW));
    assert.equal(streaks.current, 1);
    assert.equal(streaks.longest, 4);
  });

  it("picks the highest-count day, most recent on ties", () => {
    const rows = [
      session({ updated_at: iso(5) }),
      session({ updated_at: iso(5) }),
      session({ updated_at: iso(1) }),
      session({ updated_at: iso(1) }),
    ];
    const best = busiestDay(buildProfileHeatmap(rows, NOW));
    assert.deepEqual(best, { key: "2026-07-13", count: 2 });
    assert.equal(busiestDay(buildProfileHeatmap([], NOW)), null);
  });

  it("sums weekly columns and accumulates the running total", () => {
    const rows = [0, 1, 8].map((d) => session({ updated_at: iso(d) }));
    const heatmap = buildProfileHeatmap(rows, NOW);
    const weekly = weeklySeries(heatmap);
    assert.equal(weekly.length, heatmap.weeks.length);
    assert.equal(weekly.reduce((sum, point) => sum + point.value, 0), 3);
    const cumulative = cumulativeSeries(weekly);
    assert.equal(cumulative[cumulative.length - 1].value, 3);
    for (let i = 1; i < cumulative.length; i += 1) {
      assert.ok(cumulative[i].value >= cumulative[i - 1].value);
    }
  });
});

describe("rankCollaborators", () => {
  it("ranks familiars by session count for the human card, skipping unknown ids", () => {
    const rows = [
      session({ familiarId: "momo" }),
      session({ familiarId: "momo" }),
      session({ familiarId: "zuko" }),
      session({ familiarId: "ghost" }), // not on the roster
    ];
    const ranked = rankCollaborators({
      kind: "human",
      sessions: rows,
      familiarIds: ["momo", "zuko"],
    });
    assert.deepEqual(ranked, [
      { familiarId: "momo", count: 2 },
      { familiarId: "zuko", count: 1 },
    ]);
  });

  it("ranks a familiar's collaborators by shared project roots, excluding itself", () => {
    const rows = [
      session({ familiarId: "momo", project_root: "/repo/a" }),
      session({ familiarId: "momo", project_root: "/repo/a" }),
      session({ familiarId: "zuko", project_root: "/repo/a" }),
      session({ familiarId: "zuko", project_root: "/repo/b" }), // not shared
      session({ familiarId: "iroh", project_root: "/repo/c" }), // not shared
    ];
    const ranked = rankCollaborators({
      kind: "familiar",
      familiarId: "momo",
      sessions: rows,
      familiarIds: ["momo", "zuko", "iroh"],
    });
    assert.deepEqual(ranked, [{ familiarId: "zuko", count: 1 }]);
  });

  it("caps the rail at 12 collaborators", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `f${i}`);
    const rows = ids.map((id) => session({ familiarId: id }));
    const ranked = rankCollaborators({ kind: "human", sessions: rows, familiarIds: ids });
    assert.equal(ranked.length, 12);
  });
});

describe("buildProfileCardModel", () => {
  it("builds familiar stat tiles: total, 30d, memories, active now", () => {
    const rows = [
      session({ familiarId: "momo", updated_at: new Date(NOW - 60_000).toISOString() }), // live
      session({ familiarId: "momo", updated_at: iso(5) }),
      session({ familiarId: "momo", updated_at: iso(80) }), // beyond 30d
      session({ familiarId: "zuko", updated_at: iso(1) }),
    ];
    const model = buildProfileCardModel({
      kind: "familiar",
      familiarId: "momo",
      sessions: rows,
      familiarIds: ["momo", "zuko"],
      memoryCount: 7,
      now: NOW,
    });
    assert.equal(model.sessionsTotal, 3);
    assert.deepEqual(
      model.statTiles.map((tile) => [tile.label, tile.value]),
      [
        ["total sessions", "3"],
        ["sessions (30d)", "2"],
        ["memories", "7"],
        ["active now", "1"],
      ],
    );
    // 3 of 4 coven sessions → 75%.
    assert.equal(model.sessionsPanel.sharePct, 75);
  });

  it("builds human stat tiles: total, 30d, familiars, coven-wide projects", () => {
    const rows = [
      session({ updated_at: iso(1), project_root: "/repo/a" }),
      session({ updated_at: iso(2), project_root: "/repo/b" }),
      session({ updated_at: iso(3), project_root: "/repo/b" }),
      session({ generated: true, updated_at: iso(1) }), // machine — excluded
      // Familiar-run session in a third project: excluded from the operator's
      // session count, but its project still counts — the operator runs the coven.
      session({
        initiator: { kind: "familiar", label: "momo" },
        familiarId: "momo",
        updated_at: iso(2),
        project_root: "/repo/c",
      }),
    ];
    const model = buildProfileCardModel({
      kind: "human",
      sessions: rows,
      familiarIds: ["momo", "zuko"],
      familiarCount: 2,
      now: NOW,
    });
    assert.equal(model.sessionsTotal, 3);
    assert.deepEqual(
      model.statTiles.map((tile) => [tile.label, tile.value]),
      [
        ["total sessions", "3"],
        ["sessions (30d)", "3"],
        ["familiars", "2"],
        ["projects", "3"],
      ],
    );
  });

  it("degrades to a zeroed card when no sessions exist", () => {
    const model = buildProfileCardModel({
      kind: "familiar",
      familiarId: "momo",
      sessions: [],
      familiarIds: [],
      now: NOW,
    });
    assert.equal(model.sessionsTotal, 0);
    assert.equal(model.sessionsPanel.busiestDay, null);
    assert.equal(model.sessionsPanel.sharePct, 0);
    assert.equal(model.streakPanel.current, 0);
    assert.equal(model.heatmap.total, 0);
    assert.deepEqual(model.collaborators, []);
  });
});

describe("formatting helpers", () => {
  it("slugs the human handle and falls back to operator", () => {
    assert.equal(humanHandle("Val Alexander"), "val-alexander");
    assert.equal(humanHandle("  BunsDev!  "), "bunsdev");
    assert.equal(humanHandle(""), "operator");
    assert.equal(humanHandle(undefined), "operator");
  });

  it("compacts counts like the reference card", () => {
    assert.equal(compactCount(999), "999");
    assert.equal(compactCount(1000), "1K");
    assert.equal(compactCount(42_500), "42.5K");
    assert.equal(compactCount(1_700_000), "1.7M");
  });
});
