// @ts-nocheck
import assert from "node:assert/strict";
import { buildDigestCards, firstImageUrl, isAiRelated } from "./home-digest.ts";

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

// The home carousel only surfaces AI-related headlines, so the fixtures qualify
// either by an "AI" feed category or by an AI keyword in the title.
const rssItems = [
  { id: "r1", title: "OpenAI ships a new model", link: "https://example.com/a", isoDate: hoursAgo(1), source: "Example", category: "Tech", descriptionHtml: '<p>x</p><img src="https://img.example.com/a.jpg" alt="">' },
  { id: "r2", title: "No link skipped (AI)", link: "", isoDate: hoursAgo(1), source: "Example" },
  { id: "r3", title: "Weekly roundup", link: "https://news.test/b", isoDate: hoursAgo(2), source: "News", category: "AI" },
  { id: "r4", title: "Best pancake recipes", link: "https://food.test/c", isoDate: hoursAgo(3), source: "Food", category: "World" },
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

// ── RSS cards: linkless + non-AI items dropped, newest-first preserved ─────────
const rssCards = cards.filter((c) => c.kind === "rss");
assert.equal(rssCards.length, 2, "linkless and non-AI rss items are dropped");
assert.equal(rssCards[0].url, "https://example.com/a");
assert.equal(rssCards[0].host, "example.com", "host is derived from the link");
assert.ok(
  !rssCards.some((c) => c.url === "https://food.test/c"),
  "a non-AI headline (no AI category, no AI keyword) is excluded",
);

// ── isAiRelated: AI feed category OR an AI keyword in the title ────────────────
assert.ok(isAiRelated({ title: "x", category: "AI" }), "AI feed category qualifies");
assert.ok(isAiRelated({ title: "x", category: "ai" }), "category match is case-insensitive");
assert.ok(isAiRelated({ title: "Anthropic releases Claude" }), "AI keyword in title qualifies");
assert.ok(isAiRelated({ title: "The new AI era" }), "the short token 'ai' matches as a word");
assert.ok(!isAiRelated({ title: "Reply to this email", category: "World" }), "'email' must not match 'ai'");
assert.ok(!isAiRelated({ title: "A guide to HTML and CSS", category: "Dev" }), "'html' must not match 'ml'");
assert.ok(!isAiRelated({ title: "Best pancake recipes" }), "an unrelated headline is excluded");

// ── Media thumbnails: image pulled from the item body when present ─────────────
assert.equal(
  rssCards[0].image,
  "https://img.example.com/a.jpg",
  "rss card carries the first http(s) image from descriptionHtml",
);
assert.equal(rssCards[1].image, undefined, "rss card with no body image has no thumbnail");

// firstImageUrl: only absolute http(s) images; skips data/relative/none.
assert.equal(firstImageUrl('<img src="https://x/a.png">'), "https://x/a.png");
assert.equal(firstImageUrl("<img src='http://x/b.gif' />"), "http://x/b.gif");
assert.equal(firstImageUrl('<img src="//x/c.jpg">'), undefined, "protocol-relative skipped");
assert.equal(firstImageUrl('<img src="data:image/png;base64,AAA">'), undefined, "data URI skipped");
assert.equal(firstImageUrl("<p>no image here</p>"), undefined);
assert.equal(firstImageUrl(undefined), undefined);

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

// ── Live tier: running sessions lead as presence cards (cave-9j6a) ────────────
{
  const withLive = buildDigestCards({
    items,
    sessions: [
      ...sessions,
      { id: "L1", title: "Refactor auth", status: "running", updated_at: hoursAgo(0.05), created_at: hoursAgo(30), familiarId: "f1" },
      { id: "L2", title: "Long research sweep", status: "running", updated_at: hoursAgo(0.5), created_at: hoursAgo(40), familiarId: null },
    ],
    rssItems,
    familiarNameById,
    nowMs: NOW,
  });
  const kinds2 = withLive.map((c) => c.kind);
  const live = withLive.filter((c) => c.kind === "live");
  assert.equal(live.length, 2, "every running session gets a live card");
  assert.ok(kinds2.indexOf("live") < kinds2.indexOf("summary"), "live tier precedes the summary");
  assert.equal(live[0].sessionId, "L1", "freshest activity first");
  assert.ok(live[0].subtitle.includes("Sage"), "live subtitle resolves the familiar");
  assert.ok(live[0].subtitle.includes("working"), "live subtitle says what's happening");
  // A running session started before today still surfaces (not day-gated) and
  // never doubles as a plain session card.
  assert.ok(
    !withLive.some((c) => c.kind === "session" && c.sessionId === "L1"),
    "live sessions are not duplicated into the resumable-session tier",
  );

  // needs-you still leads overall when present.
  const withNeeds = buildDigestCards({
    items,
    sessions: [{ id: "L1", title: "x", status: "running", updated_at: hoursAgo(1), created_at: hoursAgo(1) }],
    rssItems: [],
    needsYou: [{ id: "n1", kind: "response-needed", title: "Reply?", updatedAt: hoursAgo(1), createdAt: hoursAgo(1) }],
    nowMs: NOW,
  });
  const kinds3 = withNeeds.map((c) => c.kind);
  assert.ok(kinds3.indexOf("needs") < kinds3.indexOf("live"), "attention items outrank ambient presence");

  // maxLive caps the tier.
  const cappedLive = buildDigestCards({
    items: [],
    sessions: Array.from({ length: 6 }, (_, i) => ({
      id: `L${i}`, title: `run ${i}`, status: "running", updated_at: hoursAgo(i + 1), created_at: hoursAgo(i + 2),
    })),
    rssItems: [],
    nowMs: NOW,
    maxLive: 2,
  });
  assert.equal(cappedLive.filter((c) => c.kind === "live").length, 2, "maxLive caps live cards");
}

console.log("home-digest.test.ts passed");
