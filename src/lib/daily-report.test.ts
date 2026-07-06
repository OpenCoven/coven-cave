// @ts-nocheck
import assert from "node:assert/strict";
import {
  breakdownForDay,
  dateSlug,
  itemHasTarget,
  itemHref,
  liveSnapshot,
  longDateLabel,
  parseDateSlug,
  parseRecentSessions,
  parseStatsFromBody,
  recentReports,
  relativeDayLabel,
  relativeTime,
} from "./daily-report.ts";

function item(overrides) {
  return {
    id: overrides.id ?? "x",
    kind: "reminder",
    title: "T",
    status: "fired",
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T12:00:00.000Z",
    firedAt: "2026-06-18T12:00:00.000Z",
    recurrence: { type: "none" },
    source: "user",
    link: null,
    auto: null,
    ...overrides,
  };
}

// parseDateSlug -------------------------------------------------------------
{
  const d = parseDateSlug("2026-06-18");
  assert.ok(d, "valid slug parses");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5);
  assert.equal(d.getDate(), 18);
  assert.equal(parseDateSlug("nonsense"), null, "garbage slug rejected");
  assert.equal(parseDateSlug("2026-13-40"), null, "out-of-range slug rejected");
  assert.equal(dateSlug(d), "2026-06-18", "round-trips through dateSlug");
}

// labels --------------------------------------------------------------------
{
  const d = new Date(2026, 5, 18, 9, 0, 0);
  assert.match(longDateLabel(d), /2026/, "long label includes year");
  assert.equal(relativeDayLabel(d, d), "Today");
  assert.equal(
    relativeDayLabel(new Date(2026, 5, 17), new Date(2026, 5, 18)),
    "Yesterday",
  );
}

// relativeTime --------------------------------------------------------------
{
  const now = new Date("2026-06-18T12:00:00.000Z");
  assert.equal(relativeTime("2026-06-18T11:58:30.000Z", now), "2m ago");
  assert.equal(relativeTime("2026-06-18T09:00:00.000Z", now), "3h ago");
  assert.equal(relativeTime(null, now), "");
}

// itemHref / itemHasTarget --------------------------------------------------
{
  assert.equal(itemHref(item({ link: { kind: "card", ref: "c1" } })), "/#card-c1");
  assert.equal(itemHref(item({ link: { kind: "session", ref: "s1" } })), "/#chat-s1");
  assert.equal(
    itemHref(item({ link: { kind: "memory", ref: "a/b c" } })),
    "/#memory:a%2Fb%20c",
  );
  assert.equal(itemHref(item({ link: { kind: "url", ref: "https://x" } })), "https://x");
  assert.equal(itemHref(item({ sessionId: "sess9", link: null })), "/#chat-sess9");
  assert.equal(itemHref(item({ link: null })), "/", "no target falls back to home");
  assert.equal(itemHasTarget(item({ link: { kind: "card", ref: "c1" } })), true);
  assert.equal(itemHasTarget(item({ link: null })), false);
}

// breakdownForDay -----------------------------------------------------------
{
  const day = new Date(2026, 5, 18);
  const items = [
    item({ id: "r1", kind: "reminder", status: "fired" }),
    item({ id: "r2", kind: "reminder", status: "done" }), // excluded (not fired)
    item({ id: "resp1", kind: "response-needed", status: "pending" }),
    item({ id: "fam1", kind: "agent", status: "fired" }),
    item({
      id: "old",
      kind: "reminder",
      status: "fired",
      firedAt: "2026-06-10T12:00:00.000Z",
      updatedAt: "2026-06-10T12:00:00.000Z",
    }), // excluded (different day)
  ];
  const b = breakdownForDay(items, day);
  assert.equal(b.reminders.length, 1, "one fired reminder this day");
  assert.equal(b.responses.length, 1, "one waiting response");
  assert.equal(b.familiars.length, 1, "one familiar update");
  assert.equal(b.openItems.length, 2, "open = response + fired reminder");
  assert.ok(
    b.openItems.every((it) => it.status === "pending" || it.status === "fired"),
    "open items are only pending/fired",
  );
}

