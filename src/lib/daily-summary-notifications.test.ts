// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildDailySummaryContent,
  buildDailySummaryNotification,
  dailySummaryAutoKey,
  reportSessionTitle,
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

// The content builder skips the auto-key dedup so the refresh path can rebuild
// today's report in place.
const refreshed = buildDailySummaryContent({
  now,
  items: [{ ...baseItem, auto: dailySummaryAutoKey(now) }],
  sessions: [],
});
assert.ok(refreshed, "content builder should rebuild even when today's report already exists");
assert.equal(
  buildDailySummaryContent({ now, items: [], sessions: [] }),
  null,
  "content builder should still return null on an empty day",
);

// Session-title hygiene: harness transcripts leak markdown into titles.
assert.equal(
  reportSessionTitle({ title: "## Prior conversation **User:** Merge PR #26 **" }),
  "Untitled session",
  "prior-conversation preamble leaks should fall back to a neutral title",
);
assert.equal(
  reportSessionTitle({ title: "## Fix the **flaky** `packEventColumns` test" }),
  "Fix the flaky packEventColumns test",
  "markdown syntax should be stripped, not rendered as literal characters",
);
assert.equal(reportSessionTitle({ title: "   " }), "Untitled session");
const longTitle = "Refactor the entire inbox scheduler pipeline to support recurrence windows and quiet hours";
assert.ok(
  reportSessionTitle({ title: longTitle }).length <= 64,
  "report titles should truncate to a report-sized string",
);
assert.match(reportSessionTitle({ title: longTitle }), /…$/);

const sessionAt = (id, title, hoursAgo) => ({
  id,
  title,
  status: "completed",
  updated_at: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString(),
  created_at: "2026-06-18T08:00:00.000Z",
  project_root: "/repo/coven-cave",
  harness: "codex",
  model: "gpt-5",
  exit_code: 0,
  archived_at: null,
  familiarId: "sage",
});
const hygieneDraft = buildDailySummaryContent({
  now,
  items: [],
  sessions: [
    sessionAt("h1", "## Prior conversation **User:** Merge PR #26 **", 1),
    sessionAt("h2", "Refresh task: Wire Cave", 2),
    sessionAt("h3", "refresh task: wire cave", 3),
    sessionAt("h4", "Ship calendar fixes", 4),
    sessionAt("h5", "Audit the flow surface", 5),
    sessionAt("h6", "Polish marketplace cards", 6),
    sessionAt("h7", "Tune terminal mirror", 7),
    sessionAt("h8", "Rework project picker", 8),
    sessionAt("h9", "Harden avatar storage", 9),
  ],
});
assert.ok(hygieneDraft);
assert.doesNotMatch(
  hygieneDraft.body,
  /Prior conversation|##|\*\*/,
  "the Recent line must not leak raw markdown from session titles",
);
assert.equal(
  hygieneDraft.body.match(/Refresh task: Wire Cave/gi)?.length ?? 0,
  1,
  "repeated session titles should be deduped case-insensitively",
);
const recentLine = hygieneDraft.body.split("\n").find((line) => line.startsWith("Recent:")) ?? "";
assert.equal(
  recentLine.split(" · ").length,
  6,
  "the Recent line should cap at 6 deduped sessions",
);
assert.doesNotMatch(recentLine, /Harden avatar storage/, "sessions past the cap are dropped");

// ── Day-in-review extras (Phase B) ──────────────────────────────────────────
const extras = {
  prsMerged: [
    {
      repo: "OpenCoven/coven-cave",
      number: 2497,
      title: "keep today's report live",
      url: "https://github.com/OpenCoven/coven-cave/pull/2497",
      mergedAt: "2026-06-18T17:00:00.000Z",
    },
  ],
  cardsCompleted: [
    { id: "c1", title: "Ship it", projectId: null, familiarId: null, completedAt: "2026-06-18T15:00:00.000Z" },
    { id: "c2", title: "Close it", projectId: null, familiarId: null, completedAt: "2026-06-18T16:00:00.000Z" },
  ],
};
const enriched = buildDailySummaryContent({
  now,
  items: [],
  sessions: [sessionAt("e1", "Ship the parser", 1)],
  extras,
});
assert.ok(enriched);
assert.match(enriched.body, /1 PR merged/, "body should carry the merged-PR count line");
assert.match(enriched.body, /2 cards completed/, "body should carry the completed-cards count line");
assert.equal(enriched.media.stats.prsMerged, 1, "stats should freeze the merged-PR count");
assert.equal(enriched.media.stats.cardsCompleted, 2, "stats should freeze the completed-card count");
assert.equal(
  enriched.media.report?.prsMerged?.[0]?.number,
  2497,
  "media.report should carry the structured merged PRs",
);
assert.equal(
  enriched.media.report?.sessionGroups?.[0]?.sessions?.[0]?.title,
  "Ship the parser",
  "media.report should carry sessions grouped by project",
);
assert.ok(enriched.media.report?.factsHash, "media.report should carry a facts hash");
assert.match(
  decodeURIComponent(enriched.media.imageUrl),
  /prs merged/,
  "the generated card should show the day-in-review row when sources were consulted",
);

// Sources not consulted → no count lines, no claims (absent, not zero).
const unenriched = buildDailySummaryContent({
  now,
  items: [],
  sessions: [sessionAt("e2", "Ship the parser", 1)],
});
assert.ok(unenriched);
assert.doesNotMatch(unenriched.body, /PRs? merged|cards? completed/);
assert.equal(unenriched.media.stats.prsMerged, undefined);
assert.doesNotMatch(decodeURIComponent(unenriched.media.imageUrl), /prs merged/);

// A day with nothing client-visible but merged PRs still deserves a report.
const prOnly = buildDailySummaryContent({ now, items: [], sessions: [], extras });
assert.ok(prOnly, "a PR-only day should still produce a report");


// Zero/zero diffs are daemon boilerplate — the Recent line must not read "(+0 -0)".
{
  const zeroDiff = buildDailySummaryContent({
    now,
    items: [],
    sessions: [{ ...sessionAt("z1", "Quiet session", 1), diff: { additions: 0, deletions: 0 } }],
  });
  assert.doesNotMatch(zeroDiff.body, /\(\+0 -0\)/, "zero/zero diffs are noise, not signal");
}

console.log("daily-summary-notifications.test.ts: ok");
