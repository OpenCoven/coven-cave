import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activityFeed,
  boardBuckets,
  carouselDayLabel,
  carouselSlides,
  ciSummary,
  feedTime,
  githubByRepo,
  heatmapCells,
  longestStreak,
  matrixLevel,
  matrixRows,
  sessionTotals,
  sparkPath,
  sparkY,
  streakPips,
  topCollaborators,
} from "./bento-dashboard.ts";
import type { Card } from "./cave-board-types.ts";
import type { InboxItem } from "./cave-inbox.ts";
import type { Familiar, SessionRow } from "./types.ts";
import type { GitHubItem } from "./github-tasks.ts";
import type { ThreadSelfReport } from "./thread-self-report.ts";

const DAY_MS = 86_400_000;
// A fixed "now" mid-day UTC — Saturday 2026-07-18T12:00Z.
const NOW = Date.parse("2026-07-18T12:00:00.000Z");

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    project_root: "/tmp/coven",
    harness: "claude",
    title: "moon-phase digest",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-07-18T09:00:00.000Z",
    updated_at: "2026-07-18T09:30:00.000Z",
    familiarId: "wisp",
    ...over,
  };
}

function card(over: Partial<Card> = {}): Card {
  return {
    id: `c-${Math.random().toString(36).slice(2)}`,
    title: "ritual scheduler rework",
    notes: "",
    status: "running",
    priority: "medium",
    familiarId: "onyx",
    sessionId: null,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: "2026-07-17T08:00:00.000Z",
    updatedAt: "2026-07-18T08:00:00.000Z",
    lifecycle: "queued",
    lifecycleAt: "2026-07-17T08:00:00.000Z",
    retryCount: 0,
    maxRetries: 0,
    steps: [],
    ...over,
  };
}

function familiar(id: string, name: string, over: Partial<Familiar> = {}): Familiar {
  return { id, display_name: name, role: "helper", ...over };
}

function inboxItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: `i-${Math.random().toString(36).slice(2)}`,
    kind: "reminder",
    title: "approve moon-phase digest",
    status: "open",
    createdAt: "2026-07-18T07:00:00.000Z",
    updatedAt: "2026-07-18T07:00:00.000Z",
    recurrence: "none",
    source: "agent",
    familiarId: "wisp",
    ...over,
  } as InboxItem;
}

function ghItem(over: Partial<GitHubItem> = {}): GitHubItem {
  return {
    kind: "pr",
    id: `gh-${Math.random().toString(36).slice(2)}`,
    title: "ritual scheduler rework",
    repo: "OpenCoven/coven-cave",
    number: 142,
    url: "https://github.com/OpenCoven/coven-cave/pull/142",
    state: "open",
    updatedAt: "2026-07-18T06:00:00.000Z",
    ...over,
  };
}

function report(familiarId: string, over: Partial<ThreadSelfReport> = {}): ThreadSelfReport {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    familiarId,
    sessionId: "session-1",
    reportedAt: "2026-07-01T12:00:00.000Z",
    overallConfidence: 90,
    toolReliability: { score: 80, failedTools: [], unreliableTools: [] },
    contextPressure: "adequate",
    skillsUsed: [],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesLacking: [],
    capabilitiesVital: [],
    memoryRecallScore: 70,
    fileLocatabilityScore: 60,
    persistentBlockers: [],
    ...over,
  };
}

describe("sessionTotals", () => {
  it("counts non-archived sessions, with a 30d window", () => {
    const sessions = [
      session(),
      session({ created_at: new Date(NOW - 40 * DAY_MS).toISOString() }),
      session({ archived_at: "2026-07-01T00:00:00.000Z" }),
    ];
    const { total, last30d } = sessionTotals(sessions, NOW);
    assert.equal(total, 2);
    assert.equal(last30d, 1);
  });
});

