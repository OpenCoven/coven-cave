// @ts-nocheck
import assert from "node:assert/strict";
import { buildDashboardModel, dashboardLayout } from "./dashboard-model.ts";

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
  assert.deepEqual(dashboardLayout(model), ["caughtUpStrip", "reportCallout", "launcher", "recentReports"]);
}

// busy when a response is pending today
{
  const model = buildDashboardModel(
    [item({ id: "r1", kind: "response-needed", status: "pending" })],
    now,
  );
  assert.equal(model.caughtUp, false, "open item => busy");
  assert.equal(model.needsAttention.length, 1);
  assert.deepEqual(dashboardLayout(model), ["actionInbox", "reportCallout", "launcher"]);
}

// needsAttention is capped at 8
{
  const many = Array.from({ length: 12 }, (_, i) =>
    item({ id: `r${i}`, kind: "response-needed", status: "pending" }),
  );
  const model = buildDashboardModel(many, now);
  assert.equal(model.needsAttention.length, 8, "needsAttention capped at 8");
  assert.equal(model.caughtUp, false);
}

// today's report becomes featuredReport and is excluded from recentReports
{
  const model = buildDashboardModel([summary("2026-06-20"), summary("2026-06-19")], now);
  assert.equal(model.todaysReport?.slug, "2026-06-20");
  assert.equal(model.featuredReport?.slug, "2026-06-20");
  assert.deepEqual(model.recentReports.map((r) => r.slug), ["2026-06-19"]);
}

// with no today report, latest is featured
{
  const model = buildDashboardModel([summary("2026-06-19"), summary("2026-06-18")], now);
  assert.equal(model.todaysReport, null);
  assert.equal(model.featuredReport?.slug, "2026-06-19");
  assert.deepEqual(model.recentReports.map((r) => r.slug), ["2026-06-18"]);
}

console.log("dashboard-model.test.ts: ok");
