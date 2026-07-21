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

// ── Source pins: expandable-row disclosure semantics (chat-list.tsx) ─────────

test("chat-list: rows are proper disclosures (aria-expanded + aria-controls)", () => {
  assert.match(
    chatList,
    /aria-expanded=\{selectMode \? undefined : isExpanded\}/,
    "the row button reports its disclosure state outside select mode",
  );
  assert.match(
    chatList,
    /aria-controls=\{isExpanded \? detailId : undefined\}/,
    "the expanded row points at its detail strip",
  );
  assert.match(
    chatList,
    /const detailId = `chat-list-row-detail-\$\{s\.id\}`/,
    "detail strips carry stable per-session ids",
  );
});

test("chat-list: detail strip carries Resume/Open (existing open path) + Archive", () => {
  assert.match(
    chatList,
    /\{s\.status === "running" \? "Resume" : "Open"\}/,
    "the primary action is Resume while running, Open otherwise",
  );
  assert.match(
    chatList,
    /chat-list-row-detail[\s\S]{0,1400}setActiveId\(s\.id\);\s*\n\s*onOpen\(s\.id, s\.familiarId\);/,
    "Resume/Open routes through the existing open-session action",
  );
  assert.match(
    chatList,
    /onClick=\{\(e\) => void setSessionArchived\(e, s\.id, !s\.archived_at\)\}/,
    "Archive reuses the existing archive PATCH action",
  );
});

test("chat-list: Escape collapses the expanded row before clearing search", () => {
  assert.match(
    chatList,
    /if \(expandedRowId\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*setExpandedRowId\(null\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*if \(search\) \{/,
    "the search field's Escape handler collapses first, clears second",
  );
  assert.match(
    chatList,
    /if \(e\.key === "Escape" && !e\.defaultPrevented\) \{\s*\n\s*setExpandedRowId\(\(cur\) => \(cur \? null : cur\)\);/,
    "a global Escape collapses the expanded row (deferring to consumers that already handled it)",
  );
});

// ── Source pins: toolbar contracts (chat-list.tsx) ───────────────────────────

test("chat-list: All / Active segmented control drives the running-only filter", () => {
  assert.match(
    chatList,
    /aria-pressed=\{!unreadsOnly\}\s*\n\s*onClick=\{\(\) => setUnreadsOnly\(false\)\}/,
    "All clears the active-only filter",
  );
  assert.match(
    chatList,
    /aria-pressed=\{unreadsOnly\}\s*\n\s*onClick=\{\(\) => setUnreadsOnly\(true\)\}/,
    "Active enables the running-only filter (same state as the dot toggle)",
  );
});

test("chat-list: group-by select + persisted key + count line", () => {
  assert.match(
    chatList,
    /aria-label="Group sessions by"[\s\S]{0,400}<option value="none">No grouping<\/option>\s*\n\s*<option value="project">Group by project<\/option>\s*\n\s*<option value="date">Group by date<\/option>/,
    "the group-by select offers none / project / date",
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
