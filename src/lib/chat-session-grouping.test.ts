// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Sessions-list redesign invariants: the pure grouping/filter helpers
// (group-by select, calendar-day sections, count line, rail mode, preview
// cap) plus source pins for the expandable-row disclosure and toolbar
// contracts in chat-list.tsx.

import {
  CHAT_GROUP_BY_KEY,
  CHAT_RAIL_MODE_KEY,
  CHAT_RAIL_PREVIEW_LIMIT,
  deriveChatDaySections,
  normalizeChatGroupBy,
  normalizeChatRailMode,
  railGroupPreview,
  railMoreLabel,
  sessionCountLine,
  sessionDayKey,
  sessionDayLabel,
} from "./chat-session-grouping.ts";

const chatList = readFileSync(new URL("../components/chat-list.tsx", import.meta.url), "utf8");

test("normalizeChatGroupBy: project/date pass, everything else is none", () => {
  assert.equal(normalizeChatGroupBy("project"), "project");
  assert.equal(normalizeChatGroupBy("date"), "date");
  assert.equal(normalizeChatGroupBy("none"), "none");
  assert.equal(normalizeChatGroupBy("banana"), "none");
  assert.equal(normalizeChatGroupBy(null), "none");
  assert.equal(normalizeChatGroupBy(undefined), "none");
  assert.equal(CHAT_GROUP_BY_KEY, "cave:chat:list:group-by");
});

test("sessionDayKey: local calendar day, garbage → undated", () => {
  const key = sessionDayKey("2026-07-20T12:30:00");
  assert.equal(key, "2026-07-20");
  assert.equal(sessionDayKey("not a date"), "undated");
});

test("sessionDayLabel: Today / Yesterday / formatted fallback", () => {
  const now = new Date("2026-07-21T09:00:00").getTime();
  const fmt = (iso) => `fmt:${iso}`;
  assert.equal(sessionDayLabel("2026-07-21T01:00:00", now, fmt), "Today");
  assert.equal(sessionDayLabel("2026-07-20T23:59:00", now, fmt), "Yesterday");
  assert.equal(sessionDayLabel("2026-07-18T10:00:00", now, fmt), "fmt:2026-07-18T10:00:00");
  assert.equal(sessionDayLabel("garbage", now, fmt), "Undated");
  // Future timestamps clamp to Today rather than inventing a section.
  assert.equal(sessionDayLabel("2026-07-22T10:00:00", now, fmt), "Today");
});

test("deriveChatDaySections: sections follow row order without re-sorting", () => {
  const now = new Date("2026-07-21T09:00:00").getTime();
  const row = (id, iso) => ({ id, updated_at: iso, created_at: iso });
  const rows = [
    row("a", "2026-07-21T08:00:00"),
    row("b", "2026-07-21T07:00:00"),
    row("c", "2026-07-20T22:00:00"),
    row("d", "2026-07-18T10:00:00"),
    row("e", "2026-07-18T09:00:00"),
  ];
  const sections = deriveChatDaySections(rows, now, () => "Jul 18");
  assert.deepEqual(
    sections.map((s) => ({ label: s.label, count: s.count, startIndex: s.startIndex })),
    [
      { label: "Today", count: 2, startIndex: 0 },
      { label: "Yesterday", count: 1, startIndex: 2 },
      { label: "Jul 18", count: 2, startIndex: 3 },
    ],
  );
  // A pinned row hoisted out of day order simply opens its own section — the
  // helper never reorders rows.
  const interleaved = deriveChatDaySections(
    [row("d", "2026-07-18T10:00:00"), row("a", "2026-07-21T08:00:00")],
    now,
    () => "Jul 18",
  );
  assert.equal(interleaved.length, 2);
  assert.equal(interleaved[0].label, "Jul 18");
  assert.deepEqual(deriveChatDaySections([], now, () => ""), []);
});

test("sessionCountLine: shown of total with pluralization on total", () => {
  assert.equal(sessionCountLine(3, 16), "3 of 16 sessions");
  assert.equal(sessionCountLine(1, 1), "1 of 1 session");
  assert.equal(sessionCountLine(0, 4), "0 of 4 sessions");
});

test("normalizeChatRailMode: recent passes, everything else is projects", () => {
  assert.equal(normalizeChatRailMode("recent"), "recent");
  assert.equal(normalizeChatRailMode("projects"), "projects");
  assert.equal(normalizeChatRailMode("x"), "projects");
  assert.equal(normalizeChatRailMode(null), "projects");
  assert.equal(CHAT_RAIL_MODE_KEY, "cave:chat:rail:mode");
});

test("railGroupPreview + railMoreLabel: 6-row cap with Show N more / fewer", () => {
  assert.equal(CHAT_RAIL_PREVIEW_LIMIT, 6);
  const rows = Array.from({ length: 9 }, (_, i) => i);
  const capped = railGroupPreview(rows, false);
  assert.deepEqual(capped.shown, [0, 1, 2, 3, 4, 5]);
  assert.equal(capped.hiddenCount, 3);
  const expanded = railGroupPreview(rows, true);
  assert.equal(expanded.shown.length, 9);
  assert.equal(expanded.hiddenCount, 0);
  const small = railGroupPreview([1, 2], false);
  assert.deepEqual(small.shown, [1, 2]);
  assert.equal(small.hiddenCount, 0);
  assert.equal(railMoreLabel(false, 3), "Show 3 more");
  assert.equal(railMoreLabel(true, 0), "Show fewer");
});

