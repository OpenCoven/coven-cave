import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MILESTONE_KEY_RE,
  dueCovenMilestones,
  dueTierMilestones,
  tierMilestoneKey,
} from "./milestone-defs.ts";

describe("dueCovenMilestones", () => {
  it("fires nothing for an empty coven", () => {
    assert.deepEqual(
      dueCovenMilestones({ familiarCount: 0, sessionsTotal: 0, covenStreakDays: 0 }, new Set()),
      [],
    );
  });

  it("fires first summoning at one familiar", () => {
    const due = dueCovenMilestones(
      { familiarCount: 1, sessionsTotal: 0, covenStreakDays: 0 },
      new Set(),
    );
    assert.deepEqual(due.map((m) => m.key), ["summon:first"]);
    assert.equal(due[0].title, "First summoning");
  });

  it("skips already-awarded keys", () => {
    const due = dueCovenMilestones(
      { familiarCount: 3, sessionsTotal: 150, covenStreakDays: 9 },
      new Set(["summon:first", "sessions:100"]),
    );
    assert.deepEqual(due.map((m) => m.key), ["streak:7"]);
  });

  it("an established coven crosses several at once", () => {
    const due = dueCovenMilestones(
      { familiarCount: 9, sessionsTotal: 1200, covenStreakDays: 31 },
      new Set(),
    );
    assert.deepEqual(
      due.map((m) => m.key).sort(),
      ["sessions:100", "sessions:1000", "streak:30", "streak:7", "summon:first"],
    );
  });

  it("every catalog key satisfies the server-side key guard", () => {
    const due = dueCovenMilestones(
      { familiarCount: 9, sessionsTotal: 1200, covenStreakDays: 31 },
      new Set(),
    );
    for (const m of due) assert.match(m.key, MILESTONE_KEY_RE);
  });
});

describe("dueTierMilestones", () => {
  const nova = { familiarId: "nova", displayName: "Nova", tierKey: "magus", tierLabel: "magus" } as const;

  it("kindling is a floor, never an ascension", () => {
    const due = dueTierMilestones(
      [{ familiarId: "fresh", displayName: "Fresh", tierKey: "kindling", tierLabel: "kindling" }],
      new Set(),
    );
    assert.deepEqual(due, []);
  });

  it("awards an unledgered tier with the familiar attached", () => {
    const due = dueTierMilestones([nova], new Set());
    assert.equal(due.length, 1);
    assert.equal(due[0].key, tierMilestoneKey("nova", "magus"));
    assert.equal(due[0].title, "Nova ascends to magus");
    assert.equal(due[0].familiarId, "nova");
    assert.match(due[0].key, MILESTONE_KEY_RE);
  });

  it("skips a tier already in the ledger", () => {
    const due = dueTierMilestones([nova], new Set([tierMilestoneKey("nova", "magus")]));
    assert.deepEqual(due, []);
  });
});
