// @ts-nocheck
import assert from "node:assert/strict";

import {
  buildDayModel,
  clockLabel,
  deriveChapters,
  deriveSpine,
  deriveTrend,
  deriveShipped,
  deriveStreak,
  deriveSwimlanes,
  deriveWindow,
  dayEvents,
  hourHistogram,
} from "./daily-report-day.ts";

const DAY = new Date(2026, 6, 27); // Mon Jul 27 2026, local

/** Local ISO for the report day at HH:MM — the model is local-day based. */
function at(hh, mm = 0) {
  return new Date(2026, 6, 27, hh, mm).toISOString();
}

function emptyBreakdown(over = {}) {
  return { reminders: [], responses: [], familiars: [], openItems: [], ...over };
}

function reminder(id, hour, title = "Sync the registry") {
  return {
    id,
    kind: "reminder",
    title,
    status: "fired",
    createdAt: at(hour),
    updatedAt: at(hour),
    firedAt: at(hour),
    recurrence: "none",
    source: "user",
  };
}

// ── clockLabel ──────────────────────────────────────────────────────────────
{
  assert.equal(clockLabel(at(8, 14)), "08:14");
  assert.equal(clockLabel(at(23, 5)), "23:05");
  assert.equal(clockLabel(null), "");
  assert.equal(clockLabel("not-a-date"), "", "unparseable instants must not throw");
}

// ── dayEvents ───────────────────────────────────────────────────────────────
{
  const payload = {
    prsMerged: [
      { repo: "OpenCoven/coven", number: 505, title: "honor transforms", url: "u1", mergedAt: at(14, 22) },
      { repo: "OpenCoven/coven-landing", number: 51, title: "Reforged", url: "u2", mergedAt: at(22, 7) },
    ],
    cardsCompleted: [{ id: "c1", title: "Ship it", completedAt: at(16, 0), familiarId: "cody" }],
    sessionGroups: [
      {
        key: "/coven",
        label: "coven",
        additions: 310,
        deletions: 96,
        sessions: [
          {
            id: "s1",
            title: "transforms",
            familiarId: "cody",
            additions: 310,
            deletions: 96,
            pr: { repo: "OpenCoven/coven", number: 505 },
          },
        ],
      },
    ],
    factsHash: "h",
    refreshedAt: at(23, 59),
  };

  const events = dayEvents(payload, emptyBreakdown({ reminders: [reminder("r1", 8)] }), DAY);

  assert.equal(events.length, 4, "reminder + 2 merges + 1 card");
  assert.deepEqual(
    events.map((e) => e.kind),
    ["reminder", "merge", "card", "merge"],
    "events sort oldest-first regardless of source",
  );
  assert.equal(events[0].hour, 8);
  assert.equal(events[1].minute, 14 * 60 + 22, "minute-of-day drives horizontal placement");

  // The PR's familiar is only knowable via the session that carried it.
  assert.equal(events[1].familiarId, "cody", "merge inherits familiar through its session's pr link");
  assert.equal(events[3].familiarId, null, "unlinked merge keeps a null familiar, not a guess");

  // Events dated outside the report day are dropped.
  const stale = { ...reminder("r2", 8), firedAt: new Date(2026, 6, 26, 8).toISOString() };
  const filtered = dayEvents(null, emptyBreakdown({ reminders: [stale] }), DAY);
  assert.equal(filtered.length, 0, "another day's fired reminder must not enter this day");
}

// ── chapters ────────────────────────────────────────────────────────────────
{
  const events = dayEvents(
    {
      prsMerged: [
        { repo: "o/a", number: 1, title: "a", url: "", mergedAt: at(14, 0) },
        { repo: "o/a", number: 2, title: "b", url: "", mergedAt: at(14, 20) },
        { repo: "o/b", number: 3, title: "c", url: "", mergedAt: at(14, 40) },
      ],
      factsHash: "h",
      refreshedAt: at(23),
    },
    emptyBreakdown({ reminders: [reminder("r1", 8)] }),
    DAY,
  );

  const chapters = deriveChapters(events, 10);
  assert.equal(chapters.length, 2, "a >75min gap opens a new chapter");
  assert.equal(chapters[0].title, "First light", "a day opening on a reminder is First light");
  assert.equal(chapters[0].ordinal, "01");
  assert.match(chapters[0].kicker, /^08:00 · reminder$/);
  assert.equal(chapters[1].merges, 3);
  assert.equal(chapters[1].title, "The sweep", "3+ merges across 2+ repos is a sweep");
  assert.match(chapters[1].summary, /3 merges between 14:00 — 14:40\./);

  // Sessions are apportioned by merge share so the rail's counts sum to the day.
  assert.equal(chapters[1].sessions, 10, "all merges sit in one chapter, so it carries the sessions");

  assert.deepEqual(deriveChapters([], 5), [], "no events, no chapters");
}

