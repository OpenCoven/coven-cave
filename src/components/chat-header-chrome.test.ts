// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const groupChatView = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
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
