// @ts-nocheck
import assert from "node:assert/strict";
import {
  groupInboxFeed,
  inboxActivityTime,
  inboxKindLabel,
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

console.log("inbox-feed.test.ts passed");