{
  // Folding: many small bursts collapse to at most 6 chapters, losing no events.
  const prs = [];
  for (let h = 0; h < 20; h++) {
    prs.push({ repo: "o/a", number: h, title: `pr${h}`, url: "", mergedAt: at(h, 0) });
  }
  const events = dayEvents({ prsMerged: prs, factsHash: "h", refreshedAt: at(23) }, emptyBreakdown(), DAY);
  const chapters = deriveChapters(events, 0);
  assert.ok(chapters.length <= 6, `expected <=6 chapters, got ${chapters.length}`);
  const kept = chapters.reduce((n, c) => n + c.events.length, 0);
  assert.equal(kept, events.length, "folding must never drop an event");
  const ordinals = chapters.map((c) => c.ordinal);
  assert.deepEqual(ordinals, [...ordinals].sort(), "chapters stay in chronological order");
}

// ── histogram + window ──────────────────────────────────────────────────────
{
  const events = dayEvents(
    {
      prsMerged: [
        { repo: "o/a", number: 1, title: "a", url: "", mergedAt: at(9, 0) },
        { repo: "o/a", number: 2, title: "b", url: "", mergedAt: at(14, 0) },
        { repo: "o/a", number: 3, title: "c", url: "", mergedAt: at(14, 30) },
        { repo: "o/a", number: 4, title: "d", url: "", mergedAt: at(15, 0) },
      ],
      factsHash: "h",
      refreshedAt: at(23),
    },
    emptyBreakdown(),
    DAY,
  );

  const { hours, counts } = hourHistogram(events);
  assert.equal(hours.length, 24);
  assert.equal(counts[14], 2, "two merges land in the 14:00 bucket");
  assert.equal(hours[14], 1, "the busiest hour normalizes to 1");
  assert.equal(hours[9], 0.5);
  assert.equal(hours[3], 0, "quiet hours are 0, never NaN");

  const win = deriveWindow(events, counts);
  assert.equal(win.busiestHour, 14);
  assert.equal(win.peakLabel, "14:00");
  assert.equal(win.coverageHours, 3, "09, 14, 15");
  assert.equal(win.longestRunHours, 2, "14 and 15 are consecutive");
  assert.equal(win.spanMinutes, 6 * 60, "09:00 → 15:00");

  const quiet = deriveWindow([], new Array(24).fill(0));
  assert.equal(quiet.firstAt, null);
  assert.equal(quiet.mergesPerHour, 0, "an empty day must not divide by zero");
  assert.equal(quiet.busiestHour, null);
}

// ── swimlanes ───────────────────────────────────────────────────────────────
{
  const payload = {
    prsMerged: [
      { repo: "o/a", number: 1, title: "a", url: "", mergedAt: at(10, 0) },
      { repo: "o/a", number: 2, title: "b", url: "", mergedAt: at(16, 0) },
    ],
    sessionGroups: [
      {
        key: "/a",
        label: "a",
        additions: 500,
        deletions: 100,
        sessions: [
          { id: "s1", title: "one", familiarId: "cody", additions: 300, deletions: 60, pr: { repo: "o/a", number: 1 } },
          { id: "s2", title: "two", familiarId: "cody", additions: 200, deletions: 40, pr: { repo: "o/a", number: 2 } },
          { id: "s3", title: "three", familiarId: "sage", additions: 10, deletions: 2 },
        ],
      },
    ],
    factsHash: "h",
    refreshedAt: at(23),
  };
  const events = dayEvents(payload, emptyBreakdown(), DAY);
  const lanes = deriveSwimlanes(payload, events, (id) => id.toUpperCase());

  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].name, "CODY", "lanes resolve display names through the caller");
  assert.equal(lanes[0].mergeCount, 2);
  assert.equal(lanes[0].sessionCount, 2);
  assert.equal(lanes[0].additions, 500);
  assert.ok(lanes[0].span, "a familiar with timestamped work gets a span");
  assert.ok(Math.abs(lanes[0].span.leftPct - (600 / 1440) * 100) < 0.001, "span starts at its first event");
  assert.equal(lanes[0].marks.length, 2, "each merge is a mark");

  const sage = lanes.find((l) => l.familiarId === "sage");
  assert.equal(sage.span, null, "untimestamped work yields no bar rather than a fake one");
  assert.equal(sage.sessionCount, 1);
}

