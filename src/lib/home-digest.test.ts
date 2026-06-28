// @ts-nocheck
import assert from "node:assert/strict";
import { buildDigestCards } from "./home-digest.ts";

// Midday UTC so the small ±hour offsets below stay on the same calendar day in
// CI's timezone (and most others), keeping the "today" filter deterministic.
const NOW = Date.parse("2026-06-28T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

const sessions = [
  { id: "s1", title: "Fix the carousel", updated_at: hoursAgo(2), created_at: hoursAgo(3), familiarId: "f1", diff: { additions: 12, deletions: 4 } },
  { id: "s2", title: "Older work", updated_at: hoursAgo(40), created_at: hoursAgo(41), familiarId: null }, // yesterday
  { id: "s3", title: "Archived today", updated_at: hoursAgo(1), created_at: hoursAgo(1), archived_at: hoursAgo(1) },
];

const items = [
  { id: "i1", kind: "reminder", status: "fired", firedAt: hoursAgo(1), updatedAt: hoursAgo(1) },
  { id: "i2", kind: "response-needed", status: "pending", updatedAt: hoursAgo(2) },
  { id: "i3", kind: "reminder", status: "fired", firedAt: hoursAgo(50), updatedAt: hoursAgo(50) }, // yesterday, ignored
];

const rssItems = [
  { id: "r1", title: "Headline one", link: "https://example.com/a", isoDate: hoursAgo(1), source: "Example" },
  { id: "r2", title: "No link skipped", link: "", isoDate: hoursAgo(1), source: "Example" },
  { id: "r3", title: "Headline two", link: "https://news.test/b", isoDate: hoursAgo(2), source: "News" },
];

const familiarNameById = new Map([["f1", "Sage"]]);

const cards = buildDigestCards({ items, sessions, rssItems, familiarNameById, nowMs: NOW });

// ── Ordering: summary first, then sessions, then rss ──────────────────────────
assert.equal(cards[0].kind, "summary", "summary card leads the carousel");
const kinds = cards.map((c) => c.kind);
assert.ok(
  kinds.indexOf("session") < kinds.indexOf("rss"),
  "session cards come before rss cards",
);

// ── Summary card content reflects today's counts ──────────────────────────────
const summary = cards[0];
assert.equal(summary.title, "Daily summary");
assert.ok(summary.dayLabel.length > 0, "summary has a day label");
assert.ok(summary.lines.includes("1 session"), "one non-archived session today");
assert.ok(summary.lines.includes("1 reminder"), "one reminder fired today");
assert.ok(summary.lines.includes("1 waiting"), "one response waiting today");

// ── Session cards: today only, archived + yesterday excluded ──────────────────
const sessionCards = cards.filter((c) => c.kind === "session");
assert.equal(sessionCards.length, 1, "only today's non-archived session");
assert.equal(sessionCards[0].sessionId, "s1");
assert.equal(sessionCards[0].familiarId, "f1");
assert.ok(sessionCards[0].subtitle.includes("Sage"), "subtitle resolves the familiar name");
assert.ok(sessionCards[0].subtitle.includes("+12 -4"), "subtitle includes the diff");

// ── RSS cards: linkless items dropped, newest-first preserved ──────────────────
const rssCards = cards.filter((c) => c.kind === "rss");
assert.equal(rssCards.length, 2, "the linkless rss item is dropped");
assert.equal(rssCards[0].url, "https://example.com/a");
assert.equal(rssCards[0].host, "example.com", "host is derived from the link");

// ── maxRss cap is honored ─────────────────────────────────────────────────────
const capped = buildDigestCards({ items, sessions, rssItems, nowMs: NOW, maxRss: 1 });
assert.equal(capped.filter((c) => c.kind === "rss").length, 1, "maxRss caps rss cards");

// ── Empty when there's nothing today and no headlines ─────────────────────────
const empty = buildDigestCards({
  items: [],
  sessions: [{ id: "old", title: "x", updated_at: hoursAgo(80), created_at: hoursAgo(80) }],
  rssItems: [],
  nowMs: NOW,
});
assert.deepEqual(empty, [], "no activity and no rss → no cards (strip stays hidden)");

// ── RSS-only still renders (no summary, no sessions) ──────────────────────────
const rssOnly = buildDigestCards({ items: [], sessions: [], rssItems, nowMs: NOW });
assert.equal(rssOnly[0].kind, "rss", "rss-only digest has no leading summary card");

console.log("home-digest.test.ts passed");
