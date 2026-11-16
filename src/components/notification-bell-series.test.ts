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
// Rows come from the bell's arrangement (#6483): Needs you, then by day, with
// daily reports folded into one row. notification-feed.test.ts covers it.
assert.match(
  src,
  /const sections = useMemo\(\s*\n\s*\(\) => buildNotificationSections\(filteredGroups, Date\.now\(\), MAX_ROWS\)/,
  "the collapsed groups are arranged into sections before rendering",
);
assert.match(
  src,
  /const MAX_ROWS = 30;[\s\S]*sections\.hidden > 0 \?[\s\S]{0,160}\{sections\.hidden\} more/,
  "the popover caps its rows and says how many more wait in Rituals",
);
assert.match(
  src,
  /const latest = notificationRowLatest\(row\);\s*\n\s*const members = notificationRowItems\(row\);/,
  "rows render the group's most recent occurrence and act on every member",
);

// ── Collapsed rows surface their series: count badge + series-wide actions ──
assert.match(
  src,
  /notification-bell__series-count[\s\S]{0,400}×\{count\}/,
  "a collapsed row shows how many notifications it groups",
);
assert.match(
  src,
  /const unreadIdsInRow = members\.filter\(isInboxItemUnread\)\.map\(\(m\) => m\.id\);\s*\n\s*const unread = unreadIdsInRow\.length > 0;/,
  "a row is unread when ANY occurrence in its series is unread",
);
assert.match(
  src,
  /markRead\(unreadIdsInRow\)/,
  "Read acknowledges every unread occurrence in the series",
);
assert.match(
  src,
  /void dismiss\(members\.map\(\(m\) => m\.id\)\)/,
  "Dismiss clears the whole series, not just the visible occurrence",
);
assert.match(
  src,
  /aria-label=\{count > 1 \? `Dismiss all \$\{count\}: \$\{title\}` : `Dismiss: \$\{title\}`\}/,
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