// ── shipped ─────────────────────────────────────────────────────────────────
{
  const shipped = deriveShipped({
    prsMerged: [
      { repo: "OpenCoven/coven-landing", number: 51, title: "Reforged", url: "u2", mergedAt: at(22, 7) },
      { repo: "OpenCoven/coven", number: 505, title: "transforms", url: "u1", mergedAt: at(14, 22) },
    ],
    sessionGroups: [
      {
        key: "/coven",
        label: "coven",
        additions: 310,
        deletions: 96,
        sessions: [
          { id: "s1", title: "t", additions: 310, deletions: 96, pr: { repo: "OpenCoven/coven", number: 505 } },
        ],
      },
    ],
    factsHash: "h",
    refreshedAt: at(23),
  });

  assert.deepEqual(shipped.rows.map((r) => r.number), [505, 51], "rows sort by merge time");
  assert.equal(shipped.rows[0].repoLabel, "coven", "repo chips use the basename, not owner/name");
  assert.equal(shipped.rows[0].time, "14:22");
  assert.equal(shipped.rows[0].additions, 310, "line counts come from the session that produced the PR");
  assert.equal(shipped.rows[1].additions, null, "a PR with no session keeps null, not a fabricated 0");
  assert.equal(shipped.total, 2);
  assert.deepEqual(shipped.repos.map((r) => r.label).sort(), ["coven", "coven-landing"]);
  assert.equal(shipped.additions, 310, "day totals come from the groups, not just PR-bearing sessions");
  assert.equal(shipped.firstTime, "14:22");
  assert.equal(shipped.lastTime, "22:07");

  const none = deriveShipped(null);
  assert.deepEqual(none.rows, []);
  assert.equal(none.total, 0);
  assert.equal(none.firstTime, null);
}

// ── streak ──────────────────────────────────────────────────────────────────
{
  const slug = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const recent = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(DAY);
    d.setDate(DAY.getDate() - i);
    recent.push({
      date: slug(d),
      slug: slug(d),
      title: "",
      generatedAt: null,
      stats: { reminders: 0, responses: 0, familiars: 0, sessions: 3, prsMerged: 2 },
      href: "",
    });
  }

  const streak = deriveStreak(recent, DAY);
  assert.equal(streak.current, 5, "five consecutive shipping days");
  assert.equal(streak.days.length, 7, "the rail always shows a trailing week");
  assert.deepEqual(streak.days.slice(2), [true, true, true, true, true]);
  assert.deepEqual(streak.days.slice(0, 2), [false, false], "days with no report are gaps");

  // A quiet day breaks the run.
  const broken = recent.map((r, i) =>
    i === 1 ? { ...r, stats: { reminders: 0, responses: 0, familiars: 0, sessions: 0, prsMerged: 0 } } : r,
  );
  assert.equal(deriveStreak(broken, DAY).current, 1, "the run stops at the first quiet day");

  assert.equal(deriveStreak([], DAY).current, 0, "no history, no streak");
}

// ── the spine (merges collapse per chapter) ─────────────────────────────────
{
  const many = [];
  for (let i = 0; i < 6; i++) {
    many.push({ repo: i < 4 ? "o/a" : "o/b", number: i, title: `pr${i}`, url: "", mergedAt: at(14, i * 5) });
  }
  const events = dayEvents(
    { prsMerged: many, factsHash: "h", refreshedAt: at(23) },
    emptyBreakdown({ reminders: [reminder("r1", 8)] }),
    DAY,
  );
  const chapters = deriveChapters(events, 0);
  const spine = deriveSpine(chapters);

  // The reminder stays itself; six merges in one chapter become one line.
  assert.equal(spine.length, 2, `expected reminder + 1 collapsed merge line, got ${spine.length}`);
  const collapsed = spine[1];
  assert.equal(collapsed.count, 6);
  assert.match(collapsed.label, /^6 merges across 2 repos$/);
  assert.equal(collapsed.detail, "a · b", "the line names repos by basename, as the chips do");
  assert.equal(collapsed.at, at(14, 0), "the line sits at the first merge of its run");
  assert.equal(spine[0].count, 1, "a reminder is never collapsed");
  assert.ok(
    spine.every((e) => e.chapterIndex >= 0 && e.chapterIndex < chapters.length),
    "every spine line points at a real chapter",
  );
  assert.deepEqual(
    spine.map((e) => e.at),
    [...spine.map((e) => e.at)].sort(),
    "the spine stays chronological",
  );
}

{
  // Few merges stay individually named — the detail is worth the line.
  const events = dayEvents(
    {
      prsMerged: [
        { repo: "o/a", number: 1, title: "first", url: "", mergedAt: at(14, 0) },
        { repo: "o/a", number: 2, title: "second", url: "", mergedAt: at(14, 20) },
      ],
      factsHash: "h",
      refreshedAt: at(23),
    },
    emptyBreakdown(),
    DAY,
  );
  const spine = deriveSpine(deriveChapters(events, 0));
  assert.equal(spine.length, 2);
  assert.deepEqual(spine.map((e) => e.label), ["first", "second"]);
  assert.deepEqual(spine.map((e) => e.count), [1, 1]);

  assert.deepEqual(deriveSpine([]), [], "no chapters, no spine");
}