// liveSnapshot --------------------------------------------------------------
{
  const now = new Date();
  const todayIso = now.toISOString();
  const snap = liveSnapshot(
    [item({ id: "r", kind: "reminder", status: "fired", firedAt: todayIso, updatedAt: todayIso })],
    now,
  );
  assert.equal(snap.reminders, 1);
  assert.equal(snap.sessions, 0, "sessions live behind daemon → 0 here");
}

// recentReports -------------------------------------------------------------
{
  const reports = recentReports([
    item({
      id: "d1",
      kind: "daily-summary",
      auto: "daily-summary:2026-06-17",
      title: "Daily summary · Jun 17",
      media: { kind: "summary-card", imageUrl: "", alt: "", stats: { reminders: 2, responses: 1, familiars: 0, sessions: 3 }, generatedAt: "" },
    }),
    item({
      id: "d2",
      kind: "daily-summary",
      auto: "daily-summary:2026-06-18",
      title: "Daily summary · Jun 18",
    }),
    item({ id: "r", kind: "reminder", auto: null }), // not a report
  ]);
  assert.equal(reports.length, 2, "only daily-summary items");
  assert.equal(reports[0].slug, "2026-06-18", "newest first");
  assert.equal(reports[0].href, "/daily-report/2026-06-18");
  assert.equal(reports[1].stats.sessions, 3, "stats carried through");
}

// parseRecentSessions -------------------------------------------------------
{
  const body = "1 reminder fired\n2 sessions updated\nRecent: Fix auth (+12 -3) · Polish board";
  const sessions = parseRecentSessions(body);
  assert.deepEqual(sessions, ["Fix auth (+12 -3)", "Polish board"]);
  assert.deepEqual(parseRecentSessions("no recent line"), []);
  assert.deepEqual(parseRecentSessions(undefined), []);
}

// parseStatsFromBody --------------------------------------------------------
{
  const body = "0 reminders fired\n0 responses waiting\n1 familiar updates\n8 sessions updated\nRecent: a · b";
  assert.deepEqual(parseStatsFromBody(body), { reminders: 0, responses: 0, familiars: 1, sessions: 8 });
  // tolerant of singular/plural wording
  assert.deepEqual(parseStatsFromBody("1 reminder fired\n1 session updated"), { reminders: 1, responses: 0, familiars: 0, sessions: 1 });
  // no count lines → null (don't fabricate zeros for a non-summary body)
  assert.equal(parseStatsFromBody("just some prose, nothing countable"), null);
  assert.equal(parseStatsFromBody(undefined), null);

  // day-in-review lines (Phase B) are optional: parsed when present, absent —
  // not zero — when the body predates them or the source wasn't consulted.
  const enriched = parseStatsFromBody(
    "0 reminders fired\n0 responses waiting\n0 familiar updates\n3 sessions updated\n12 PRs merged\n1 card completed",
  );
  assert.equal(enriched.prsMerged, 12);
  assert.equal(enriched.cardsCompleted, 1);
  const legacy = parseStatsFromBody("1 reminder fired\n1 session updated");
  assert.equal("prsMerged" in legacy, false, "old bodies must not grow fabricated zero counts");

  // recentReports recovers stats from the body when media.stats is absent
  const reports = recentReports([
    item({
      id: "d",
      kind: "daily-summary",
      auto: "daily-summary:2026-06-18",
      title: "Daily summary · Jun 18",
      body: "0 reminders fired\n0 responses waiting\n0 familiar updates\n5 sessions updated",
    }),
  ]);
  assert.equal(reports[0].stats.sessions, 5, "stats recovered from body when media.stats absent");
}

console.log("daily-report.test.ts: ok");
