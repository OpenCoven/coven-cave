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

const section = (start: string, end: string) => {
  const from = surface.indexOf(start);
  const to = surface.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} section missing`);
  return surface.slice(from, to);
};

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
  assert.match(surface, /SurfaceError/);
  assert.match(surface, /aria-current=\{card\.id === state\.selectedId/);
  assert.match(surface, /aria-label="Move card to lane"/);
});

test("board failures stay retryable and distinct from loading and empty data", () => {
  const chartedCards = section('<SurfaceCanvas label="Charted cards"', 'label="Card details"');
  assert.match(surface, /import[\s\S]*?\bSurfaceLoading\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /import[\s\S]*?\bSurfaceError\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /const fetchBoard = useCallback\(async \(\) =>/);
  assert.match(
    surface,
    /useLatestAsyncData<Card\[\]>\(\{[\s\S]*?scopeKey: familiarId[\s\S]*?load: fetchBoard[\s\S]*?errorMessage: "Couldn't load the board\."/,
  );
  assert.match(
    chartedCards,
    /boardError && cards == null\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadBoard\}[\s\S]*?\)\s*:\s*cards == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(
    chartedCards,
    /boardError && cards != null\s*\?\s*\([\s\S]*?Showing the last loaded board/,
    "a failed revalidation keeps the last usable board visible",
  );
  assert.match(chartedCards, /visible\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);
});

test("board load failures use one canonical live error", () => {
  assert.doesNotMatch(surface, /announce\("Couldn't load the board\.", "assertive"\)/);
  const chartedCards = section('<SurfaceCanvas label="Charted cards"', 'label="Card details"');
  assert.doesNotMatch(chartedCards, /<SurfaceError[\s\S]*?live=\{false\}/, "the main board error stays live");
});

test("card-derived drawers and lane counts stay truthful while the board loads or fails", () => {
  const recentlyDoneStart = surface.indexOf('<RailSection title="Recently completed"');
  const blockedStart = surface.indexOf('<RailSection title="Blocked"', recentlyDoneStart);
  const drawerEnd = surface.indexOf("</div>", blockedStart);
  assert.ok(recentlyDoneStart >= 0 && blockedStart > recentlyDoneStart && drawerEnd > blockedStart);
  const recentlyDone = surface.slice(recentlyDoneStart, blockedStart);
  const blocked = surface.slice(blockedStart, drawerEnd);
  for (const panel of [recentlyDone, blocked]) {
    assert.match(
      panel,
      /boardError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadBoard\}[\s\S]*?\)\s*:\s*cards == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
    );
    assert.match(panel, /<SurfaceError[\s\S]*?live=\{false\}/);
  }
  assert.match(recentlyDone, /recentlyDone\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);
  assert.match(blocked, /blocked\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);

  const lanesStart = surface.indexOf('<RailSection title="Course lanes"');
  const lanesEnd = surface.indexOf('<RailSection title="Upcoming legs"', lanesStart);
  assert.ok(lanesStart >= 0 && lanesEnd > lanesStart);
  const courseLanes = surface.slice(lanesStart, lanesEnd);
  assert.match(
    courseLanes,
    /boardError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadBoard\}[\s\S]*?\)\s*:\s*cards == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(courseLanes, /<SurfaceError[\s\S]*?live=\{false\}/);
  assert.match(
    courseLanes,
    /cards == null\s*\?\s*\([\s\S]*?<SurfaceLoading[\s\S]*?\)\s*:\s*\([\s\S]*?<ul className="role-surface-list"/,
    "successful board data renders the course lane list",
  );
});

test("board mutations announce success and assertively announce visible failures", () => {
  assert.match(surface, /import \{ useAnnouncer \} from "@\/components\/ui\/live-region"/);
  assert.match(surface, /const \{ announce \} = useAnnouncer\(\)/);
  assert.match(surface, /announce\(`Charted "\$\{title\}" in \$\{LANE_LABELS\.backlog\}\.`\)/);
  assert.match(surface, /announce\(`Moved "\$\{title\}" to \$\{LANE_LABELS\[status\]\}\.`\)/);
  assert.match(surface, /const \[chartError, setChartError\] = useState<string \| null>\(null\)/);
  assert.match(surface, /setChartError\(message\)[\s\S]*?announce\(message, "assertive"\)/);
  assert.match(surface, /const \[moveError, setMoveError\] = useState<string \| null>\(null\)/);
  assert.match(surface, /setMoveError\(message\)[\s\S]*?announce\(message, "assertive"\)/);
  assert.doesNotMatch(surface, /<p role="alert" className="role-surface-hint">/);
  assert.match(surface, /\{chartError \? \([\s\S]*?<p className="role-surface-hint">[\s\S]*?\{chartError\}/);
  assert.match(surface, /\{moveError \? \([\s\S]*?<p className="role-surface-hint">[\s\S]*?\{moveError\}/);
});

test("card details wait for the board source before exposing move controls", () => {
  const details = section('label="Card details"', "</SurfaceRail>");
  assert.match(
    details,
    /boardError && cards == null\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?live=\{false\}[\s\S]*?\)\s*:\s*cards == null\s*\?\s*\([\s\S]*?<SurfaceLoading[\s\S]*?live=\{false\}[\s\S]*?\)\s*:\s*!selected/,
  );
});

test("compact Course and Card details rails stay mutually exclusive", () => {
  assert.match(
    surface,
    /const setCourseRailExpanded = \(next: boolean\) => \{\s*setCourseExpanded\(next\);\s*if \(next\) setDetailsExpanded\(false\);\s*\}/,
  );
  assert.match(
    surface,
    /const setDetailsRailExpanded = \(next: boolean\) => \{\s*setDetailsExpanded\(next\);\s*if \(next\) setCourseExpanded\(false\);\s*\}/,
  );
  assert.match(
    surface,
    /<SurfaceRail\s+side="left"\s+label="Course"\s+expanded=\{courseExpanded\}\s+onExpandedChange=\{setCourseRailExpanded\}/,
  );
  assert.match(
    surface,
    /<SurfaceRail\s+side="right"\s+label="Card details"\s+expanded=\{detailsExpanded\}\s+onExpandedChange=\{setDetailsRailExpanded\}/,
  );
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
