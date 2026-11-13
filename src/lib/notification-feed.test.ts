// @ts-nocheck
// The bell's arrangement (#6483): Needs you first, daily reports folded into
// one row, everything else by day.
import assert from "node:assert/strict";
import { collapseInboxSeries } from "./inbox-feed.ts";
import {
  buildNotificationSections,
  foldDailyReports,
  notificationDay,
  notificationRowItems,
  notificationRowLatest,
  notificationRowNeedsYou,
} from "./notification-feed.ts";

const NOW = new Date(2026, 10, 12, 15, 0, 0).getTime(); // Nov 12, 3pm local
const at = (dayOffset, hour = 10) => new Date(2026, 10, 12 + dayOffset, hour, 0, 0).toISOString();

const item = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  kind: over.kind ?? "agent",
  title: over.title ?? "t",
  status: over.status ?? "fired",
  createdAt: over.createdAt ?? at(0),
  updatedAt: over.updatedAt ?? at(0),
  firedAt: over.firedAt ?? at(0),
  fireAt: over.fireAt ?? null,
  recurrence: over.recurrence ?? { type: "none" },
  source: over.source ?? "system",
  ...over,
});

const report = (dayOffset) =>
  item({
    id: `report-${dayOffset}`,
    kind: "daily-summary",
    title: `Daily summary · Nov ${12 + dayOffset}`,
    firedAt: at(dayOffset, 21),
    updatedAt: at(dayOffset, 21),
    auto: `daily-summary:2026-11-${12 + dayOffset}`,
  });

// ── Four daily reports become one row, newest on top ───────────────────────
{
  const feed = [report(0), report(-1), report(-2), report(-3)];
  const rows = foldDailyReports(collapseInboxSeries(feed));
  assert.equal(rows.length, 1, "every daily report folds into a single row");
  assert.equal(rows[0].kind, "reports");
  assert.equal(notificationRowLatest(rows[0]).id, "report-0", "the row shows the newest report");
  assert.deepEqual(
    notificationRowItems(rows[0]).map((i) => i.id),
    ["report-0", "report--1", "report--2", "report--3"],
    "Read and Dismiss act on every folded report, newest first",
  );
}

// ── The reports row sits where its newest report was; others keep order ────
{
  const feed = [item({ id: "a", firedAt: at(0, 14) }), report(0), item({ id: "b", firedAt: at(0, 9) }), report(-1)];
  const rows = foldDailyReports(collapseInboxSeries(feed));
  assert.deepEqual(rows.map((r) => r.id), ["a", "daily-reports", "b"]);
}

// ── Needs you: waiting replies and past-due reminders, never reports ───────
{
  const waiting = item({ id: "eph:response-needed:sage", kind: "response-needed", status: "pending", firedAt: null });
  const pastDue = item({ id: "due", kind: "reminder", status: "fired", fireAt: at(-1, 9), firedAt: at(-1, 9) });
  const update = item({ id: "update", kind: "agent", firedAt: at(0, 12) });
  const groups = collapseInboxSeries([waiting, update, report(0), pastDue]);
  const sections = buildNotificationSections(groups, NOW);
  assert.deepEqual(sections.needsYou.map((r) => r.id), ["eph:response-needed:sage", "due"]);
  assert.equal(sections.total, 4);
  const todayIds = sections.updates.find((d) => d.day === "today").rows.map((r) => r.id);
  assert.deepEqual(todayIds, ["daily-reports", "update"], "today's updates, newest first");
  assert.ok(!sections.needsYou.some((r) => r.kind === "reports"), "a report is read, not answered");
  assert.equal(notificationRowNeedsYou({ kind: "reports", id: "x", latest: report(0), items: [report(0)] }, NOW), false);
}

// ── Day headings follow local calendar days; empty days are omitted ────────
{
  assert.equal(notificationDay(new Date(2026, 10, 12, 0, 5).getTime(), NOW), "today");
  assert.equal(notificationDay(new Date(2026, 10, 11, 23, 59).getTime(), NOW), "yesterday");
  assert.equal(notificationDay(new Date(2026, 10, 10, 12, 0).getTime(), NOW), "earlier");

  const groups = collapseInboxSeries([
    item({ id: "old", firedAt: at(-5) }),
    item({ id: "y", firedAt: at(-1) }),
  ]);
  const sections = buildNotificationSections(groups, NOW);
  assert.deepEqual(sections.updates.map((d) => d.label), ["Yesterday", "Earlier"], "no Today heading without today's rows");
}

// ── A repeating schedule stays one row, under its newest occurrence's day ──
{
  const recurrence = { type: "daily", time: "09:00" };
  const groups = collapseInboxSeries([
    item({ id: "s2", kind: "agent", title: "Stand-up", recurrence, firedAt: at(0, 9) }),
    item({ id: "s1", kind: "agent", title: "Stand-up", recurrence, firedAt: at(-1, 9) }),
  ]);
  const sections = buildNotificationSections(groups, NOW);
  assert.equal(sections.total, 1);
  assert.equal(sections.updates[0].day, "today");
  assert.equal(notificationRowItems(sections.updates[0].rows[0]).length, 2);
}

// ── The row limit never cuts Needs you; updates keep the newest ────────────
{
  const asks = [1, 2].map((n) => item({ id: `ask-${n}`, kind: "response-needed", status: "pending", firedAt: null }));
  const updates = [0, 1, 2, 3].map((n) => item({ id: `u-${n}`, firedAt: at(0, 14 - n) }));
  const sections = buildNotificationSections(collapseInboxSeries([...asks, ...updates]), NOW, 4);
  assert.equal(sections.needsYou.length, 2, "every ask is shown");
  assert.deepEqual(sections.updates.flatMap((d) => d.rows.map((r) => r.id)), ["u-0", "u-1"], "the newest updates fill the rest");
  assert.equal(sections.hidden, 2, "the older updates are counted, not lost");
  assert.equal(sections.total, 6);
  const tight = buildNotificationSections(collapseInboxSeries([...asks, ...updates]), NOW, 1);
  assert.equal(tight.needsYou.length, 2, "a limit smaller than Needs you still shows every ask");
  assert.equal(tight.hidden, 4);
}

console.log("notification-feed.test.ts: ok");
