// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("./ui/selection-toolbar.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./chat-broadcast-composer.tsx", import.meta.url), "utf8");
const chatListCss = readFileSync(new URL("../styles/chat-list.css", import.meta.url), "utf8");
const railCss = readFileSync(new URL("../styles/chat-inner-rail.css", import.meta.url), "utf8");

assert.match(
  toolbar,
  /compact\?: boolean[\s\S]*countLabel\?: ReactNode/,
  "the shared selection toolbar should expose compact layout and contextual count copy",
);
assert.match(
  toolbar,
  /ui-selection-toolbar__summary[\s\S]*ui-selection-toolbar__actions/,
  "selection status and actions should be separate layout regions",
);

assert.match(
  sidebar,
  /<SelectionToolbar[\s\S]{0,220}?compact[\s\S]{0,400}?countLabel=\{`/,
  "the narrow chat rail should opt into the compact selection hierarchy",
);
assert.match(
  sidebar,
  /broadcastActionLabel\(select\.selectedCount, broadcastRetryOnly\)/,
  "the rail should identify a retry rather than presenting a second generic broadcast",
);
assert.match(
  railCss,
  /\.cnav__select-bar \.ui-selection-toolbar--compact[\s\S]*flex-direction:\s*column/,
  "the rail selection toolbar should stack status above actions instead of wrapping equal-weight controls",
);
assert.match(
  railCss,
  /\.cnav__select-bar \.ui-selection-toolbar__actions[\s\S]*width:\s*100%/,
  "compact broadcast actions should receive a full-width action row",
);

assert.match(
  chatList,
  /<SelectionToolbar[\s\S]{0,400}?allSelected=\{allVisibleSelected\}/,
  "the full chat list should reuse the shared selection toolbar",
);
assert.match(
  chatList,
  /countLabel=\{`\$\{selectedVisibleCount\} \$\{broadcastRetryOnly \? "failed " : ""\}chat/,
  "selection status should name chats and failed-only retry state",
);
assert.match(
  chatList,
  /variant="primary"[\s\S]{0,260}?broadcastActionLabel\(selectedVisibleCount, broadcastRetryOnly\)/,
  "Broadcast should be the selected chats' one primary action",
);
assert.match(
  chatList,
  /<OverflowMenu[\s\S]{0,220}?ariaLabel="More actions for selected chats"[\s\S]*?<PopoverItem[\s\S]*?Archive[\s\S]*?<PopoverItem[\s\S]*?danger[\s\S]*?Delete/,
  "archive and delete should move into a clear secondary overflow",
);
assert.match(
  chatListCss,
  /@container chat-list \(max-width: 520px\)[\s\S]*\.chat-list-selection-bar \.ui-selection-toolbar__actions[\s\S]*width:\s*100%/,
  "the full-list toolbar should adapt to its container instead of viewport width",
);
assert.match(
  composer,
  /focusFirst=\{false\}/,
  "the composer should keep the modal trap from focusing its header Close button first",
);
assert.match(
  composer,
  /useEffect\(\(\) => \{\s*textareaRef\.current\?\.focus\(\);\s*\}, \[\]\);[\s\S]*ref=\{textareaRef\}/,
  "the broadcast message field should own the composer's initial focus",
);

console.log("chat-selection-ux.test.ts: ok");
