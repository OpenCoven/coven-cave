// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildInboxGroups,
  collapseInboxSeries,
  groupInboxFeed,
  INBOX_GROUP_BY_OPTIONS,
  inboxActivityTime,
  inboxKindLabel,
  inboxSeriesKey,
  isInboxItemPastDue,
  isInboxItemUnread,
  unreadInboxCount,
} from "./inbox-feed.ts";

const item = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  kind: over.kind ?? "reminder",
  title: over.title ?? "t",
  status: over.status ?? "pending",
  createdAt: over.createdAt ?? "2026-06-01T00:00:00Z",
  updatedAt: over.updatedAt ?? "2026-06-01T00:00:00Z",
  recurrence: over.recurrence ?? { type: "none" },
  source: over.source ?? "user",
  ...over,
});

// ── Each item lands in exactly one tier, by status then kind ────────────────
{
  const items = [
    item({ id: "fired", status: "fired" }),
    item({ id: "resp", kind: "response-needed", status: "pending" }),
    item({ id: "pending", status: "pending" }),
    item({ id: "snoozed", status: "snoozed" }),
    item({ id: "done", status: "done" }),
    item({ id: "dismissed", status: "dismissed" }),
  ];
  const g = groupInboxFeed(items);
  assert.deepEqual(g.needsYou.map((i) => i.id).sort(), ["fired", "resp"], "fired + response-needed need you");
  assert.deepEqual(g.active.map((i) => i.id).sort(), ["pending", "snoozed"], "pending/snoozed are active");
  assert.deepEqual(g.resolved.map((i) => i.id).sort(), ["dismissed", "done"], "done/dismissed are resolved");
  // No item is duplicated or dropped across tiers.
  assert.equal(g.needsYou.length + g.active.length + g.resolved.length, items.length);
}

// ── Terminal status wins over kind: a resolved response-needed is resolved ──
{
  const g = groupInboxFeed([
    item({ id: "a", kind: "response-needed", status: "done" }),
    item({ id: "b", kind: "response-needed", status: "dismissed" }),
  ]);
  assert.equal(g.needsYou.length, 0, "resolved response items don't nag");
  assert.deepEqual(g.resolved.map((i) => i.id).sort(), ["a", "b"]);
}

// ── Ordering is most-recent-activity first within a group ────────────────────
{
  const g = groupInboxFeed([
    item({ id: "old", status: "pending", updatedAt: "2026-06-01T00:00:00Z" }),
    item({ id: "new", status: "pending", updatedAt: "2026-06-10T00:00:00Z" }),
    item({ id: "mid", status: "pending", updatedAt: "2026-06-05T00:00:00Z" }),
  ]);
  assert.deepEqual(g.active.map((i) => i.id), ["new", "mid", "old"]);
}

