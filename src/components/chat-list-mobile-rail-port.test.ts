// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Familiar switcher strip (mobile analog of the desktop rail footer) ───────
assert.match(source, /function ChatListFamiliarStrip/, "ChatList gains a familiar-switcher strip");
assert.match(source, /useResolvedFamiliars\(familiars\)/, "The strip resolves familiars for display");
assert.match(source, /<FamiliarAvatar familiar=\{f\} size="md"/, "Each chip reuses FamiliarAvatar");
assert.match(
  source,
  /className="chat-list-familiar-strip /,
  "The strip exposes a mobile-targetable class for horizontal scroll styling",
);
// Tapping a familiar starts a chat with them; wired where the strip is rendered.
assert.match(
  source,
  /<ChatListFamiliarStrip[\s\S]{0,160}onSelect=\{\(id\) => onNewChat\(undefined, id\)\}/,
  "Tapping a familiar chip starts a new chat scoped to that familiar",
);
// The trailing chip jumps to the Familiars surface via the shared nav event.
assert.match(
  source,
  /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode \} \}\)/,
  "The strip's + chip uses the decoupled cave:navigate-mode bridge",
);
assert.match(source, /navigateToMode\("agents"\)/, "The + chip opens the Familiars surface");

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

// ── Strip CSS: horizontal momentum scroll without a visible bar ──────────────
assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-list-familiar-strip\s*\{[\s\S]*scrollbar-width\s*:\s*none/,
  "Mobile familiar strip scrolls horizontally without a visible scrollbar",
);

// ── Preserved: existing rows still sortable by session id ────────────────────
assert.match(source, /<SortableChatListItem id=\{s\.id\}>/, "Rows remain sortable items keyed by session id");

console.log("chat-list-mobile-rail-port.test.ts: ok");
