// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Successor to right-sidebar-fit.test.ts: the Inspector right sidepanel is
// retired, so the code rail is the only right sidepanel on the chat surface.
// These pins hold the surviving layout contracts (split persistence, rail
// sizing, the collapsed reopen rail) and guard the retired panel's fossils.

const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const projectSidebar = await readFile(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const caveChat = await readFile(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

// The split width must persist across reloads via useDefaultLayout under
// CHAT_GROUP_ID, keyed by the mounted panel set (bare vs with-code-rail).
assert.match(
  chatSurface,
  /useDefaultLayout\(\{[\s\S]*id: CHAT_GROUP_ID[\s\S]*storage: chatStorage/,
  "ChatSurface should persist the chat/right-area split width across reloads",
);

assert.match(
  chatSurface,
  /<Group[\s\S]*orientation="horizontal"[\s\S]*defaultLayout=\{defaultLayout\}[\s\S]*onLayoutChanged=\{onLayoutChanged\}/,
  "The horizontal chat Group should apply the persisted layout",
);

// The code rail is the ONLY right sidepanel: exactly one right-side Panel
// (id="code-rail"), drag-resizable behind an outer separator.
assert.match(
  chatSurface,
  /Panel[\s\S]*id="code-rail"[\s\S]*defaultSize="320px"[\s\S]*minSize="240px"[\s\S]*maxSize="560px"/,
  "ChatSurface code rail should default to 320px, drag-resizable within a 240–560px band",
);
assert.doesNotMatch(
  chatSurface,
  /id="right-sidebar"|id="right-panel-primary"|id="right-panel-changes"/,
  "the retired inspector right sidebar must not remount beside the code rail",
);
assert.match(
  chatSurface,
  /<Separator className="shell-separator hidden lg:flex">[\s\S]*<SeparatorHandle orientation="col" \/>/,
  "The code rail should have an outer drag-to-resize separator before it",
);

assert.match(
  projectSidebar,
  /chat-thread-rail[\s\S]*w-\[230px\]/,
  "The internal left rail stays 230px",
);

// ── Collapsed code rail — the reflection of the left nav's collapsed rail ──
// A closed rail leaves an in-flow reopen rail at the right edge (desktop,
// wide panes) — content flows beside it, never underneath.
assert.match(
  chatSurface,
  /rail\.available && !rail\.open && !isMobile && !paneNarrow && \([\s\S]{0,600}?className="workspace-rail-reopen focus-ring"[\s\S]{0,300}?onClick=\{rail\.reopen\}/,
  "collapsing the code rail must leave a reopen rail (wide desktop panes) that restores it",
);

// The rail participates in layout (content beside it, never underneath):
// it must NOT be absolutely positioned, and it reserves its own width.
assert.match(
  caveChat,
  /\.workspace-rail-reopen \{[\s\S]{0,900}?flex: 0 0 44px;/,
  "the reopen rail reserves in-flow layout width",
);
assert.doesNotMatch(
  caveChat,
  /\.workspace-rail-reopen \{[\s\S]{0,900}?position: absolute;/,
  "the reopen rail must not overlay content (no absolute positioning)",
);

// Label orientation: reads top→bottom with the glyph face to the
// right/outside (vertical-rl) — mirroring the left rail's vocabulary.
assert.match(
  caveChat,
  /\.workspace-rail-reopen__label \{\s*writing-mode: vertical-rl;/,
  "the rail label reads downward with its face to the right/outside",
);

// The rail carries the left panel's glass (with honest fallbacks).
assert.match(
  caveChat,
  /\.workspace-rail-reopen \{[\s\S]{0,900}?color-mix\(in oklch, var\(--bg-raised\) 88%, transparent\)[\s\S]{0,200}?backdrop-filter: blur\(14px\) saturate\(140%\)/,
  "the rail wears the same glass as the left sidebar",
);
assert.match(
  caveChat,
  /@media \(prefers-reduced-transparency: reduce\) \{\s*\.workspace-rail-reopen \{/,
  "rail glass respects reduced transparency",
);

// The retired inspector panel's CSS fossils stay deleted.
assert.doesNotMatch(
  globals,
  /\.right-panel-tabs\s*\{|\.right-panel-tab\s*\{|\.chat-right-aside\s*\{|right-panel-strip--closed\s*\{/,
  "the retired right-panel / chat-right-aside CSS fossils stay deleted",
);
assert.doesNotMatch(
  caveChat,
  /\.chat-right-rail\b/,
  "the retired Inspector reopen-rail CSS stays deleted",
);

console.log("code-rail-fit.test.ts OK");