// ── activityTime prefers firedAt > fireAt > updatedAt > createdAt ────────────
{
  assert.equal(
    inboxActivityTime(item({ firedAt: "2026-06-09T00:00:00Z", fireAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-02T00:00:00Z" })),
    Date.parse("2026-06-09T00:00:00Z"),
    "firedAt wins",
  );
  assert.equal(
    inboxActivityTime(item({ firedAt: null, fireAt: "2026-06-03T00:00:00Z", updatedAt: "2026-06-02T00:00:00Z" })),
    Date.parse("2026-06-03T00:00:00Z"),
    "fireAt next",
  );
  assert.equal(
    inboxActivityTime(item({ firedAt: null, fireAt: null, updatedAt: "2026-06-04T00:00:00Z" })),
    Date.parse("2026-06-04T00:00:00Z"),
    "updatedAt next",
  );
  assert.equal(inboxActivityTime(item({ firedAt: null, fireAt: null, updatedAt: "bogus", createdAt: "also-bogus" })), 0, "unparseable ⇒ 0");
}

// ── Empty input → empty groups ──────────────────────────────────────────────
{
  const g = groupInboxFeed([]);
  assert.deepEqual(g, { needsYou: [], active: [], resolved: [] });
}

// ── Kind labels cover every ItemKind ────────────────────────────────────────
{
  assert.equal(inboxKindLabel("reminder"), "Reminder");
  assert.equal(inboxKindLabel("daily-summary"), "Summary");
  assert.equal(inboxKindLabel("response-needed"), "Response");
  assert.equal(inboxKindLabel("agent"), "Agent");
}

// ── Unread: fired without readAt; reading, resolving, or refiring flips it ──
{
  assert.equal(isInboxItemUnread(item({ status: "fired" })), true, "fired + no readAt = unread");
  assert.equal(
    isInboxItemUnread(item({ status: "fired", readAt: null })),
    true,
    "explicit null readAt = unread (pre-upgrade items)",
  );
  assert.equal(
    isInboxItemUnread(item({ status: "fired", readAt: "2026-06-01T00:00:00Z" })),
    false,
    "acknowledged fired item is read",
  );
  assert.equal(isInboxItemUnread(item({ status: "pending" })), false, "not fired yet = not unread");
  assert.equal(
    isInboxItemUnread(item({ status: "dismissed" })),
    false,
    "terminal states never count as unread",
  );
}

// ── unreadInboxCount = unread fired + pending response-needed ───────────────
{
  const items = [
    item({ status: "fired" }), // unread
    item({ status: "fired", readAt: "2026-06-01T00:00:00Z" }), // read
    item({ kind: "response-needed", status: "pending" }), // waiting on a reply
    item({ kind: "response-needed", status: "done" }), // replied — quiet
    item({ status: "pending" }), // not fired yet
    item({ status: "dismissed" }),
  ];
  assert.equal(unreadInboxCount(items), 2, "one unread fired + one pending response-needed");
  assert.equal(unreadInboxCount([]), 0);
}

// ── buildInboxGroups: attention mode mirrors the tiers, empty tiers dropped ──
{
  const groups = buildInboxGroups(
    [
      item({ id: "fired", status: "fired" }),
      item({ id: "pending", status: "pending" }),
    ],
    "attention",
  );
  assert.deepEqual(groups.map((g) => g.id), ["attention:needs-you", "attention:active"], "resolved tier absent when empty");
  assert.equal(groups[0].title, "Needs you");
  assert.equal(groups[0].accent, true, "needs-you keeps the warning badge");
  assert.deepEqual(groups[0].items.map((i) => i.id), ["fired"]);
}

// ── buildInboxGroups: kind mode orders demanding kinds first, recent first ──
{
  const groups = buildInboxGroups(
    [
      item({ id: "sum", kind: "daily-summary", updatedAt: "2026-06-03T00:00:00Z" }),
      item({ id: "rem-old", kind: "reminder", updatedAt: "2026-06-01T00:00:00Z" }),
      item({ id: "rem-new", kind: "reminder", updatedAt: "2026-06-02T00:00:00Z" }),
      item({ id: "resp", kind: "response-needed" }),
    ],
    "kind",
  );
  assert.deepEqual(groups.map((g) => g.id), ["kind:response-needed", "kind:reminder", "kind:daily-summary"]);
  assert.equal(groups[0].title, "Response", "titles reuse inboxKindLabel");
  assert.deepEqual(groups[1].items.map((i) => i.id), ["rem-new", "rem-old"], "kind groups sort by recency");
}

// ── buildInboxGroups: familiar mode labels via callback, unassigned last ────
{
  const groups = buildInboxGroups(
    [
      item({ id: "z1", familiarId: "zelda" }),
      item({ id: "a1", familiarId: "arch" }),
      item({ id: "loose" }),
    ],
    "familiar",
    (fid) => (fid === "arch" ? "Archivist" : fid === "zelda" ? "Zelda" : null),
  );
  assert.deepEqual(groups.map((g) => g.id), ["familiar:arch", "familiar:zelda", "familiar:none"], "alphabetical by label, unassigned trailing");
  assert.equal(groups[0].title, "Archivist");
  assert.equal(groups[2].title, "No familiar");
  assert.deepEqual(groups[2].items.map((i) => i.id), ["loose"]);
}

// ── buildInboxGroups: falls back to the raw familiar id without a label ─────
{
  const groups = buildInboxGroups([item({ id: "x", familiarId: "ghost" })], "familiar");
  assert.equal(groups[0].title, "ghost");
}

// ── every mode partitions: no item duplicated or dropped ────────────────────
{
  const items = [
    item({ id: "a", kind: "agent", status: "fired", familiarId: "f1" }),
    item({ id: "b", kind: "reminder", status: "done" }),
    item({ id: "c", kind: "response-needed", status: "pending", familiarId: "f2" }),
  ];
  for (const mode of ["attention", "kind", "familiar"]) {
    const groups = buildInboxGroups(items, mode);
    const ids = groups.flatMap((g) => g.items.map((i) => i.id)).sort();
    assert.deepEqual(ids, ["a", "b", "c"], `${mode} mode keeps every item exactly once`);
  }
  assert.deepEqual(buildInboxGroups([], "attention"), [], "empty feed → no groups");
}

// ── the group-by options cover every mode exactly once ──────────────────────
{
  assert.deepEqual(INBOX_GROUP_BY_OPTIONS.map((o) => o.value), ["attention", "kind", "familiar"]);
}

// ── inboxSeriesKey: recurring items share a key, one-shots have none ────────
{
  const rec = { type: "daily", hour: 9, minute: 0 };
  const a = item({ id: "a", title: "Stand-up", recurrence: rec, familiarId: "f1" });
  const b = item({ id: "b", title: "  stand-up ", recurrence: rec, familiarId: "f1" });
  assert.equal(inboxSeriesKey(a), inboxSeriesKey(b), "same schedule → same key (title normalized)");
  assert.equal(inboxSeriesKey(item({ recurrence: { type: "none" } })), null, "one-shots have no series");
  assert.equal(inboxSeriesKey(item({ recurrence: undefined, kind: "response-needed" })), null, "missing recurrence → no series");
  assert.notEqual(
    inboxSeriesKey(a),
    inboxSeriesKey(item({ id: "c", title: "Stand-up", recurrence: rec, familiarId: "f2" })),
    "same schedule under a different familiar is a different series",
  );
  assert.notEqual(
    inboxSeriesKey(a),
    inboxSeriesKey(item({ id: "d", title: "Stand-up", recurrence: { type: "daily", hour: 10, minute: 0 }, familiarId: "f1" })),
    "a different recurrence spec is a different series",
  );
}

// ── collapseInboxSeries: occurrences of one schedule become one group ───────
{
  const rec = { type: "daily", hour: 9, minute: 0 };
  const groups = collapseInboxSeries([
    item({ id: "new", title: "Stand-up", recurrence: rec, status: "fired", firedAt: "2026-06-03T09:00:00Z" }),
    item({ id: "solo", title: "One-shot", status: "fired", firedAt: "2026-06-02T12:00:00Z" }),
    item({ id: "old", title: "Stand-up", recurrence: rec, status: "fired", firedAt: "2026-06-01T09:00:00Z" }),
  ]);
  assert.equal(groups.length, 2, "three items collapse to two rows");
  assert.deepEqual(groups[0].items.map((i) => i.id), ["new", "old"], "series holds every occurrence, input order kept");
  assert.equal(groups[0].latest.id, "new", "the newest occurrence fronts the group");
  assert.equal(groups[1].key, null, "the one-shot passes through as a singleton");
  assert.deepEqual(groups[1].items.map((i) => i.id), ["solo"]);
}

// ── collapseInboxSeries: latest wins by activity time, not input order ──────
{
  const rec = { type: "interval", everyMs: 60_000 };
  const groups = collapseInboxSeries([
    item({ id: "older", title: "Ping", recurrence: rec, status: "fired", firedAt: "2026-06-01T00:00:00Z" }),
    item({ id: "newer", title: "Ping", recurrence: rec, status: "fired", firedAt: "2026-06-05T00:00:00Z" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].latest.id, "newer", "latest is by activity, even when input isn't sorted");
  assert.equal(groups[0].key, inboxSeriesKey(groups[0].latest), "the group key matches its members'");
}

// ── isInboxItemPastDue: due moment passed + still waiting on the user ───────
{
  const now = Date.parse("2026-06-10T12:00:00Z");
  const pastDue = (over) => isInboxItemPastDue(item(over), now);
  assert.equal(pastDue({ status: "fired", fireAt: "2026-06-10T09:00:00Z", firedAt: "2026-06-10T09:00:00Z" }), true, "fired reminder past its time is past due");
  assert.equal(pastDue({ status: "pending", fireAt: "2026-06-10T09:00:00Z" }), true, "a pending reminder whose fireAt slipped by is past due (missed while quit)");
  assert.equal(pastDue({ status: "pending", fireAt: "2026-06-11T09:00:00Z" }), false, "an upcoming reminder is not past due");
  assert.equal(pastDue({ status: "done", fireAt: "2026-06-10T09:00:00Z" }), false, "resolved reminders are never past due");
  assert.equal(pastDue({ status: "dismissed", fireAt: "2026-06-10T09:00:00Z" }), false, "dismissed reminders are never past due");
  assert.equal(pastDue({ status: "fired", fireAt: null, firedAt: "2026-06-10T09:00:00Z" }), true, "fired with no fireAt falls back to firedAt");
  assert.equal(pastDue({ kind: "agent", status: "fired", fireAt: "2026-06-10T09:00:00Z" }), false, "announcement kinds have no due moment");
  assert.equal(pastDue({ kind: "daily-summary", status: "fired", firedAt: "2026-06-10T09:00:00Z" }), false, "daily summaries are never past due");
  assert.equal(pastDue({ status: "pending", fireAt: null }), false, "no due time → not past due");
}

console.log("inbox-feed.test.ts passed");
