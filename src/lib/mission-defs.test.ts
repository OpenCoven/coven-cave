import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MILESTONE_KEY_RE } from "./milestone-defs.ts";
import {
  MISSION_KEY_PREFIX,
  deriveMissions,
  dueMissionAwards,
  missionBonusCeiling,
  missionBonusPoints,
  missionSignals,
  type MissionSignals,
} from "./mission-defs.ts";

const EMPTY: MissionSignals = {
  familiarCount: 0,
  sessionsTotal: 0,
  covenStreakDays: 0,
  memoryTotal: 0,
  familiarsWithSession: 0,
  familiarsWithMemory: 0,
};

const signals = (over: Partial<MissionSignals> = {}): MissionSignals => ({ ...EMPTY, ...over });

describe("dueMissionAwards", () => {
  it("pays out nothing for an empty coven", () => {
    assert.deepEqual(dueMissionAwards(EMPTY, new Set()), []);
  });

  it("pays out a mission whose objective is met", () => {
    const due = dueMissionAwards(signals({ memoryTotal: 1 }), new Set());
    assert.deepEqual(due.map((m) => m.key), ["mission:memory:first-keeping"]);
    assert.match(due[0].title, /^Mission complete — First keeping$/);
    assert.match(due[0].body, /\+5 renown\.$/);
  });

  it("skips a mission already in the ledger", () => {
    const due = dueMissionAwards(
      signals({ memoryTotal: 12 }),
      new Set(["mission:memory:first-keeping"]),
    );
    assert.deepEqual(due.map((m) => m.key), ["mission:memory:tend-the-grimoire"]);
  });

  it("crossing a target pays the tiers below it too", () => {
    const due = dueMissionAwards(signals({ sessionsTotal: 50 }), new Set());
    assert.deepEqual(
      due.map((m) => m.key).sort(),
      ["mission:practice:fifty-workings", "mission:practice:ten-workings"],
    );
  });

  it("roster-wide missions need a real roster, not a coven of one", () => {
    const solo = signals({ familiarCount: 1, familiarsWithSession: 1, familiarsWithMemory: 1 });
    const keys = dueMissionAwards(solo, new Set()).map((m) => m.key);
    assert.ok(!keys.includes("mission:coven:full-roster-at-work"));
    assert.ok(!keys.includes("mission:coven:every-familiar-remembers"));
  });

  it("a roster-wide mission waits on the last idle familiar", () => {
    const partial = signals({ familiarCount: 3, familiarsWithSession: 2 });
    assert.ok(
      !dueMissionAwards(partial, new Set()).some((m) => m.key === "mission:coven:full-roster-at-work"),
    );
    const whole = signals({ familiarCount: 3, familiarsWithSession: 3 });
    assert.ok(
      dueMissionAwards(whole, new Set()).some((m) => m.key === "mission:coven:full-roster-at-work"),
    );
  });

  it("every catalog key is namespaced and passes the server-side key guard", () => {
    const all = dueMissionAwards(
      signals({
        familiarCount: 5,
        sessionsTotal: 500,
        covenStreakDays: 40,
        memoryTotal: 40,
        familiarsWithSession: 5,
        familiarsWithMemory: 5,
      }),
      new Set(),
    );
    assert.equal(all.length, 9);
    for (const award of all) {
      assert.ok(award.key.startsWith(MISSION_KEY_PREFIX));
      assert.match(award.key, MILESTONE_KEY_RE);
      assert.ok(award.title.length <= 120);
      assert.ok(award.body.length <= 300);
    }
  });
});

describe("deriveMissions", () => {
  it("reports partial progress as a clamped fraction", () => {
    const board = deriveMissions(signals({ sessionsTotal: 5 }), new Set());
    const ten = board.find((m) => m.key === "mission:practice:ten-workings");
    assert.ok(ten);
    assert.equal(ten.current, 5);
    assert.equal(ten.target, 10);
    assert.equal(ten.fraction, 0.5);
    assert.equal(ten.earned, false);
    assert.equal(ten.complete, false);
  });

  it("never reads past complete when the count overshoots", () => {
    const board = deriveMissions(signals({ sessionsTotal: 999 }), new Set());
    const ten = board.find((m) => m.key === "mission:practice:ten-workings");
    assert.ok(ten);
    assert.equal(ten.current, 10);
    assert.equal(ten.fraction, 1);
    assert.equal(ten.earned, true);
  });

  it("distinguishes earned-but-unpaid from ledgered", () => {
    const earned = deriveMissions(signals({ memoryTotal: 1 }), new Set());
    const before = earned.find((m) => m.key === "mission:memory:first-keeping");
    assert.equal(before?.earned, true);
    assert.equal(before?.complete, false);

    const paid = deriveMissions(signals({ memoryTotal: 1 }), new Set(["mission:memory:first-keeping"]));
    assert.equal(paid.find((m) => m.key === "mission:memory:first-keeping")?.complete, true);
  });

  it("orders open missions nearest-to-done first and completed ones last", () => {
    const board = deriveMissions(
      signals({ sessionsTotal: 9, covenStreakDays: 1 }),
      new Set(["mission:memory:first-keeping"]),
    );
    assert.equal(board[0].key, "mission:practice:ten-workings");
    assert.equal(board.at(-1)?.key, "mission:memory:first-keeping");
    assert.equal(board.filter((m) => m.complete).length, 1);
  });

  it("returns the whole catalog regardless of progress", () => {
    assert.equal(deriveMissions(EMPTY, new Set()).length, 9);
  });
});

describe("missionBonusPoints", () => {
  it("is zero with an empty ledger", () => {
    assert.equal(missionBonusPoints([]), 0);
  });

  it("sums only keys the catalog still knows", () => {
    assert.equal(
      missionBonusPoints([
        "mission:memory:first-keeping",
        "mission:practice:ten-workings",
        "mission:retired:long-gone",
        "streak:7",
      ]),
      15,
    );
  });

  it("never exceeds the advertised ceiling", () => {
    const everything = dueMissionAwards(
      signals({
        familiarCount: 5,
        sessionsTotal: 500,
        covenStreakDays: 40,
        memoryTotal: 40,
        familiarsWithSession: 5,
        familiarsWithMemory: 5,
      }),
      new Set(),
    ).map((m) => m.key);
    assert.equal(missionBonusPoints(everything), missionBonusCeiling());
    assert.equal(missionBonusCeiling(), 155);
  });
});

describe("missionSignals", () => {
  it("counts familiars with work and with memory independently", () => {
    const built = missionSignals(
      ["nova", "cody", "sage"],
      new Map([["nova", 4], ["cody", 1]]),
      new Map([["nova", 2]]),
      3,
      5,
    );
    assert.deepEqual(built, {
      familiarCount: 3,
      sessionsTotal: 5,
      covenStreakDays: 3,
      memoryTotal: 2,
      familiarsWithSession: 2,
      familiarsWithMemory: 1,
    });
  });

  it("reads unavailable memory as zero, so a payout is late and never early", () => {
    const built = missionSignals(["nova", "cody"], new Map([["nova", 1]]), null, 0, 1);
    assert.equal(built.memoryTotal, 0);
    assert.equal(built.familiarsWithMemory, 0);
    assert.deepEqual(dueMissionAwards(built, new Set()), []);
  });

  it("ignores memory attributed to a familiar no longer on the roster", () => {
    const built = missionSignals(["nova"], new Map(), new Map([["ghost", 9]]), 0, 0);
    assert.equal(built.memoryTotal, 0);
  });
});