describe("longestStreak", () => {
  it("finds the longest consecutive-day run of familiar sessions", () => {
    const day = (n: number) => new Date(NOW - n * DAY_MS).toISOString();
    const sessions = [
      session({ created_at: day(0) }),
      session({ created_at: day(1) }),
      // gap at day 2
      session({ created_at: day(3) }),
      session({ created_at: day(4) }),
      session({ created_at: day(5) }),
      session({ created_at: day(5) }), // duplicate day — still one day
    ];
    assert.equal(longestStreak(sessions), 3);
  });

  it("ignores archived and familiar-less sessions", () => {
    assert.equal(
      longestStreak([
        session({ archived_at: "2026-07-01T00:00:00.000Z" }),
        session({ familiarId: null }),
      ]),
      0,
    );
  });
});

describe("streakPips", () => {
  it("fills pips proportionally to the personal best", () => {
    assert.equal(streakPips(2, 5), 2);
    assert.equal(streakPips(5, 5), 5);
    assert.equal(streakPips(9, 5), 5); // capped
    assert.equal(streakPips(0, 5), 0);
    assert.equal(streakPips(3, 0), 0); // fresh coven: no fake progress
  });
});

describe("heatmapCells", () => {
  it("produces a full 53×7 column-major grid ending on today's week", () => {
    const { cells } = heatmapCells([], NOW, 53);
    assert.equal(cells.length, 53 * 7);
    // NOW is a Saturday (UTC) — the last cell of the last column is today.
    const last = cells[cells.length - 1];
    assert.equal(last.date, "2026-07-18");
    assert.equal(last.future, false);
  });

  it("marks trailing cells after today as future on a mid-week now", () => {
    const wednesday = Date.parse("2026-07-15T12:00:00.000Z");
    const { cells } = heatmapCells([], wednesday, 53);
    const lastCol = cells.slice(-7);
    assert.deepEqual(lastCol.map((c) => c.future), [false, false, false, false, true, true, true]);
  });

  it("buckets counts into levels 0/1/2/3/4", () => {
    const mk = (n: number) => Array.from({ length: n }, () => session({ created_at: "2026-07-18T01:00:00.000Z" }));
    const levelOfToday = (n: number) => {
      const { cells } = heatmapCells(mk(n), NOW, 53);
      return cells[cells.length - 1].level;
    };
    assert.equal(levelOfToday(0), 0);
    assert.equal(levelOfToday(1), 1);
    assert.equal(levelOfToday(3), 2);
    assert.equal(levelOfToday(6), 3);
    assert.equal(levelOfToday(7), 4);
  });

  it("derives month labels spanning the year", () => {
    const { monthLabels } = heatmapCells([], NOW, 53);
    assert.equal(monthLabels[0], "jul");
    assert.equal(monthLabels[monthLabels.length - 1], "jul");
    assert.ok(monthLabels.length >= 12 && monthLabels.length <= 14);
  });

  it("ignores archived sessions", () => {
    const { cells } = heatmapCells(
      [session({ created_at: "2026-07-18T01:00:00.000Z", archived_at: "2026-07-18T02:00:00.000Z" })],
      NOW,
      53,
    );
    assert.equal(cells[cells.length - 1].count, 0);
  });
});

describe("activityFeed", () => {
  const familiars = [familiar("wisp", "wisp"), familiar("onyx", "onyx")];

  it("merges sessions, cards, github and fired inbox items, newest first", () => {
    const rows = activityFeed({
      sessions: [session({ id: "s1", updated_at: "2026-07-18T09:30:00.000Z" })],
      cards: [card({ id: "c1", updatedAt: "2026-07-18T08:00:00.000Z", status: "done" })],
      github: [ghItem({ id: "g1", updatedAt: "2026-07-18T06:00:00.000Z" })],
      inbox: [inboxItem({ id: "i1", firedAt: "2026-07-18T10:00:00.000Z", sessionId: "s1" })],
      familiars,
    });
    assert.deepEqual(rows.map((r) => r.id), ["inbox:i1", "session:s1", "card:c1", "gh:g1"]);
    assert.equal(rows[0].href, "/#chat-s1");
    assert.equal(rows[1].text, "wisp finished · moon-phase digest");
    assert.equal(rows[2].text, "onyx · ritual scheduler rework → done");
    assert.ok(rows[3].text.includes("coven-cave #142"));
  });

  it("skips archived sessions and unfired inbox items, and caps", () => {
    const rows = activityFeed({
      sessions: [session({ archived_at: "2026-07-01T00:00:00.000Z" })],
      cards: [],
      github: [],
      inbox: [inboxItem({ firedAt: null })],
      familiars,
      cap: 5,
    });
    assert.equal(rows.length, 0);
  });

  it("labels running sessions and falls back to the harness name", () => {
    const rows = activityFeed({
      sessions: [session({ status: "running", familiarId: null, harness: "codex" })],
      cards: [],
      github: [],
      inbox: [],
      familiars,
    });
    assert.equal(rows[0].text, "codex is running · moon-phase digest");
  });
});

