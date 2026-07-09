// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const projectSidebar = await readFile(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");

assert.match(
  chatSurface,
  /Panel[\s\S]*id="right-sidebar"[\s\S]*defaultSize="260px"[\s\S]*minSize="220px"[\s\S]*maxSize="480px"/,
  "ChatSurface right sidebar should default to 260px (Inspector section tabs fit untruncated) but be drag-resizable within a 220–480px band",
);

// Drag-to-resize: an outer separator with a col handle sits before the right
// sidebar so its width can be changed. The INNER vertical-split separator
// (shell-separator-h) is unaffected (asserted below).
assert.match(
  chatSurface,
  /<Separator className="shell-separator hidden lg:flex">[\s\S]*<SeparatorHandle orientation="col" \/>/,
  "The right sidebar should have an outer drag-to-resize separator before it",
);

// The split width must persist across reloads via useDefaultLayout under
// CHAT_GROUP_ID (the chat↔code power split was removed with the Chat/Code toggle).
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

assert.match(
  projectSidebar,
  /chat-thread-rail[\s\S]*w-\[230px\]/,
  "The internal left rail stays 230px (the right sidebar runs slightly wider at 260px so Inspector tabs fit)",
);

// The aside mirrors the left sidebar's glass chrome: translucent bg + blur,
// with reduced-transparency and no-backdrop-filter fallbacks.
assert.match(
  globals,
  /\.chat-right-aside\s*\{[\s\S]*?border-left:\s*1px solid var\(--border-hairline\)[\s\S]*?color-mix\(in oklch, var\(--bg-raised\) 88%, transparent\)[\s\S]*?backdrop-filter: blur/,
  "The chat right aside should carry the left sidebar's glass chrome (hairline + translucent blur)",
);
assert.match(
  globals,
  /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s*\{\s*\.chat-right-aside \{ background: var\(--bg-raised\); \}/,
  "The glass aside must fall back to a solid raised background without backdrop-filter support",
);
assert.match(
  globals,
  /@media \(prefers-reduced-transparency: reduce\)\s*\{\s*\.chat-right-aside \{[\s\S]*?background: var\(--bg-raised\);[\s\S]*?backdrop-filter: none;/,
  "The glass aside must respect prefers-reduced-transparency",
);

assert.match(
  globals,
  /\.right-panel-tabs[\s\S]*min-width:\s*0/,
  "Right panel tab bar should be allowed to shrink inside narrow sidebar widths",
);

assert.match(
  globals,
  /\.right-panel-tab[\s\S]*min-width:\s*0[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis/,
  "Right panel tabs should truncate instead of overflowing the sidebar",
);

assert.match(
  chatSurface,
  /right-panel-close[\s\S]*?className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"/,
  "Right panel top content wrapper must scroll vertically so pane content without an internal scroller is reachable",
);

assert.match(
  chatSurface,
  /<Group[\s\S]*className="right-panel-split"[\s\S]*orientation="vertical"/,
  "ChatSurface right sidebar should use a vertical split inside the right panel",
);

assert.match(
  chatSurface,
  /<Panel[\s\S]*id="right-panel-primary"[\s\S]*defaultSize="50%"[\s\S]*<Separator[\s\S]*className="shell-separator-h right-panel-splitter"[\s\S]*<Panel[\s\S]*id="right-panel-changes"[\s\S]*defaultSize="50%"/,
  "ChatSurface right sidebar should default to a 50/50 vertical split",
);

console.log("right-sidebar-fit.test.ts OK");
