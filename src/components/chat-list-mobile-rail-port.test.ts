// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// ── Familiar switcher lives in the header, not the mobile chat list ──────────
assert.doesNotMatch(source, /function ChatListFamiliarStrip/, "ChatList should not duplicate the header familiar selector");
assert.doesNotMatch(source, /chat-list-familiar-strip/, "Mobile list should not keep the removed familiar-strip hook");
assert.doesNotMatch(source, /<FamiliarAvatar familiar=\{f\} size="md"/, "ChatList should not map familiars into circular selector chips");
assert.doesNotMatch(styles, /\.chat-list-familiar-strip/, "Removed familiar strip should not leave dead mobile CSS behind");
assert.match(topBar, /labeled=\{familiarSwitcherLabeled\}/, "TopBar can render the labeled familiar selector");
assert.match(workspace, /familiarSwitcherLabeled=\{mode === "chat"\}/, "Workspace labels the top-bar selector on the Familiars page");

// ── Counted PINNED / SESSIONS section headers ────────────────────────────────
assert.match(source, /function ChatListSection/, "ChatList gains a counted section-header primitive");
assert.match(
  source,
  /uppercase tracking-\[0\.12em\]/,
  "Section headers are uppercase + letter-spaced like the desktop rail",
);
assert.match(
  source,
  /<ChatListSection[\s\S]*?label="Pinned"[\s\S]*?count=\{pinnedCount\}/,
  "A counted PINNED section header is rendered for the flat list",
);
assert.match(
  source,
  /<ChatListSection[\s\S]*?label="Sessions"[\s\S]*?count=\{restCount\}/,
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
