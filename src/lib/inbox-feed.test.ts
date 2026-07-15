// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildInboxGroups,
  groupInboxFeed,
  INBOX_GROUP_BY_OPTIONS,
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

console.log("inbox-feed.test.ts passed");
