import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActivityLattice,
  densityStep,
  DENSITY_STEPS,
  FORTNIGHT_DAYS,
  LATTICE_WEEKS,
  QUARTER_WEEKS,
} from "@/lib/activity-lattice";
import type { SessionRow } from "@/lib/types";

const DAY_MS = 24 * 60 * 60_000;
// A fixed instant so the windows are deterministic — no Date.now() in tests.
const NOW = Date.parse("2026-08-03T12:00:00.000Z");

function session(daysBack: number, familiarId = "sage"): SessionRow {
  return {
    id: `s-${daysBack}-${Math.random()}`,
    familiarId,
    updated_at: new Date(NOW - daysBack * DAY_MS).toISOString(),
  } as SessionRow;
}

test("the three views cover their stated windows", () => {
  const lattice = buildActivityLattice([], "sage", NOW);
  assert.equal(lattice.year.length, LATTICE_WEEKS);
  assert.equal(lattice.quarter.length, QUARTER_WEEKS);
  assert.equal(lattice.fortnight.length, FORTNIGHT_DAYS);
  assert.equal(lattice.year.every((week) => week.days.length === 7), true);
});

test("an empty history still renders a full grid rather than nothing", () => {
  const lattice = buildActivityLattice([], "sage", NOW);
  assert.equal(lattice.total, 0);
  assert.equal(lattice.peak, 0);
  assert.equal(lattice.year.flatMap((w) => w.days).length, LATTICE_WEEKS * 7);
});

test("a day carries the same count in every view that contains it", () => {
  // The reason all three derive from one pass: the fortnight must never
  // disagree with the year that contains it.
  const sessions = [session(1), session(1), session(1)];
  const lattice = buildActivityLattice(sessions, "sage", NOW);
  const key = lattice.fortnight.at(-2)?.key;
  assert.ok(key);
  const inFortnight = lattice.fortnight.find((day) => day.key === key)?.count;
  const inYear = lattice.year.flatMap((w) => w.days).find((day) => day.count > 0);
  assert.equal(inFortnight, 3);
  assert.equal(inYear?.count, 3);
  assert.equal(inYear?.key, key);
});

test("only this familiar's sessions are counted", () => {
  const lattice = buildActivityLattice([session(1), session(1, "nyx")], "sage", NOW);
  assert.equal(lattice.total, 1);
});

test("sessions older than the year window are excluded", () => {
  const lattice = buildActivityLattice([session(400)], "sage", NOW);
  assert.equal(lattice.total, 0);
});

test("the quarter is the tail of the year, not a separate bucketing", () => {
  const sessions = [session(3), session(40)];
  const lattice = buildActivityLattice(sessions, "sage", NOW);
  assert.deepEqual(lattice.quarter, lattice.year.slice(-QUARTER_WEEKS));
  assert.equal(
    lattice.quarter.reduce((sum, week) => sum + week.total, 0),
    2,
    "both sessions fall inside the trailing 8 weeks",
  );
});

test("weekly totals sum their own days", () => {
  const lattice = buildActivityLattice([session(1), session(2), session(30)], "sage", NOW);
  for (const week of lattice.year) {
    assert.equal(week.total, week.days.reduce((sum, day) => sum + day.count, 0));
  }
});

test("peak is the busiest single day", () => {
  const lattice = buildActivityLattice([session(1), session(1), session(5)], "sage", NOW);
  assert.equal(lattice.peak, 2);
});

// MARK: - Density

test("any activity is visibly distinct from silence", () => {
  // A single session against a busy peak must not round down to the empty
  // shade — that is the one thing a density grid must never do.
  assert.equal(densityStep(0, 50), 0);
  assert.equal(densityStep(1, 50), 1);
});

test("density saturates at the peak and never exceeds the step count", () => {
  assert.equal(densityStep(50, 50), DENSITY_STEPS);
  assert.equal(densityStep(99, 50), DENSITY_STEPS);
});

test("density with no peak reads as empty rather than dividing by zero", () => {
  assert.equal(densityStep(0, 0), 0);
  assert.equal(Number.isFinite(densityStep(3, 0)), true);
});