describe("feedTime", () => {
  it("shows HH:MM for today and a short date for older rows", () => {
    assert.match(feedTime(new Date(NOW - 60_000).toISOString(), NOW), /^\d{2}:\d{2}$/);
    assert.match(feedTime(new Date(NOW - 9 * DAY_MS).toISOString(), NOW), /^[a-z]{3} \d{1,2}$/);
    assert.equal(feedTime("nonsense", NOW), "");
  });
});

describe("boardBuckets", () => {
  const familiars = [familiar("wisp", "wisp"), familiar("onyx", "onyx")];

  it("leads needs-you with inbox asks, then review/blocked cards", () => {
    const { needsYou, inFlight, done } = boardBuckets({
      cards: [
        card({ id: "c-run", status: "running" }),
        card({ id: "c-rev", status: "review", familiarId: "wisp" }),
        card({ id: "c-blk", status: "blocked" }),
        card({ id: "c-done", status: "done" }),
      ],
      needsAttention: [inboxItem({ id: "i1" })],
      familiars,
    });
    assert.equal(needsYou[0].id, "inbox:i1");
    assert.equal(needsYou[0].sub, "wisp · reminder");
    assert.deepEqual(needsYou.slice(1).map((e) => e.id).sort(), ["card:c-blk", "card:c-rev"]);
    assert.deepEqual(inFlight.map((e) => e.id), ["card:c-run"]);
    assert.equal(inFlight[0].sub, "onyx · running");
    assert.deepEqual(done.map((e) => e.id), ["card:c-done"]);
    assert.equal(done[0].href, "/#card-c-done");
  });

  it("caps done to the freshest wins", () => {
    const mk = (id: string, at: string) => card({ id, status: "done", updatedAt: at });
    const { done } = boardBuckets({
      cards: [
        mk("old", "2026-07-10T00:00:00.000Z"),
        mk("newer", "2026-07-17T00:00:00.000Z"),
        mk("newest", "2026-07-18T00:00:00.000Z"),
      ],
      needsAttention: [],
      familiars,
      doneCap: 2,
    });
    assert.deepEqual(done.map((e) => e.id), ["card:newest", "card:newer"]);
  });
});

describe("carouselSlides", () => {
  it("puts the all-familiars aggregate first, then top familiars by 14d volume", () => {
    const day = (n: number) => new Date(NOW - n * DAY_MS).toISOString();
    const sessions = [
      session({ familiarId: "busy", created_at: day(0) }),
      session({ familiarId: "busy", created_at: day(1) }),
      session({ familiarId: "busy", created_at: day(2) }),
      session({ familiarId: "quiet", created_at: day(0) }),
    ];
    const familiars = [familiar("quiet", "quiet"), familiar("busy", "busy"), familiar("idle", "idle")];
    const { slides, max } = carouselSlides(sessions, familiars, NOW, 2);
    assert.deepEqual(slides.map((s) => s.name), ["all familiars", "busy", "quiet"]);
    assert.equal(slides[0].familiarId, null);
    assert.equal(slides[0].weekTotal, 4);
    assert.equal(slides[1].weekTotal, 3);
    assert.equal(max, Math.max(...slides[0].series));
    assert.equal(slides[0].series.length, 14);
  });

  it("computes the week-over-week delta", () => {
    const day = (n: number) => new Date(NOW - n * DAY_MS).toISOString();
    const sessions = [
      session({ familiarId: "f", created_at: day(0) }),
      session({ familiarId: "f", created_at: day(1) }),
      session({ familiarId: "f", created_at: day(10) }),
    ];
    const { slides } = carouselSlides(sessions, [familiar("f", "f")], NOW, 4);
    assert.equal(slides[1].weekTotal, 2);
    assert.equal(slides[1].weekDelta, 1); // 2 this week vs 1 last week
  });

  it("survives an empty coven", () => {
    const { slides, max } = carouselSlides([], [], NOW);
    assert.equal(slides.length, 1);
    assert.equal(max, 1);
  });
});

