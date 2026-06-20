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

console.log("chat-list-collapse.test.ts: ok");
