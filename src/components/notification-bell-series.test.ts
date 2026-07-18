// @ts-nocheck
// Notification bell: occurrences of the same repeating schedule collapse into
// ONE row, and past-due reminders are clearly filterable (cave-w7z0). The
// scheduler spawns a fresh sibling item per refire of a recurring schedule, so
// without collapsing, a daily stand-up buries the bell in near-identical rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");

// ── Series grouping rides the pure lib, not ad-hoc component logic ──────────
assert.match(
  src,
  /import \{ collapseInboxSeries, isInboxItemPastDue, isInboxItemUnread, unreadInboxCount \} from "@\/lib\/inbox-feed"/,
  "series collapse and the past-due predicate come from the pure inbox-feed lib",
);
assert.match(
  src,
  /const grouped = useMemo\(\(\) => collapseInboxSeries\(feed\), \[feed\]\)/,
  "the feed collapses same-schedule occurrences before rendering",
);
assert.match(
  src,
  /recent\.map\(\(group\) => \{\s*\n\s*const it = group\.latest;/,
  "rows render the group's most recent occurrence",
);

// ── Collapsed rows surface their series: count badge + series-wide actions ──
assert.match(
  src,
  /notification-bell__series-count[\s\S]{0,400}×\{seriesCount\}/,
  "a collapsed row shows how many notifications it groups",
);
assert.match(
  src,
  /const unread = group\.items\.some\(isInboxItemUnread\)/,
  "a row is unread when ANY occurrence in its series is unread",
);
assert.match(
  src,
  /void markRead\(unreadIdsInGroup\)/,
  "Read acknowledges every unread occurrence in the series",
);
assert.match(
  src,
  /void dismiss\(group\.items\.map\(\(m\) => m\.id\)\)/,
  "Dismiss clears the whole series, not just the visible occurrence",
);
assert.match(
  src,
  /\{seriesCount > 1 \? "Dismiss all" : "Dismiss"\}/,
  "the dismiss button says what it will do to a collapsed series",
);

// ── Past due is a first-class, clearly visible filter ────────────────────────
assert.match(
  src,
  /type KindFilter = "all" \| "past-due" \| ItemKind/,
  "past-due is a first-class filter state",
);
assert.match(
  src,
  /const pastDueGroups = useMemo\(\s*\n\s*\(\) => grouped\.filter\(\(g\) => g\.items\.some\(\(i\) => isInboxItemPastDue\(i\)\)\)/,
  "past-due groups derive from the shared predicate",
);
assert.match(
  src,
  /notification-bell__past-due-chip[\s\S]{0,700}Past due <span aria-hidden className="opacity-70">\{pastDueGroups\.length\}/,
  "the Past due chip is visible with a live count",
);
assert.match(
  src,
  /--color-warning/,
  "the past-due affordances use the warning hue so they read at a glance",
);
assert.match(
  src,
  /notification-bell__past-due-tag[\s\S]{0,260}>\s*\n\s*Past due/,
  "past-due rows carry an inline tag even outside the filter",
);
assert.match(
  src,
  /if \(kindFilter === "past-due" && pastDueGroups\.length === 0\) setKindFilter\("all"\)/,
  "clearing the last past-due item exits the filter instead of stranding an empty list",
);
assert.match(
  src,
  /kindChips\.length > 1 \|\| pastDueGroups\.length > 0/,
  "the filter row appears whenever there is something past due, even with one kind",
);

console.log("notification-bell-series.test.ts: ok");
