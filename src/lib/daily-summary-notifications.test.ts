// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildDailySummaryNotification,
  dailySummaryAutoKey,
  shouldCreateDailySummary,
} from "./daily-summary-notifications.ts";

const now = new Date("2026-06-18T21:15:00.000Z");

const baseItem = {
  id: "item-1",
  kind: "reminder",
  title: "Review release notes",
  body: "Check pending changelog edits",
  status: "fired",
  createdAt: "2026-06-18T12:00:00.000Z",
  updatedAt: "2026-06-18T15:00:00.000Z",
  fireAt: "2026-06-18T15:00:00.000Z",
  firedAt: "2026-06-18T15:00:00.000Z",
  snoozeUntil: null,
  recurrence: { type: "none" },
  source: "user",
  familiarId: "sage",
  sessionId: null,
  link: null,
  auto: null,
};

const draft = buildDailySummaryNotification({
  now,
  items: [
    baseItem,
    {
      ...baseItem,
      id: "item-2",
      title: "Follow up on stuck run",
      kind: "response-needed",
      status: "pending",
      firedAt: null,
    },
    {
      ...baseItem,
      id: "old",
      title: "Yesterday",
      firedAt: "2026-06-17T15:00:00.000Z",
      updatedAt: "2026-06-17T15:00:00.000Z",
    },
  ],
  sessions: [
    {
      id: "s1",
      title: "Fix board chat route",
      status: "completed",
      updated_at: "2026-06-18T20:00:00.000Z",
      created_at: "2026-06-18T19:00:00.000Z",
      project_root: "/repo/coven-cave",
      harness: "codex",
      model: "gpt-5",
      exit_code: 0,
      archived_at: null,
      familiarId: "sage",
      diff: { additions: 12, deletions: 3 },
    },
    {
      id: "s2",
      title: "Archive old capture",
      status: "done",
      updated_at: "2026-06-18T18:00:00.000Z",
      created_at: "2026-06-18T17:00:00.000Z",
      project_root: "/repo/coven-cave",
      harness: "codex",
      model: "gpt-5",
      exit_code: 0,
      archived_at: null,
      familiarId: "nova",
    },
  ],
});

assert.ok(draft, "daily summary should be created when today has inbox or session activity");
assert.equal(draft.kind, "daily-summary");
assert.equal(draft.source, "system");
assert.equal(draft.status, "fired");
assert.equal(draft.auto, dailySummaryAutoKey(now));
assert.deepEqual(
  draft.link,
  { kind: "url", ref: "/daily-report/2026-06-18" },
  "daily summary notifications should open their dedicated daily report page",
);
assert.equal(draft.media?.kind, "summary-card");
assert.equal(draft.media?.stats.reminders, 1);
assert.equal(draft.media?.stats.responses, 1);
assert.equal(draft.media?.stats.sessions, 2);
assert.match(draft.media?.alt ?? "", /Daily summary/);
assert.match(draft.media?.imageUrl ?? "", /^data:image\/svg\+xml/);
assert.match(draft.title, /Daily summary/);
assert.match(draft.body, /1 reminder fired/);
assert.match(draft.body, /1 response waiting/);
assert.match(draft.body, /2 sessions updated/);
assert.match(draft.body, /Fix board chat route/);
assert.match(draft.body, /\+12 -3/);

assert.equal(
  shouldCreateDailySummary([{ ...baseItem, auto: dailySummaryAutoKey(now) }], now),
  false,
  "existing daily summary auto key should suppress duplicate creation",
);

assert.equal(
  buildDailySummaryNotification({ now, items: [], sessions: [] }),
  null,
  "empty days should not produce a noisy daily summary notification",
);

console.log("daily-summary-notifications.test.ts: ok");
