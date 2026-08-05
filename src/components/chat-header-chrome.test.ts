// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const groupChatView = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const sessionHeader = readFileSync(new URL("./chat-session-header.tsx", import.meta.url), "utf8");
const activityCss = readFileSync(new URL("../styles/cave-chat/activity.css", import.meta.url), "utf8");

assert.doesNotMatch(
  chatView,
  /from "@\/components\/chat-participants"|<ChatParticipants\b/,
  "solo Chat must not render the participant identity/add cluster in its header",
);
assert.doesNotMatch(
  activityCss,
  /\.cave-chat-participants(?:__[\w-]+)?\b/,
  "the removed participant cluster must not leave dead CSS behind",
);
assert.match(
  chatView,
  /const promotableFamiliars = useMemo\([\s\S]{0,300}?addableFamiliars\(familiars, familiar\.id\)[\s\S]{0,200}?\[familiar\.id, familiars\]/,
  "solo Chat must derive one stable eligible-familiar set for every promotion affordance",
);
assert.match(
  chatView,
  /<SessionOverflowMenu[\s\S]{0,900}?promotableFamiliars=\{promotableFamiliars\}[\s\S]{0,300}?onPromoteToCoven=\{promoteToCoven\}/,
  "Session options must receive the accessible promotion candidates and existing mutation",
);
assert.match(
  sessionHeader,
  /<PopoverBody role="menu" ariaLabel="Chat options">[\s\S]*promotableFamiliars\.length > 0[\s\S]*<PopoverLabel>Start a coven with<\/PopoverLabel>/,
  "Session options must expose coven promotion inside a named menu section",
);
assert.match(
  sessionHeader,
  /const menuRef = useRef<HTMLDivElement \| null>\(null\);[\s\S]{0,200}?const keyboardOpenRequested = useRef\(false\);[\s\S]{0,1800}?if \(!open \|\| !keyboardOpenRequested\.current\) return;[\s\S]{0,300}?requestAnimationFrame\(focusFirstEnabledItem\)/,
  "keyboard-opening Session options must transfer focus to its first enabled menu item",
);
assert.match(
  sessionHeader,
  /const onTriggerKeyDown = useCallback\([\s\S]{0,500}?e\.key === "Enter" \|\| e\.key === " " \|\| e\.key === "ArrowDown"[\s\S]{0,300}?keyboardOpenRequested\.current = true[\s\S]{0,3000}?onKeyDown=\{onTriggerKeyDown\}/,
  "the Session options trigger must support Enter, Space, and ArrowDown keyboard opening",
);
assert.match(
  sessionHeader,
  /const onBodyKeyDown = useCallback\([\s\S]{0,300}?\["ArrowDown", "ArrowUp", "Home", "End"\][\s\S]{0,900}?items\[nextIndex\]\?\.focus\(\)[\s\S]{0,3000}?<div ref=\{menuRef\} onKeyDown=\{onBodyKeyDown\}>/,
  "Session options must move focus across enabled menu items with Arrow keys, Home, and End",
);
assert.match(
  sessionHeader,
  /const setSessionMenuOpen = useCallback\(\(next: boolean\) => \{\s*if \(next\) setProjectPickerOpen\(false\);\s*setOpen\(next\);\s*\}, \[\]\);/,
  "Session options must use one controlled opener that closes the shared project picker first",
);
assert.match(
  sessionHeader,
  /if \(open\) \{[\s\S]{0,300}?\} else \{\s*setSessionMenuOpen\(true\);\s*\}[\s\S]{0,3000}?onClick=\{\(\) => \{[\s\S]{0,300}?setSessionMenuOpen\(!open\);/,
  "both ArrowDown and trigger click must use the controlled Session options opener",
);
assert.match(
  sessionHeader,
  /promotableFamiliars\.map\(\(candidate\) => \([\s\S]{0,700}?<PopoverItem[\s\S]{0,300}?leading=\{<span aria-hidden><FamiliarIcon familiar=\{candidate\} size="sm" \/><\/span>\}[\s\S]{0,300}?onSelect=\{\(\) => \{\s*close\(\);\s*onPromoteToCoven\(candidate\.id\);\s*\}\}[\s\S]{0,300}?\{candidate\.display_name\}/,
  "each eligible familiar must have a decorative icon and close Session options before promotion",
);
assert.match(
  chatView,
  /const handleFamiliarDrop = useCallback\([\s\S]{0,1000}?promoteToCoven\(dropped\)/,
  "dragging a familiar into a solo Chat must still promote it to a coven",
);
assert.match(
  chatView,
  /className="cave-chat-transcript[^\"]*"[\s\S]{0,500}?onDrop=\{familiarDrag \? handleFamiliarDrop : undefined\}/,
  "the solo transcript must retain the familiar-drop handler binding",
);
assert.match(
  chatView,
  /saveGroups\(groups\);\s*\n\s*markCovenTabPending\(\);\s*\n\s*markCovenGroupPending\(group\.id\);\s*\n\s*window\.dispatchEvent\(new CustomEvent\(CHAT_OPEN_COVEN_EVENT\)\);/,
  "solo promotion must persist the coven and hand off to its tab",
);
assert.match(
  groupChatView,
  /<button[\s\S]{0,400}?aria-label="Add familiars to this coven"[\s\S]{0,300}?onClick=\{\(\) => setPickerOpen\(\(v\) => !v\)\}/,
  "Group chat's add-familiar control must open its picker",
);
assert.match(
  groupChatView,
  /familiars\.map\(\(f\) => \{[\s\S]{0,1000}?<button[\s\S]{0,500}?onClick=\{\(\) => toggleParticipant\(f\.id\)\}/,
  "Group chat's picker rows must toggle the selected familiar",
);

console.log("chat-header-chrome.test.ts: ok");
