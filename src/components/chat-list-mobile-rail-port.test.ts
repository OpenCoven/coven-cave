// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Familiar switching lives in the sidepanel selector ──────────────────────
assert.doesNotMatch(source, /function ChatListFamiliarStrip/, "ChatList should not render a redundant circular familiar strip");
assert.doesNotMatch(source, /chat-list-familiar-strip/, "ChatList should not keep the removed strip styling hook");
assert.doesNotMatch(source, /<FamiliarAvatar familiar=\{f\} size="md"/, "ChatList should not map familiars into circular selector chips");
assert.doesNotMatch(styles, /\.chat-list-familiar-strip/, "Removed familiar strip should not leave dead mobile CSS behind");

// ── Counted PINNED / SESSIONS section headers ────────────────────────────────
assert.match(source, /function ChatListSection/, "ChatList gains a counted section-header primitive");
assert.match(
  source,
  /uppercase tracking-\[0\.12em\]/,
  "Section headers are uppercase + letter-spaced like the desktop rail",
);
assert.match(
  source,
  /<ChatListSection label="Pinned" count=\{pinnedCount\}/,
  "A counted PINNED section header is rendered for the flat list",
);
assert.match(
  source,
  /<ChatListSection label="Sessions" count=\{restCount\}/,
  "A counted SESSIONS section header is rendered for the flat list",
);
// Headers are placed by first-member index so order/interleaving can't dupe them.
assert.match(source, /const firstPinnedIdx = pinnedFlags\.indexOf\(true\)/, "PINNED header anchors to the first pinned row");
assert.match(source, /const firstRestIdx = pinnedFlags\.indexOf\(false\)/, "SESSIONS header anchors to the first non-pinned row");
// Section headers only split the flat (null-project) list, not scoped folders.
assert.match(
  source,
  /projectRoot === null && idx === firstPinnedIdx/,
  "Sections only apply to the flat all-chats list",
);

// ── Preserved: existing rows still sortable by session id ────────────────────
assert.match(source, /<SortableChatListItem id=\{s\.id\}>/, "Rows remain sortable items keyed by session id");

console.log("chat-list-mobile-rail-port.test.ts: ok");