describe("sparkPath / sparkY / carouselDayLabel", () => {
  it("builds a line and a closed area on the 240×56 viewBox", () => {
    const flat = Array.from({ length: 14 }, () => 2);
    const { line, area } = sparkPath(flat, 4);
    assert.match(line, /^M0\.0 /);
    assert.ok(line.includes("L240.0 "));
    assert.ok(area.endsWith("L240 56 L0 56 Z"));
  });

  it("never divides by zero", () => {
    const { line } = sparkPath([0, 0], 0);
    assert.ok(!line.includes("NaN"));
    assert.ok(!Number.isNaN(sparkY(0, 0)));
  });

  it("labels hover points with month, day and count", () => {
    assert.equal(carouselDayLabel(13, NOW, 3), "jul 18 · 3 sessions");
    assert.equal(carouselDayLabel(12, NOW, 1), "jul 17 · 1 session");
  });
});

describe("matrix", () => {
  it("buckets values on the design ramp", () => {
    assert.equal(matrixLevel(90), 4);
    assert.equal(matrixLevel(88), 4);
    assert.equal(matrixLevel(80), 3);
    assert.equal(matrixLevel(70), 2);
    assert.equal(matrixLevel(50), 1);
  });

  it("derives four cells per familiar from thread self-reports", () => {
    const reports = new Map([["onyx", [report("onyx")]]]);
    const [row] = matrixRows([{ id: "onyx", name: "onyx" }], reports);
    assert.equal(row.cells.length, 4);
    assert.deepEqual(row.cells.map((c) => c.value), [90, 80, 70, 60]);
    assert.deepEqual(row.cells.map((c) => c.level), [4, 3, 2, 1]);
    assert.equal(row.cells[0].title, "onyx · conf 90%");
  });

  it("renders unmeasured familiars as level 0, not fake lows", () => {
    const [row] = matrixRows([{ id: "new", name: "new" }], new Map());
    assert.ok(row.cells.every((c) => c.level === 0 && c.value === null));
    assert.ok(row.cells[0].title.includes("no reports yet"));
  });
});

describe("githubByRepo / ciSummary", () => {
  it("groups by repo, freshest first, lowercased", () => {
    const groups = githubByRepo([
      ghItem({ id: "a", repo: "OpenCoven/coven-cave", updatedAt: "2026-07-18T06:00:00.000Z" }),
      ghItem({ id: "b", repo: "OpenCoven/other", updatedAt: "2026-07-18T07:00:00.000Z" }),
      ghItem({ id: "c", repo: "OpenCoven/coven-cave", updatedAt: "2026-07-18T05:00:00.000Z" }),
    ]);
    assert.deepEqual(groups.map((g) => g.repo), ["opencoven/other", "opencoven/coven-cave"]);
    assert.deepEqual(groups[1].items.map((i) => i.id), ["a", "c"]);
  });

  it("rolls up CI: failing > pending > passing > null", () => {
    assert.equal(ciSummary([ghItem({ checkStatus: "passing" }), ghItem({ checkStatus: "failing" })]), "failing");
    assert.equal(ciSummary([ghItem({ checkStatus: "passing" }), ghItem({ checkStatus: "pending" })]), "pending");
    assert.equal(ciSummary([ghItem({ checkStatus: "passing" })]), "passing");
    assert.equal(ciSummary([ghItem({})]), null);
  });
});

describe("topCollaborators", () => {
  it("ranks familiars by session volume and caps", () => {
    const fams = [familiar("a", "a"), familiar("b", "b"), familiar("c", "c")];
    const totals = new Map([["a", 3], ["b", 9], ["c", 5]]);
    assert.deepEqual(topCollaborators(fams, totals, 2).map((f) => f.id), ["b", "c"]);
  });
});
