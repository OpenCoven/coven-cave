// @ts-nocheck
import assert from "node:assert/strict";
import { buildDashboardModel } from "./dashboard-model.ts";
import { nextItemsAfterAction } from "./dashboard-model.ts";

const ISO = "2026-06-20T09:00:00.000Z";
const now = new Date(ISO);

function item(over) {
  return {
    id: over.id ?? "x",
    kind: over.kind ?? "reminder",
    title: over.title ?? "t",
    status: over.status ?? "fired",
    createdAt: ISO,
    updatedAt: ISO,
    firedAt: ISO,
    recurrence: null,
    source: "user",
    ...over,
  };
}

function summary(slug) {
  return item({
    id: `s-${slug}`,
    kind: "daily-summary",
    title: `Report ${slug}`,
    auto: `daily-summary:${slug}`,
    media: { kind: "summary-card", imageUrl: "", alt: "", stats: { reminders: 1, responses: 2, familiars: 0, sessions: 3 }, generatedAt: ISO },
  });
}

// caughtUp true when no open reminders/responses
{
  const model = buildDashboardModel([summary("2026-06-19")], now);
  assert.equal(model.caughtUp, true, "no open items => caught up");
  assert.equal(model.needsAttention.length, 0);
  assert.equal(model.openCount, 0, "openCount is 0 when caught up");
}

// busy when a response is pending today
{
  const model = buildDashboardModel(
    [item({ id: "r1", kind: "response-needed", status: "pending" })],
    now,
  );
  assert.equal(model.caughtUp, false, "open item => busy");
  assert.equal(model.needsAttention.length, 1);
}

// needsAttention is capped at 8, but openCount reports the true total
{
  const many = Array.from({ length: 12 }, (_, i) =>
    item({ id: `r${i}`, kind: "response-needed", status: "pending" }),
  );
  const model = buildDashboardModel(many, now);
  assert.equal(model.needsAttention.length, 8, "needsAttention capped at 8");
  assert.equal(model.openCount, 12, "openCount is uncapped");
  assert.equal(model.caughtUp, false);
}

// today's report becomes featuredReport and is excluded from recentReports
{
  const model = buildDashboardModel([summary("2026-06-20"), summary("2026-06-19")], now);
  assert.equal(model.featuredReport?.slug, "2026-06-20");
  assert.deepEqual(model.recentReports.map((r) => r.slug), ["2026-06-19"]);
}

// today's summary is folded in from today's report
{
  const today = item({
    id: "s-2026-06-20",
    kind: "daily-summary",
    title: "Report 2026-06-20",
    body: "You shipped 3 things.\nRecent: alpha · beta",
    auto: "daily-summary:2026-06-20",
    media: { kind: "summary-card", imageUrl: "img.png", alt: "card", stats: { reminders: 1, responses: 2, familiars: 4, sessions: 3 }, generatedAt: ISO },
  });
  const model = buildDashboardModel([today], now);
  assert.ok(model.todaySummary, "today summary present when today's report exists");
  assert.equal(model.todaySummary.imageUrl, "img.png");
  assert.deepEqual(model.todaySummary.recentSessions, ["alpha", "beta"], "recovers session names from body");
}

// before today's report exists, metrics fall back to the live snapshot
{
  const model = buildDashboardModel(
    [item({ id: "rem", kind: "reminder", status: "fired" })],
    now,
  );
  assert.equal(model.todaySummary, null, "no today summary before a report generates");
}

// with no today report, latest is featured
{
  const model = buildDashboardModel([summary("2026-06-19"), summary("2026-06-18")], now);
  assert.equal(model.featuredReport?.slug, "2026-06-19");
  assert.deepEqual(model.recentReports.map((r) => r.slug), ["2026-06-18"]);
}

// acting on an item removes exactly it, preserving the order of the rest
{
  const list = [
    item({ id: "a", kind: "response-needed", status: "pending" }),
    item({ id: "b", kind: "response-needed", status: "pending" }),
    item({ id: "c", kind: "response-needed", status: "pending" }),
  ];
  const after = nextItemsAfterAction(list, "b");
  assert.deepEqual(after.map((i) => i.id), ["a", "c"], "removes acted item, keeps order");
  assert.equal(list.length, 3, "does not mutate input");
}

// unknown id is a no-op
{
  const list = [item({ id: "a" })];
  assert.equal(nextItemsAfterAction(list, "zzz").length, 1, "unknown id => unchanged");
}

console.log("dashboard-model.test.ts: ok");
