// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LAYOUT,
  PANEL_TITLES,
  buildTrendSnapshot,
  confidenceColor,
  contractSub,
  coverageSub,
  dayKey,
  githubEmptyState,
  panelTitle,
  reconcileLayout,
  retroSub,
  seriesFor,
  shortRepo,
  whenLabel,
  wowSub,
} from "./dashboard-cockpit-format.ts";

test("reconcileLayout keeps saved order, appends new defaults, drops unknown ids", () => {
  const stored = { main: ["board", "usage", "retired-widget"], rail: undefined };
  const layout = reconcileLayout(stored);
  // Saved order leads; every remaining default follows; the unknown id is gone.
  assert.deepEqual(layout.main.slice(0, 2), ["board", "usage"]);
  assert.deepEqual([...layout.main].sort(), [...DEFAULT_LAYOUT.main].sort());
  assert.ok(!layout.main.includes("retired-widget"));
  assert.deepEqual(layout.rail, DEFAULT_LAYOUT.rail);
});

test("every default widget has a human drag-announcement title", () => {
  for (const id of [...DEFAULT_LAYOUT.main, ...DEFAULT_LAYOUT.rail]) {
    assert.ok(PANEL_TITLES[id], `missing PANEL_TITLES entry for "${id}"`);
  }
  assert.equal(panelTitle("board"), "Tasks");
  assert.equal(panelTitle("not-a-widget"), "not-a-widget");
});

test("seriesFor yields 7 points oldest→newest with nulls for missing days", () => {
  const now = new Date(2026, 6, 14, 12, 0, 0);
  const store = { [dayKey(now)]: { sessions: 5 }, "2026-07-12": { sessions: 2 } };
  const series = seriesFor(store, "sessions", now);
  assert.equal(series.length, 7);
  assert.equal(series.at(-1).value, 5); // today last
  assert.equal(series.at(-3).value, 2); // two days back
  assert.equal(series[0].value, null); // missing day is a gap, not a fake zero
});

test("streak is a first-class trend key — old snapshots read as gaps", () => {
  const now = new Date(2026, 6, 14, 12, 0, 0);
  // Yesterday's snapshot predates the streak metric; today's carries it.
  const store = { [dayKey(now)]: { streak: 6 }, "2026-07-13": { sessions: 3 } };
  const series = seriesFor(store, "streak", now);
  assert.equal(series.at(-1).value, 6);
  assert.equal(series.at(-2).value, null, "pre-streak snapshot is a gap, never a fake zero");
});

test("session-backed trends stay gaps until sessions finish loading", () => {
  const values = {
    confidence: 0, active: 0, sessions: 0, accept: 0,
    contract: 0, needs: 0, streak: 0,
  };
  assert.deepEqual(buildTrendSnapshot(values, false), {
    confidence: 0, active: 0, accept: 0, contract: 0, needs: 0,
  });
  assert.deepEqual(buildTrendSnapshot(values, true), values,
    "an empty but loaded session list records honest zeros");
});

test("KPI sub-lines teach instead of shrugging", () => {
  assert.equal(retroSub({ retroAccepted: 0, retroReverted: 0 }), "fills in after the first retro run");
  assert.equal(retroSub({ retroAccepted: 3, retroReverted: 1 }), "3/4 accepted");
  assert.equal(contractSub({ contractTotal: 0, contractPass: 0 }), "fills in once familiars have contracts");
  assert.equal(contractSub({ contractTotal: 5, contractPass: 4 }), "4/5 passing");
  assert.equal(wowSub(2), "▲ 2 vs last week");
  assert.equal(wowSub(-3), "▼ 3 vs last week");
  assert.equal(wowSub(0), "level with last week");
  assert.equal(coverageSub("Trusted", 12, 20, "scored"), "Trusted · first 12/20 scored");
  assert.equal(coverageSub("Trusted", 12, 12, "scored"), "Trusted");
});

test("whenLabel is calendar-relative for upcoming reminders", () => {
  const now = new Date(2026, 6, 14, 9, 0, 0);
  const at = (d: Date, h: number) => { const c = new Date(d); c.setHours(h, 30, 0, 0); return c.toISOString(); };
  assert.match(whenLabel(at(now, 15), now), /^Today /);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  assert.match(whenLabel(at(tomorrow, 9), now), /^Tmrw /);
  const nextWeek = new Date(now); nextWeek.setDate(now.getDate() + 6);
  assert.match(whenLabel(at(nextWeek, 9), now), /^Jul 20 /);
});

test("githubEmptyState: connect affordance only when the token probe proves disconnected", () => {
  assert.deepEqual(githubEmptyState(false), { copy: "GitHub isn't connected.", showConnect: true });
  assert.deepEqual(githubEmptyState(true), { copy: "No GitHub activity right now.", showConnect: false });
  // Probe failed → neither claim is honest; no affordance for a fix that may not apply.
  assert.deepEqual(githubEmptyState(null), {
    copy: "No GitHub activity, or no token configured.",
    showConnect: false,
  });
});

test("small formatters: shortRepo, confidenceColor clamps", () => {
  assert.equal(shortRepo("OpenCoven/coven-cave"), "coven-cave");
  assert.equal(shortRepo("bare-repo"), "bare-repo");
  assert.match(confidenceColor(1.4), /100%/); // clamped high
  assert.match(confidenceColor(-2), /\b0%/);  // clamped low
  assert.match(confidenceColor(0.5), /50%/);
});