// ── Source pins: rows open directly on click (chat-list.tsx) ─────────────────

test("chat-list: a row click opens the session directly (no disclosure strip)", () => {
  assert.match(
    chatList,
    /onClick=\{\(\) => \{ if \(selectMode\) \{ toggleSelect\(s\.id\); return; \} setActiveId\(s\.id\); onOpen\(s\.id, s\.familiarId\); \}\}/,
    "a row click selects in select mode, otherwise opens the session",
  );
  assert.doesNotMatch(
    chatList,
    /expandedRowId|setExpandedRowId/,
    "the inline detail-strip disclosure state is gone",
  );
  assert.doesNotMatch(
    chatList,
    /chat-list-row-detail|onDoubleClick/,
    "no detail strip or double-click fast path remains — click IS the open path",
  );
});

test("chat-list: Enter and Space both open the focused row", () => {
  assert.match(
    chatList,
    /if \(e\.key === "Enter" \|\| e\.key === " "\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*if \(selectMode\) \{ toggleSelect\(s\.id\); return; \}\s*\n\s*setActiveId\(s\.id\); onOpen\(s\.id, s\.familiarId\);/,
    "keyboard activation mirrors the click: select in select mode, open otherwise",
  );
  // dnd-kit's Space/Enter drag activation prevents default but does NOT stop
  // propagation — without this guard, activating keyboard reorder on the drag
  // handle bubbles to the row and navigates away, destroying the drag.
  assert.match(
    chatList,
    /if \(e\.target !== e\.currentTarget\) return;\s*\n\s*if \(e\.key === "Enter" \|\| e\.key === " "\)/,
    "the row keydown ignores events from nested controls (drag handle keeps keyboard reorder)",
  );
});

test("chat-list: Escape in search clears the query", () => {
  assert.match(
    chatList,
    /if \(e\.key !== "Escape"\) return;\s*\n\s*if \(search\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*setSearch\(""\);/,
    "the search field's Escape handler clears the query",
  );
});

// ── Source pins: toolbar contracts (chat-list.tsx) ───────────────────────────

// cave-n3jg2 ("Chat Session - Prototype.dc.html"): the All/Active segmented
// control and its duplicate dot toggle are replaced by one counted chip per
// state the daemon actually reports. "Active" could only ever answer "what is
// running?"; the chips also answer "what failed?" and "what is waiting on me?".
test("chat-list: counted status chips drive the status filter", () => {
  assert.match(
    chatList,
    /aria-pressed=\{statusFilter === "all"\}\s*\n\s*onClick=\{\(\) => setStatusFilter\("all"\)\}/,
    "All clears the status filter",
  );
  assert.match(
    chatList,
    /\{CHAT_SESSION_STATUS_ORDER\.map\(\(key\) => \{[\s\S]{0,600}?onClick=\{\(\) => setStatusFilter\(key\)\}/,
    "one chip per reported status, each setting the filter",
  );
  assert.match(
    chatList,
    /<span className="chat-status-chip__count">\{statusCounts\[key\]\}<\/span>/,
    "each chip carries its own count",
  );
  // Counting the SEARCHED set (not the filtered one) is what keeps the numbers
  // under the chips you did not press from changing when you press one.
  assert.match(
    chatList,
    /const statusCounts = useMemo\(\(\) => countChatSessionStatuses\(searched\), \[searched\]\);/,
    "counts describe the searched set, so pressing a chip never renumbers the others",
  );
});

test("chat-list: activity bands head the default recency order", () => {
  assert.match(
    chatList,
    /const activityBanded =\s*\n\s*groupBy === "none" && effectiveSelection === "all" && sessionSort === "recent" && sessionOrder\.length === 0;/,
    "bands are scoped to the flat, ungrouped, unsorted-by-hand recency view",
  );
  assert.match(
    chatList,
    /<li className="chat-activity-header" data-bucket=\{band\.bucket\}>/,
    "each band renders its own header keyed by bucket",
  );
  // A named flat order still gets one header, so the list never presents rows
  // in an order it has not named.
  assert.match(
    chatList,
    /map\.set\(offset, \{ bucket: "flat", label: CHAT_SESSION_SORT_HEADING\[sessionSort\], count: rest\.length \}\);/,
    "non-recency orders get a single named header",
  );
});

test("chat-list: group-by tabs + persisted key + count line", () => {
  assert.match(
    chatList,
    /aria-label="Group sessions by"[\s\S]{0,1200}CHAT_GROUP_BY_OPTIONS\.map\([\s\S]{0,800}aria-pressed=\{groupBy === option\.id\}[\s\S]{0,300}title=\{option\.title\}/,
    "the group-by tabs expose the shared options with pressed state and labels",
  );
  assert.match(
    chatList,
    /window\.localStorage\.setItem\(CHAT_GROUP_BY_KEY, groupBy\)/,
    "the choice persists under the shared key",
  );
  assert.match(
    chatList,
    /sessionCountLine\(visibleRows, mine\.length\)/,
    "the toolbar count line reports shown-of-total through the pure helper",
  );
  assert.match(
    chatList,
    /deriveChatDaySections\(rows, Date\.now\(\), \(iso\) => formatDate\(iso, dtPrefs\)\)/,
    "date sections derive through the pure helper with the pref-aware day formatter",
  );
});
