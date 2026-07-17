import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RENOWN_TIERS,
  covenStreak,
  deriveRenown,
  familiarStreak,
  renownScore,
  ritualStreak,
} from "./familiar-renown.ts";
import type { SessionRow } from "./types.ts";

const DAY_MS = 24 * 60 * 60_000;
const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const TODAY = Math.floor(NOW / DAY_MS);

function session(startedAt: string, familiarId: string | null = "cody", archivedAt: string | null = null): SessionRow {
  return {
    id: `session-${startedAt}-${familiarId}`,
    project_root: "/tmp/cave",
    harness: "codex",
    title: "Session",
    status: "complete",
    exit_code: 0,
    archived_at: archivedAt,
    created_at: startedAt,
    updated_at: startedAt,
    familiarId,
  } as SessionRow;
}

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

describe("ritualStreak", () => {
  it("counts consecutive days ending today", () => {
    assert.equal(ritualStreak([TODAY, TODAY - 1, TODAY - 2], TODAY), 3);
  });

  it("grants a one-day grace when today has no session yet", () => {
    assert.equal(ritualStreak([TODAY - 1, TODAY - 2], TODAY), 2);
  });

  it("is zero once the chain broke before yesterday", () => {
    assert.equal(ritualStreak([TODAY - 2, TODAY - 3], TODAY), 0);
  });

  it("stops at the first gap", () => {
    assert.equal(ritualStreak([TODAY, TODAY - 1, TODAY - 3, TODAY - 4], TODAY), 2);
  });

  it("handles duplicates and empty input", () => {
    assert.equal(ritualStreak([TODAY, TODAY, TODAY - 1], TODAY), 2);
    assert.equal(ritualStreak([], TODAY), 0);
  });
});

describe("familiarStreak", () => {
  it("buckets by session start and filters to the familiar", () => {
    const sessions = [
      session(daysAgo(0)),
      session(daysAgo(1)),
      session(daysAgo(1), "sage"),
      session(daysAgo(2), "sage"),
    ];
    assert.equal(familiarStreak(sessions, "cody", NOW), 2);
    assert.equal(familiarStreak(sessions, "sage", NOW), 2);
  });

  it("ignores archived and unattributed sessions", () => {
    const sessions = [
      session(daysAgo(0), "cody", daysAgo(0)),
      session(daysAgo(1), null),
    ];
    assert.equal(familiarStreak(sessions, "cody", NOW), 0);
  });
});

describe("covenStreak", () => {
  it("chains days across different familiars", () => {
    const sessions = [
      session(daysAgo(0), "cody"),
      session(daysAgo(1), "sage"),
      session(daysAgo(2), "cody"),
    ];
    assert.equal(covenStreak(sessions, NOW), 3);
  });
});

describe("renown", () => {
  it("scores sessions plus 3x memories", () => {
    assert.equal(renownScore({ sessionsTotal: 4, memoryCount: 2 }), 10);
    assert.equal(renownScore({ sessionsTotal: -1, memoryCount: 0 }), 0);
  });

  it("tier floors are ascending and start at zero", () => {
    assert.equal(RENOWN_TIERS[0].min, 0);
    for (let i = 1; i < RENOWN_TIERS.length; i += 1) {
      assert.ok(RENOWN_TIERS[i].min > RENOWN_TIERS[i - 1].min);
    }
  });

  it("derives the tier, the next rung, and progress", () => {
    const fresh = deriveRenown({ sessionsTotal: 0, memoryCount: 0 });
    assert.equal(fresh.tier.key, "kindling");
    assert.equal(fresh.next?.tier.key, "adept");
    assert.equal(fresh.next?.remaining, 10);
    assert.equal(fresh.progress, 0);

    const adept = deriveRenown({ sessionsTotal: 4, memoryCount: 2 });
    assert.equal(adept.tier.key, "adept");
    assert.equal(adept.next?.tier.key, "magus");
    assert.equal(adept.next?.remaining, 40);

    const mid = deriveRenown({ sessionsTotal: 30, memoryCount: 0 });
    assert.equal(mid.tier.key, "adept");
    assert.equal(mid.progress, 0.5);
  });

  it("tops out at luminary with no next rung", () => {
    const top = deriveRenown({ sessionsTotal: 400, memoryCount: 50 });
    assert.equal(top.tier.key, "luminary");
    assert.equal(top.next, null);
    assert.equal(top.progress, 1);
  });
});
