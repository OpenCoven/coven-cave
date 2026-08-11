// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const primitives = readFileSync(new URL("./chat-list-primitives.tsx", import.meta.url), "utf8");

assert.match(primitives, /function ChatListSection\(\{[\s\S]*?collapsed\?: boolean;[\s\S]*?onToggle\?: \(\) => void;/, "ChatListSection accepts collapsed/onToggle");
assert.match(primitives, /aria-expanded=\{!collapsed\}/, "toggle header reports aria-expanded");
assert.match(primitives, /ph:caret-(right|down)/, "toggle header shows a caret");
assert.match(src, /collapsedSections, setCollapsedSections\] = useState<Set<string>>\(\(\) => new Set\(\)\)/, "collapsedSections state defaults empty");
assert.match(src, /function toggleSection|const toggleSection/, "has a toggleSection updater");
assert.match(src, /label="Pinned"[\s\S]*?onToggle=\{\(\) => toggleSection\("pinned"\)\}/, "Pinned header is collapsible");
// The flat "Sessions" header only renders when activity bands are NOT owning
// the slot (cave-n3jg2); when they are, there is no header to collapse, so the
// stale flag must not hide rows — asserted on visibleIds and rowCollapsed below.
assert.match(src, /!bandsByIndex && idx === firstRestIdx[\s\S]*?label="Sessions"[\s\S]*?onToggle=\{\(\) => toggleSection\("sessions"\)\}/, "Sessions header is collapsible when it is the header in play");
assert.match(src, /rowCollapsed/, "rows compute a rowCollapsed flag");
assert.match(src, /!rowCollapsed && \(/, "collapsed section's rows are not rendered");

// cave-t3v: bulk select/delete must act on VISIBLE rows only. displayIds keeps
// collapsed rows (for drag); visibleIds drops rows in a collapsed section, and
// the select-all / count / bulk-delete / bulk-archive paths all key off it — so
// "Select all" + Delete can never remove chats hidden in a collapsed section.
assert.match(
  src,
  /const visibleIds = useMemo\(\(\) => \{[\s\S]{0,400}?if \(effectiveSelection !== "all" \|\| groupBy !== "none" \|\| collapsedSections\.size === 0\) return displayIds;\s*\n\s*return displayIds\.filter\(\(id\) => \{\s*\n\s*const key = isSessionPinned\(pinnedIds, id\) \? "pinned" : "sessions";/,
  "visibleIds excludes rows in a collapsed section (sections exist only in the flat ungrouped view)",
);
// A collapsed-"sessions" flag left over from before activity banding must not
// silently hide (and therefore protect from, or expose to, bulk actions) rows
// under a header that no longer exists.
assert.match(
  src,
  /if \(key === "sessions" && bandsByIndex\) return true;/,
  "banded lists ignore the stale Sessions collapse flag",
);
assert.doesNotMatch(
  src,
  /allVisibleSelected = displayIds|selectedVisibleCount = displayIds|new Set\(displayIds\.filter\(\(id\) => selectedIds/,
  "select-all, the visible count, and bulk delete no longer key off displayIds (which includes collapsed rows)",
);
assert.match(src, /allVisibleSelected = visibleIds/, "select-all is computed from the visible rows");
assert.match(src, /const idSet = new Set\(visibleIds\.filter\(\(id\) => selectedIds\.has\(id\)\)\)/, "bulk delete only removes selected rows that are currently visible");

console.log("chat-list-collapse.test.ts: ok");
