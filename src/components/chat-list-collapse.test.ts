// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

assert.match(src, /function ChatListSection\(\{[\s\S]*?collapsed\?: boolean;[\s\S]*?onToggle\?: \(\) => void;/, "ChatListSection accepts collapsed/onToggle");
assert.match(src, /aria-expanded=\{!collapsed\}/, "toggle header reports aria-expanded");
assert.match(src, /ph:caret-(right|down)/, "toggle header shows a caret");
assert.match(src, /collapsedSections, setCollapsedSections\] = useState<Set<string>>\(\(\) => new Set\(\)\)/, "collapsedSections state defaults empty");
assert.match(src, /function toggleSection|const toggleSection/, "has a toggleSection updater");
assert.match(src, /label="Pinned"[\s\S]*?onToggle=\{\(\) => toggleSection\("pinned"\)\}/, "Pinned header is collapsible");
assert.match(src, /label="Sessions"[\s\S]*?onToggle=\{\(\) => toggleSection\("sessions"\)\}/, "Sessions header is collapsible");
assert.match(src, /rowCollapsed/, "rows compute a rowCollapsed flag");
assert.match(src, /!rowCollapsed && \(/, "collapsed section's rows are not rendered");

// cave-t3v: bulk select/delete must act on VISIBLE rows only. displayIds keeps
// collapsed rows (for drag); visibleIds drops rows in a collapsed section, and
// the select-all / count / bulk-delete / bulk-archive paths all key off it — so
// "Select all" + Delete can never remove chats hidden in a collapsed section.
assert.match(
  src,
  /const visibleIds = useMemo\(\(\) => \{\s*\n\s*if \(effectiveSelection !== "all" \|\| collapsedSections\.size === 0\) return displayIds;\s*\n\s*return displayIds\.filter\(\s*\n\s*\(id\) => !collapsedSections\.has\(isSessionPinned\(pinnedIds, id\) \? "pinned" : "sessions"\),/,
  "visibleIds excludes rows in a collapsed section",
);
assert.doesNotMatch(
  src,
  /allVisibleSelected = displayIds|selectedVisibleCount = displayIds|new Set\(displayIds\.filter\(\(id\) => selectedIds/,
  "select-all, the visible count, and bulk delete no longer key off displayIds (which includes collapsed rows)",
);
assert.match(src, /allVisibleSelected = visibleIds/, "select-all is computed from the visible rows");
assert.match(src, /const idSet = new Set\(visibleIds\.filter\(\(id\) => selectedIds\.has\(id\)\)\)/, "bulk delete only removes selected rows that are currently visible");

console.log("chat-list-collapse.test.ts: ok");
