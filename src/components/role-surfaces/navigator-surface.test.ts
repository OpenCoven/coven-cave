import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COURSE_LANES,
  cardProgress,
  chartRoomStatus,
  groupByLane,
  scopeCards,
  upcomingLegs,
} from "./navigator-charts.ts";

const surface = readFileSync(new URL("./navigator-surface.tsx", import.meta.url), "utf8");
const register = readFileSync(new URL("./register.tsx", import.meta.url), "utf8");
const docs = readFileSync(new URL("../../../docs/role-surfaces.md", import.meta.url), "utf8");

// ── Charting rules (behavioral, real module) ─────────────────────────────────

test("scopeCards keeps this familiar's cards and unassigned ones only", () => {
  const cards = [
    { id: "mine", familiarId: "salem" },
    { id: "unassigned", familiarId: null },
    { id: "other", familiarId: "nova" },
  ];
  assert.deepEqual(
    scopeCards(cards, "salem").map((c) => c.id),
    ["mine", "unassigned"],
  );
});

test("groupByLane charts every lane in board order, even when empty", () => {
  const lanes = groupByLane([
    { status: "done" },
    { status: "backlog" },
    { status: "backlog" },
  ]);
  assert.deepEqual(lanes.map((l) => l.status), COURSE_LANES);
  assert.deepEqual(lanes.map((l) => l.cards.length), [2, 0, 0, 0, 0, 1]);
});

test("cardProgress stays honest about steps", () => {
  assert.deepEqual(cardProgress({ steps: [] }), { done: 0, total: 0, label: "no steps" });
  assert.deepEqual(
    cardProgress({
      steps: [
        { id: "a", text: "x", done: true, addedAt: "" },
        { id: "b", text: "y", done: false, addedAt: "" },
      ],
    }),
    { done: 1, total: 2, label: "1/2 steps" },
  );
});

test("upcomingLegs sorts dated undone cards soonest-first and flags overdue", () => {
  const legs = upcomingLegs(
    [
      { status: "running", startDate: "2026-07-20", endDate: null },
      { status: "backlog", startDate: null, endDate: "2026-07-10" },
      { status: "done", startDate: "2026-07-01", endDate: "2026-07-02" },
      { status: "inbox", startDate: null, endDate: null },
    ],
    "2026-07-14",
  );
  assert.deepEqual(legs.map((l) => l.sailsOn), ["2026-07-10", "2026-07-20"]);
  assert.deepEqual(legs.map((l) => l.overdue), [true, false]);
});

test("upcomingLegs caps the schedule", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    status: "backlog" as const,
    startDate: `2026-08-${String(i + 1).padStart(2, "0")}`,
    endDate: null,
  }));
  assert.equal(upcomingLegs(many, "2026-07-14").length, 8);
});

test("chartRoomStatus escalates blocked over underway over clear", () => {
  assert.deepEqual(chartRoomStatus({ running: 0, blocked: 0 }), { label: "charts clear", tone: "ok" });
  assert.deepEqual(chartRoomStatus({ running: 3, blocked: 0 }), { label: "3 underway", tone: "busy" });
  assert.deepEqual(chartRoomStatus({ running: 3, blocked: 2 }), { label: "2 blocked", tone: "warn" });
});

// ── Surface wiring (source pins) ─────────────────────────────────────────────

test("the room reads and writes the real board", () => {
  assert.match(surface, /fetch\("\/api\/board"/);
  assert.match(surface, /\/api\/board\/\$\{encodeURIComponent\(selected\.id\)\}/);
  assert.match(surface, /method: "POST"/);
  assert.match(surface, /method: "PATCH"/);
  assert.match(surface, /status: "backlog"/);
  assert.match(surface, /scopeCards\(json\.cards, familiarId\)/);
});

test("the room derives legs and progress from real card data", () => {
  assert.match(surface, /upcomingLegs\(cards \?\? \[\], today\)/);
  assert.match(surface, /cardProgress\(/);
  assert.match(surface, /context\.openSession\(/);
  assert.match(surface, /SurfaceEmpty/);
  assert.match(surface, /useRoleSurfaceState<NavigatorState>/);
});

test("the room exposes errors and selection accessibly", () => {
  assert.match(surface, /role="alert"/);
  assert.match(surface, /aria-current=\{card\.id === state\.selectedId/);
  assert.match(surface, /aria-label="Move card to lane"/);
});

test("registration names the Chart Room with its own accent and drawer chrome", () => {
  assert.match(register, /id: NAVIGATOR_SURFACE_ID/);
  assert.match(register, /role: "navigator"/);
  assert.match(register, /title: "Chart Room"/);
  assert.match(register, /iconName: "ph:compass"/);
  assert.match(register, /accentHue: 105/);
  assert.match(register, /combo: "mod\+shift\+d",\s*\n\s*description: "Toggle the voyage log drawer"/);
  assert.match(register, /chartRoomStatus\(/);
});

test("the Chart Room is documented as an initial room", () => {
  assert.match(docs, /\*\*Chart Room\*\* \(`navigator-chart-room`, role `navigator`\)/);
});