// ── the trailing week ───────────────────────────────────────────────────────
{
  const trend = deriveTrend(
    [
      {
        date: "2026-07-26",
        slug: "2026-07-26",
        title: "",
        generatedAt: null,
        stats: { reminders: 0, responses: 0, familiars: 0, sessions: 4, prsMerged: 9 },
        href: "",
      },
    ],
    DAY,
  );
  assert.equal(trend.length, 7);
  assert.equal(trend[6].slug, "2026-07-27", "the series ends on the report day");
  assert.equal(trend[5].merges, 9);
  assert.equal(trend[5].hasReport, true);
  assert.equal(trend[0].hasReport, false, "a day with no report is a gap");
  assert.equal(trend[0].merges, 0);
}

// ── buildDayModel ───────────────────────────────────────────────────────────
{
  const stats = { reminders: 1, responses: 0, familiars: 0, sessions: 4, prsMerged: 2 };
  const model = buildDayModel({
    stats,
    payload: {
      prsMerged: [
        { repo: "o/a", number: 1, title: "a", url: "", mergedAt: at(10, 0) },
        { repo: "o/a", number: 2, title: "b", url: "", mergedAt: at(16, 0) },
      ],
      sessionGroups: [{ key: "/a", label: "a", additions: 100, deletions: 20, sessions: [] }],
      factsHash: "h",
      refreshedAt: at(23),
    },
    breakdown: emptyBreakdown({ reminders: [reminder("r1", 8)] }),
    recent: [
      {
        date: "2026-07-26",
        slug: "2026-07-26",
        title: "",
        generatedAt: null,
        stats: { reminders: 0, responses: 0, familiars: 0, sessions: 2, prsMerged: 5 },
        href: "",
      },
    ],
    day: DAY,
    items: [],
  });

  assert.equal(model.quiet, false);
  assert.equal(model.additions, 100);
  assert.equal(model.projectCount, 1);
  assert.equal(model.deltas.sessions.label, "+2 vs yesterday");
  assert.equal(model.deltas.sessions.tone, "success");
  assert.equal(model.deltas.prsMerged.label, "−3 vs yesterday", "a drop reads muted, not alarming");
  assert.equal(model.deltas.prsMerged.tone, "muted");
  assert.ok(model.chapters.length > 0);
  assert.equal(model.events.length, 3, "every timestamped event is kept for the chapter views");
  assert.equal(model.spine.length, 3, "two merges is under the collapse threshold");
  assert.equal(model.trend.length, 7);
  assert.equal(model.trend[5].merges, 5, "yesterday's merges come from the recent series");

  // Quiet day: every chart-facing field degrades to an empty-but-valid shape.
  const quiet = buildDayModel({
    stats: { reminders: 0, responses: 0, familiars: 0, sessions: 0 },
    payload: null,
    breakdown: emptyBreakdown(),
    recent: [],
    day: DAY,
    items: [],
  });
  assert.equal(quiet.quiet, true);
  assert.deepEqual(quiet.chapters, []);
  assert.deepEqual(quiet.spine, []);
  assert.deepEqual(quiet.events, []);
  assert.equal(quiet.trend.length, 7, "the trend is always a full week, even when empty");
  assert.ok(quiet.trend.every((t) => !t.hasReport));
  assert.deepEqual(quiet.swimlanes, []);
  assert.equal(quiet.hours.length, 24);
  assert.equal(quiet.window.firstAt, null);
  assert.equal(quiet.deltas.sessions, null, "no history means no delta claim");
  assert.equal(quiet.shipped.total, 0);
}

// ── next reminder ───────────────────────────────────────────────────────────
{
  const now = new Date(2026, 6, 27, 12, 0);
  const model = buildDayModel({
    stats: { reminders: 0, responses: 0, familiars: 0, sessions: 0 },
    payload: null,
    breakdown: emptyBreakdown(),
    recent: [],
    day: DAY,
    now,
    items: [
      { ...reminder("past", 9), status: "pending", fireAt: at(9, 0) },
      { ...reminder("soon", 15), status: "pending", fireAt: at(15, 0) },
      { ...reminder("later", 18), status: "pending", fireAt: at(18, 0) },
      { ...reminder("done", 16), status: "fired", fireAt: at(16, 0) },
    ],
  });
  assert.equal(model.carries.nextReminder.id, "soon", "the next reminder is the soonest still ahead");
}

console.log("daily-report-day.test.ts: ok");
