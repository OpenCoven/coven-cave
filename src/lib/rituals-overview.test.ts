import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InboxItem } from "./cave-inbox.ts";
import { buildRitualWeek, ritualAgendaItems, ritualLogItems } from "./rituals-overview.ts";

function item(id: string, overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    kind: "reminder",
    title: id,
    status: "pending",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    recurrence: { type: "none" },
    source: "user",
    ...overrides,
  };
}

describe("buildRitualWeek", () => {
  it("returns the Sunday-starting week and marks scheduled days", () => {
    const week = buildRitualWeek(
      [item("friday", { fireAt: "2026-07-17T14:00:00.000Z" })],
      new Date("2026-07-17T16:00:00.000Z"),
    );

    assert.deepEqual(week.map((day) => day.key), [
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
    assert.equal(week[5]?.isToday, true);
    assert.equal(week[5]?.hasItems, true);
  });

  it("moves to the next week at Sunday midnight", () => {
    const saturday = buildRitualWeek([], new Date("2026-07-18T16:00:00.000Z"));
    const sunday = buildRitualWeek([], new Date("2026-07-19T16:00:00.000Z"));

    assert.equal(saturday[0]?.key, "2026-07-12");
    assert.equal(sunday[0]?.key, "2026-07-19");
    assert.equal(sunday[0]?.isToday, true);
  });
});

describe("ritual item ordering", () => {
  const items = [
    item("later", { fireAt: "2026-07-20T12:00:00.000Z", updatedAt: "2026-07-03T12:00:00.000Z" }),
    item("sooner", { fireAt: "2026-07-19T12:00:00.000Z", updatedAt: "2026-07-04T12:00:00.000Z" }),
    item("dismissed", { status: "dismissed", fireAt: "2026-07-18T12:00:00.000Z" }),
  ];

  it("sorts the agenda forward and excludes dismissed items", () => {
    assert.deepEqual(ritualAgendaItems(items).map(({ id }) => id), ["sooner", "later"]);
  });

  it("sorts the activity log newest first and excludes dismissed items", () => {
    assert.deepEqual(ritualLogItems(items).map(({ id }) => id), ["sooner", "later"]);
  });
});
