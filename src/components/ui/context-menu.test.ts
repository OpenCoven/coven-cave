// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./context-menu.tsx", import.meta.url), "utf8");

// Built on the shared Popover (inherits Escape / outside-click / focus-return).
assert.match(src, /from "@\/components\/ui\/popover"/, "context menu reuses the Popover primitive");
assert.match(src, /export function ContextMenu/, "exports ContextMenu");
assert.match(src, /export function openContextMenuAt/, "exports the onContextMenu helper");

// State is the cursor position or null when closed; open = state !== null.
assert.match(src, /export type ContextMenuState = \{ x: number; y: number \} \| null/, "state is cursor xy or null");
assert.match(src, /open=\{state !== null\}/, "menu is open when state is set");

// Anchors to a 0-size element pinned at the cursor so it opens where clicked.
assert.match(src, /position: "fixed", left: state\?\.x[\s\S]{0,60}width: 0, height: 0/, "anchors a 0-size element at the cursor");

// The helper preventDefaults the native menu and records the click position.
assert.match(src, /e\.preventDefault\(\)/, "suppresses the browser's native context menu");
assert.match(src, /set\(\{ x: e\.clientX, y: e\.clientY \}\)/, "reports the cursor position");

// The content is a role=menu container (items are role=menuitem via PopoverItem).
assert.match(src, /role="menu"/, "menu content has role=menu");

console.log("context-menu.test.ts OK");
